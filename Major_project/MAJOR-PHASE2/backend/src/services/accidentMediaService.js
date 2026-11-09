// accidentMediaService.js
// Storage for owner-submitted accident evidence (dashcam clips, photos).
//
// Why not the DamageEvent document: MongoDB caps a document at 16MB, and a
// dashcam clip is routinely 20-100MB. Bytes therefore live on the application
// server's media disk, while the record keeps what matters for trust:
// fileName, contentType, fileSize and the SHA-256 of the exact bytes received.
// The officer's integrity check re-hashes the stored file against that digest,
// so a file swapped after submission is detected. No IPFS or blockchain
// dependency is required for this to work.
//
// On a production deployment this module is the single place to swap for object
// storage (S3/GCS) or IPFS; the routes only use save/remove/open.

import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
// backend/uploads/accident-evidence
const MEDIA_ROOT = path.resolve(here, "..", "..", "uploads", "accident-evidence");
// Temporary landing zone for multipart uploads before they are hashed and filed
const STAGING_ROOT = path.join(MEDIA_ROOT, "_staging");

const SAFE_SEG = /^[a-f0-9]{24}$/i;

/**
 * Turn an uploaded original filename into something safe to show later:
 * keeps the extension, drops paths and control characters.
 */
const sanitizeName = (name) => {
    const base = path.basename(String(name || "file"));
    const cleaned = base.replace(/[^\w.\- ]+/g, "").replace(/\s+/g, " ").trim();
    return (cleaned || "file").slice(0, 120);
};

/**
 * Persist one already-staged upload: move it out of the temporary folder into
 * its own batch folder, then hash the stored bytes by streaming (never loaded
 * into memory, which matters for long dashcam clips).
 * Returns the reference to keep on the record. Throws on any failure so the
 * caller can abort the whole submission rather than record a file that cannot
 * be retrieved.
 */
export const saveStagedFile = async ({ stagedPath, originalname, mimetype, size }) => {
    const batch = crypto.randomBytes(12).toString("hex");
    const dir = path.join(MEDIA_ROOT, batch);
    const ext = path.extname(sanitizeName(originalname)).slice(0, 10);
    const storedAs = path.posix.join(batch, `${crypto.randomBytes(8).toString("hex")}${ext}`);
    let sha256 = null;
    try {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.rename(stagedPath, path.join(MEDIA_ROOT, storedAs));
        sha256 = await hashFileAt(path.join(MEDIA_ROOT, storedAs));
    } catch (err) {
        await fsp.rm(dir, { recursive: true, force: true });
        // Leave nothing half-written; the caller answers 503 for the whole upload.
        try { await fsp.unlink(stagedPath); } catch { /* already gone */ }
        throw err;
    }
    return {
        fileName: sanitizeName(originalname),
        contentType: mimetype,
        fileSize: size,
        // Digest of the bytes we now hold, so a later integrity check compares
        // against what was actually stored, not what the browser claimed to send.
        sha256,
        storage: "disk",
        storedAs,
    };
};

const hashFileAt = (abs) => new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(abs);
    stream.on("error", reject);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
});

/**
 * Multer destination for the temporary landing zone. Files are moved out of here
 * by saveStagedFile, or unlinked when a submission is rejected.
 */
export const stagingDir = async () => {
    await fsp.mkdir(STAGING_ROOT, { recursive: true });
    return STAGING_ROOT;
};

/**
 * Temporary name for an upload in progress. Never derived from the client's
 * file name, so nothing the browser sends can influence where it lands.
 */
export const newStagedName = () => `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;

/**
 * Re-hash one evidence entry, whichever storage it uses.
 * Returns null when the bytes cannot be read, which the caller reports as a
 * failed integrity check instead of silently passing.
 */
export const digestForEvidence = async (file) => {
    if (!file) return null;
    if (file.storage === "disk") {
        const abs = resolveStored(file.storedAs);
        if (!abs) return null;
        try {
            return await hashFileAt(abs);
        } catch {
            return null;
        }
    }
    if (file.data && file.data.length) {
        return crypto.createHash("sha256").update(file.data).digest("hex");
    }
    return null;
};

/** Remove a rejected upload that never made it onto a record. */
export const discardStagedFile = async (stagedPath) => {
    try { await fsp.unlink(stagedPath); } catch { /* nothing to clean */ }
};

/** Best-effort cleanup used when a submission is rolled back. */
export const removeMediaBatch = async (storedAs) => {
    if (!storedAs) return;
    const batch = String(storedAs).split("/")[0];
    if (!SAFE_SEG.test(batch)) return; // never traverse on an unexpected value
    await fsp.rm(path.join(MEDIA_ROOT, batch), { recursive: true, force: true });
};

/** Remove every file referenced by an event (used by officer/test cleanup). */
export const removeMediaForEvent = async (evidence = []) => {
    for (const e of evidence) {
        if (e?.storage === "disk") await removeMediaBatch(e.storedAs);
    }
};

const resolveStored = (storedAs) => {
    const batch = String(storedAs || "").split("/")[0];
    if (!SAFE_SEG.test(batch)) return null;
    const abs = path.resolve(MEDIA_ROOT, String(storedAs));
    // Belt and braces: the resolved path must stay inside the media root.
    if (!abs.startsWith(MEDIA_ROOT + path.sep)) return null;
    return abs;
};

/**
 * Stream a stored evidence file with HTTP Range support, so an officer can seek
 * through a long dashcam clip in the browser instead of downloading all of it.
 * `file` is the evidence sub-document ({ storedAs, fileName, contentType }).
 * Returns false when the reference is invalid or the file is missing, so the
 * caller answers 404 rather than sending an empty video.
 */
export const streamMediaFile = async (file, req, res) => {
    const abs = resolveStored(file?.storedAs);
    if (!abs) return false;
    let stat;
    try {
        stat = await fsp.stat(abs);
    } catch {
        return false;
    }

    const range = req.headers.range ? /bytes=(\d*)-(\d*)/.exec(req.headers.range) : null;
    let start = 0;
    let end = stat.size - 1;
    if (range) {
        // "bytes=-500" means the last 500 bytes (how browsers probe a new source)
        start = range[1] === "" ? Math.max(0, stat.size - Number(range[2] || 0)) : Number(range[1]);
        if (range[2] !== "") end = Math.min(Number(range[2]), stat.size - 1);
    }
    if (!Number.isFinite(start) || start > end || end >= stat.size) {
        res.status(416).set("Content-Range", `bytes */${stat.size}`).end();
        return true;
    }

    const stream = fs.createReadStream(abs, { start, end });
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());

    res.status(range ? 206 : 200).set({
        "Accept-Ranges": "bytes",
        "Content-Range": range ? `bytes ${start}-${end}/${stat.size}` : undefined,
        "Content-Length": end - start + 1,
        "Content-Type": file.contentType || "application/octet-stream",
        "Cache-Control": "private, no-store",
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.fileName || "evidence")}`,
    });

    stream.pipe(res);
    return true;
};

export const mediaRoot = MEDIA_ROOT;
