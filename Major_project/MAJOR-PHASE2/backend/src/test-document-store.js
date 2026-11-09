// test-document-store.js
// Smoke test for vehicle document storage without any external IPFS service.
// Run with the backend up: node src/test-document-store.js
//
// What it proves: an upload is accepted and stored under its own SHA-256, the
// bytes come back identical for the people allowed to see them and are refused
// for everyone else, the recorded hash is what the vehicle row keeps, and a
// file altered on disk stops being served. Everything it writes - the metadata
// row, the vehicle reference and the stored bytes - is removed again.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:5000/api";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const VAULT = path.join(ROOT, "backend", "uploads", "documents");

let passed = 0, failed = 0, reported = false;
let mongoose = null;
// What the run created, so report() can put the repository back as it found it.
const created = { vehicleId: null, documentId: null, previousRc: undefined, digest: null };

const check = (name, cond, extra = "") => {
    if (cond) { passed++; console.log(` [PASS] ${name}`); }
    else { failed++; console.log(` [FAIL] ${name} ${extra}`); }
};

const json = async (p, opts = {}, token) => {
    const res = await fetch(BASE + p, {
        ...opts,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const login = async (email, password) => {
    const res = await json("/auth/login", { method: "POST", body: { email, password } });
    return res.data?.token || null;
};

// A real, tiny PDF: the bytes below are a complete one-page document, so the
// MIME type and the stored content are truthful rather than a padded string.
const tinyPdf = () => Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
    "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
    "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 100]>>endobj\n" +
    "trailer<</Root 1 0 R>>\n%%EOF\n",
    "utf8",
);

const uploadDocument = async (vehicleId, bytes, fileName, mimeType, token) => {
    const fd = new FormData();
    fd.append("document", new Blob([bytes], { type: mimeType }), fileName);
    fd.append("documentType", "rc");
    const res = await fetch(`${BASE}/upload/vehicle-document/${vehicleId}`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const rawGet = async (url, token) => {
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
};

const findVaultFile = (digest) => {
    const dir = path.join(VAULT, digest.slice(0, 2));
    if (!fs.existsSync(dir)) return null;
    const hit = fs.readdirSync(dir).find((f) => f.startsWith(digest) && !f.endsWith(".meta.json"));
    return hit ? path.join(dir, hit) : null;
};

// A run interrupted halfway (power loss, server restart) leaves its metadata rows
// and stored bytes behind. Clear them before starting, so this suite always
// describes a clean repository rather than the sum of every past attempt.
const sweepLeftovers = async (db) => {
    const stale = await db.collection("vehicles").find(
        { "documents.name": { $regex: "^suite-rc" } },
        { projection: { documents: 1 } },
    ).toArray();
    let rows = 0;
    for (const v of stale) {
        for (const d of (v.documents || []).filter((x) => /^suite-rc/.test(x.name || ""))) {
            const digest = String(d.ipfsHash || "").replace(/^sha256:/, "");
            if (digest) {
                const f = findVaultFile(digest);
                if (f) { fs.rmSync(f, { force: true }); fs.rmSync(`${f}.meta.json`, { force: true }); }
            }
            rows++;
        }
    }
    if (rows) {
        await db.collection("vehicles").updateMany({}, { $pull: { documents: { name: { $regex: "^suite-rc" } } } });
        console.log(` [NOTE] cleared ${rows} leftover document row(s) from an interrupted run`);
    }
};

const run = async () => {
    console.log("\n=== Vehicle document store (no external IPFS) ===\n");

    mongoose = (await import("mongoose")).default;
    const envText = fs.existsSync(path.join(ROOT, "backend", ".env"))
        ? fs.readFileSync(path.join(ROOT, "backend", ".env"), "utf8")
        : "";
    const mongoUri = (envText.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || "mongodb://127.0.0.1:27017/BioChainRTO";
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;
    await sweepLeftovers(db);

    const ownerToken = await login("owner@biochain.com", "owner123");
    check("Owner login", !!ownerToken);
    if (!ownerToken) return report();

    const otherToken = await login("owner2@biochain.com", "owner123");
    const rtoToken = await login("ka.rto@biochain.com", "ka123");

    const mine = await json("/vehicles/my", {}, ownerToken);
    const list = mine.data.vehicles || mine.data || [];
    const vehicle = list[0];
    check("Owner holds a vehicle to file a document against", !!vehicle?._id, `(${mine.status})`);
    if (!vehicle?._id) return report();

    created.vehicleId = vehicle._id;
    const vid = new mongoose.Types.ObjectId(vehicle._id);

    // Remember whatever the demo record held before, so the run leaves it as found.
    const before = await db.collection("vehicles").findOne(
        { _id: vid },
        { projection: { "ipfsDocuments.rcCertificate": 1 } },
    );
    created.previousRc = before?.ipfsDocuments?.rcCertificate ?? null;

    const bytes = tinyPdf();
    const expectedDigest = crypto.createHash("sha256").update(bytes).digest("hex");

    // ---- Upload is accepted with no Pinata credentials ----
    const stored = await uploadDocument(vehicle._id, bytes, "suite-rc.pdf", "application/pdf", ownerToken);
    check(
        "Document upload succeeds without an IPFS service",
        stored.status === 200 && !!stored.data?.ipfsHash,
        `(${stored.status} ${JSON.stringify(stored.data).slice(0, 160)})`,
    );
    const reference = stored.data?.ipfsHash || "";
    const digest = reference.replace(/^sha256:/, "");
    created.digest = digest;
    check("The reference is the file's own SHA-256", digest === expectedDigest, `(${reference.slice(0, 30)})`);
    check("The response says where the bytes actually live", stored.data?.storage === "local-verified-vault", `(${stored.data?.storage})`);
    check(
        "The download URL points at this application, not a dead gateway",
        /\/api\/upload\/document\/[0-9a-f]{64}$/.test(stored.data?.ipfsUrl || ""),
        `(${stored.data?.ipfsUrl})`,
    );

    const diskPath = findVaultFile(digest);
    check("The bytes are on disk under their digest", !!diskPath);
    if (diskPath) check("Stored bytes are identical to what was sent", fs.readFileSync(diskPath).equals(bytes));

    const afterUpload = await db.collection("vehicles").findOne(
        { _id: vid },
        { projection: { "ipfsDocuments.rcCertificate": 1 } },
    );
    check("The vehicle record keeps the hash reference", afterUpload?.ipfsDocuments?.rcCertificate === reference);

    // ---- Retrieval and access control ----
    const docUrl = `${BASE}/upload/document/${digest}`;
    const asOwner = await rawGet(docUrl, ownerToken);
    check("Owner can fetch the stored document back", asOwner.status === 200 && asOwner.body.equals(bytes), `(${asOwner.status})`);
    check("The response carries the hash it verified", asOwner.headers.get("x-content-sha256") === expectedDigest);
    check("The content type round-trips", asOwner.headers.get("content-type") === "application/pdf", `(${asOwner.headers.get("content-type")})`);

    const anonymous = await rawGet(docUrl, null);
    check("An unauthenticated request is refused", anonymous.status === 401, `(${anonymous.status})`);

    if (otherToken) {
        const asStranger = await rawGet(docUrl, otherToken);
        check("Another owner cannot read this vehicle's document", asStranger.status === 403, `(${asStranger.status})`);
    } else {
        console.log(" [NOTE] owner2 account absent, cross-owner check skipped");
    }

    const asOfficer = await rawGet(docUrl, rtoToken);
    check("An RTO officer can read it", asOfficer.status === 200, `(${asOfficer.status})`);

    const malformed = await rawGet(`${BASE}/upload/document/not-a-hash`, ownerToken);
    check("A malformed hash is rejected as a bad request", malformed.status === 400, `(${malformed.status})`);

    const absent = await rawGet(`${BASE}/upload/document/${"ab".repeat(32)}`, ownerToken);
    check("A hash with no stored file says so", absent.status === 404, `(${absent.status})`);

    // ---- The metadata row and the preview route the UI actually uses ----
    const registered = await json(`/documents-mgmt/upload/${vehicle._id}`, {
        method: "POST",
        body: {
            type: "rc",
            name: "suite-rc.pdf",
            ipfsHash: reference,
            fileUrl: stored.data.ipfsUrl,
            mimeType: "application/pdf",
            fileSize: bytes.length,
        },
    }, ownerToken);
    created.documentId = registered.data?.document?._id || null;
    check("Document metadata registered against the vehicle", !!created.documentId, `(${registered.status})`);

    if (created.documentId) {
        const preview = await json(`/documents-mgmt/preview/${vehicle._id}/${created.documentId}`, {}, ownerToken);
        check("Preview labels the medium honestly", preview.data?.storage === "local-verified-store", `(${preview.data?.storage})`);
        check("Preview says content is available", preview.data?.contentAvailable === true);

        const content = await rawGet(`${BASE}/documents-mgmt/content/${vehicle._id}/${created.documentId}`, ownerToken);
        check("Preview content matches the stored bytes", content.status === 200 && content.body.equals(bytes), `(${content.status})`);

        if (otherToken) {
            const stranger = await rawGet(`${BASE}/documents-mgmt/content/${vehicle._id}/${created.documentId}`, otherToken);
            check("Another owner is refused the content", stranger.status === 403, `(${stranger.status})`);
        }

        // ---- Tampering is caught, not hidden ----
        if (diskPath) {
            const original = fs.readFileSync(diskPath);
            const swapped = Buffer.from(original);
            const mid = Math.floor(swapped.length / 2);
            swapped[mid] = swapped[mid] ^ 0x20;
            fs.writeFileSync(diskPath, swapped);

            const tampered = await rawGet(docUrl, ownerToken);
            check("A file edited on disk is refused instead of served", tampered.status === 409, `(${tampered.status})`);
            check("And the refusal explains why", /no longer match/i.test(tampered.body.toString()));

            const tamperedContent = await rawGet(`${BASE}/documents-mgmt/content/${vehicle._id}/${created.documentId}`, ownerToken);
            check("The preview route detects the same tampering", tamperedContent.status === 409, `(${tamperedContent.status})`);

            fs.writeFileSync(diskPath, original);
            const restored = await rawGet(docUrl, ownerToken);
            check("Restoring the bytes makes it verifiable again", restored.status === 200, `(${restored.status})`);
        }

        // ---- Same file twice is one file, not two ----
        const again = await uploadDocument(vehicle._id, bytes, "suite-rc-copy.pdf", "application/pdf", ownerToken);
        check("Re-uploading identical content yields the same reference", again.data?.ipfsHash === reference);
    }

    await report();
};

const report = async () => {
    if (reported) return;
    reported = true;

    try {
        if (mongoose && created.vehicleId) {
            const db = mongoose.connection.db;
            const vid = new mongoose.Types.ObjectId(created.vehicleId);
            if (created.documentId) {
                await db.collection("vehicles").updateOne(
                    { _id: vid },
                    { $pull: { documents: { _id: new mongoose.Types.ObjectId(created.documentId) } } },
                );
            }
            // The vehicle keeps exactly the reference it had before this run.
            await db.collection("vehicles").updateOne(
                { _id: vid },
                { $set: { "ipfsDocuments.rcCertificate": created.previousRc } },
            );

            // Drop the stored bytes only once nothing references them any more.
            if (created.digest) {
                const reference = `sha256:${created.digest}`;
                const stillUsed = await db.collection("vehicles").countDocuments({
                    $or: [{ "ipfsDocuments.rcCertificate": reference }, { "documents.ipfsHash": reference }],
                });
                if (!stillUsed) {
                    const diskPath = findVaultFile(created.digest);
                    if (diskPath) {
                        fs.rmSync(diskPath, { force: true });
                        fs.rmSync(`${diskPath}.meta.json`, { force: true });
                        const dir = path.dirname(diskPath);
                        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
                    }
                }
            }
        }
    } catch (err) {
        console.log(` [NOTE] cleanup problem: ${err.message}`);
    }

    console.log(`\n=== ${passed} passed, ${failed} failed ===\n`);
    if (mongoose) await mongoose.disconnect();
    if (failed > 0) process.exitCode = 1;
};

run().catch((err) => {
    console.error("Suite crashed:", err);
    process.exitCode = 1;
    report();
});
