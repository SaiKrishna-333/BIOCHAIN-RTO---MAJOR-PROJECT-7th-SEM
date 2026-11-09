// ipfsService.js
// Service for storing and retrieving document content, addressed by a hash.
//
// Three storage tiers, tried in order:
//  1. Pinata (managed IPFS) when PINATA_API_KEY / PINATA_SECRET_KEY are set.
//  2. A local IPFS daemon at IPFS_LOCAL_URL.
//  3. A content-addressed vault on this server's disk.
//
// Tier 3 exists because a demo machine has neither Pinata credentials nor an
// IPFS daemon, and the old behaviour was to refuse every document upload with a
// 503. It is honest: the recorded reference is the real SHA-256 of the bytes
// with a `sha256:` prefix, the bytes are kept on disk, and retrieval re-hashes
// them so a tampered file stops matching. It is NOT decentralized storage, and
// nothing in the response pretends to be an IPFS CID or open an IPFS gateway.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import FormData from "form-data";

// Pinata API configuration
const PINATA_API_KEY = process.env.PINATA_API_KEY || "";
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY || "";
const PINATA_BASE_URL = "https://api.pinata.cloud";

// Local IPFS node configuration (fallback)
const IPFS_LOCAL_URL = process.env.IPFS_LOCAL_URL || "http://localhost:5001";

// Content-addressed vault (last-resort fallback)
const VAULT_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../uploads/documents",
);
// Where the frontend must come back to fetch a vaulted document.
const SERVE_BASE = process.env.BACKEND_PUBLIC_URL || `http://localhost:${process.env.PORT || 5000}`;
export const VAULT_PREFIX = "sha256:";

// The tier-3 fallback is a property of this machine, not of one request, so it is
// stated once per kind instead of after every upload.
const notedFallbacks = new Set();
const noteVaultFallback = (kind, reason) => {
    if (notedFallbacks.has(kind)) return;
    notedFallbacks.add(kind);
    console.log(`IPFS unavailable (${reason}); ${kind}s are stored in the local verified vault (this note is not repeated)`);
};

/**
 * Store bytes under their own SHA-256 and return that reference. The name is
 * kept beside it so the download can be offered with a sensible filename.
 */
const storeInVault = async (fileBuffer, fileName, metadata = {}) => {
    const digest = crypto.createHash("sha256").update(fileBuffer).digest("hex");
    const ext = path.extname(fileName || "").slice(0, 10).replace(/[^.a-zA-Z0-9]/g, "");
    const dir = path.join(VAULT_ROOT, digest.slice(0, 2));
    await fs.promises.mkdir(dir, { recursive: true });
    const storedAs = `${digest}${ext}`;
    const target = path.join(dir, storedAs);
    // Same content uploaded twice lands on the same file - that is the point of
    // content addressing, so a collision is a no-op rather than a duplicate. The
    // exception is a file that no longer hashes to its own name: it was damaged
    // after being stored, and the bytes being submitted now are the known good
    // ones, so the vault repairs itself instead of serving a corrupt file forever.
    if (fs.existsSync(target)) {
        const onDisk = await fs.promises.readFile(target).catch(() => null);
        const onDiskDigest = onDisk
            ? crypto.createHash("sha256").update(onDisk).digest("hex")
            : null;
        if (onDiskDigest === digest) {
            // Already held, byte for byte.
        } else {
            console.warn(`Vault file ${storedAs.slice(0, 16)}… did not match its own hash; rewriting the bytes just supplied`);
            await fs.promises.writeFile(target, fileBuffer);
        }
    } else {
        await fs.promises.writeFile(target, fileBuffer);
    }
    // Who stored it, so the download route can let that person back in even when
    // no vehicle record references the bytes (theft reports, inheritance packs).
    await fs.promises.writeFile(
        `${target}.meta.json`,
        JSON.stringify({
            fileName: fileName || storedAs,
            mimeType: metadata.mimeType || null,
            size: fileBuffer.length,
            storedAt: new Date().toISOString(),
            uploadedBy: metadata.uploadedBy || null,
        }, null, 2),
    ).catch(() => { });
    return { reference: `${VAULT_PREFIX}${digest}`, digest, storedAs };
};

/**
 * Resolve a vault reference back to the file on disk, or null when it is not a
 * vaulted reference. Callers stream the result.
 */
export const resolveVaultFile = async (reference) => {
    const digest = String(reference || "").startsWith(VAULT_PREFIX)
        ? reference.slice(VAULT_PREFIX.length)
        : reference;
    if (!/^[0-9a-f]{64}$/.test(String(digest))) return null;
    const dir = path.join(VAULT_ROOT, digest.slice(0, 2));
    let entries;
    try {
        entries = await fs.promises.readdir(dir);
    } catch {
        return null;
    }
    const file = entries.find((f) => f.startsWith(digest) && !f.endsWith(".meta.json"));
    if (!file) return null;
    let meta = {};
    try {
        meta = JSON.parse(await fs.promises.readFile(path.join(dir, `${file}.meta.json`), "utf8"));
    } catch { /* meta is optional */ }
    return { digest, filePath: path.join(dir, file), fileName: meta.fileName || file, mimeType: meta.mimeType || null, uploadedBy: meta.uploadedBy || null };
};

/**
 * Upload a file to IPFS, or to the local vault when no IPFS service is wired up.
 * @param {Buffer} fileBuffer - File content as buffer
 * @param {string} fileName - Original file name
 * @param {Object} metadata - Additional metadata for the file
 * @returns {Promise<string>} - IPFS CID, or a `sha256:` vault reference
 */
export const uploadToIPFS = async (fileBuffer, fileName, metadata = {}) => {
    try {
        // Try Pinata first if API keys are available
        if (PINATA_API_KEY && PINATA_SECRET_KEY) {
            return await uploadToPinata(fileBuffer, fileName, metadata);
        }

        // Fallback to local IPFS node
        return await uploadToLocalIPFS(fileBuffer, fileName);
    } catch (error) {
        // No IPFS available: keep the document instead of refusing the upload,
        // and label the result as exactly what it is. The reason is logged because
        // "it failed" tells a reviewer nothing about which tier was missing - and
        // logged once, because the missing tier does not change mid-session.
        const reason = error?.message || error?.code || (PINATA_API_KEY ? "local IPFS node unreachable" : "no Pinata credentials and no local IPFS node");
        noteVaultFallback("document", reason);
        return (await storeInVault(fileBuffer, fileName, metadata)).reference;
    }
};

/**
 * Upload file to Pinata (managed IPFS service)
 */
const uploadToPinata = async (fileBuffer, fileName, metadata) => {
    const url = `${PINATA_BASE_URL}/pinning/pinFileToIPFS`;

    const formData = new FormData();
    formData.append("file", fileBuffer, { filename: fileName });

    // Add metadata
    const pinataMetadata = JSON.stringify({
        name: fileName,
        keyvalues: {
            ...metadata,
            uploadedAt: new Date().toISOString(),
            system: "BioChain RTO"
        }
    });
    formData.append("pinataMetadata", pinataMetadata);

    // Pin options
    const pinataOptions = JSON.stringify({
        cidVersion: 1,
        wrapWithDirectory: false
    });
    formData.append("pinataOptions", pinataOptions);

    const response = await axios.post(url, formData, {
        headers: {
            ...formData.getHeaders(),
            pinata_api_key: PINATA_API_KEY,
            pinata_secret_api_key: PINATA_SECRET_KEY
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity
    });

    const ipfsHash = response.data.IpfsHash;
    console.log(`File uploaded to IPFS via Pinata. Hash: ${ipfsHash}`);

    return ipfsHash;
};

/**
 * Upload file to local IPFS node
 */
const uploadToLocalIPFS = async (fileBuffer, fileName) => {
    const FormDataLocal = (await import("form-data")).default;
    const formData = new FormDataLocal();
    formData.append("file", fileBuffer, { filename: fileName });

    const response = await axios.post(`${IPFS_LOCAL_URL}/api/v0/add`, formData, {
        headers: formData.getHeaders()
    });

    const ipfsHash = response.data.Hash;
    console.log(`File uploaded to local IPFS. Hash: ${ipfsHash}`);

    return ipfsHash;
};

/**
 * Upload JSON metadata to IPFS
 * @param {Object} jsonData - JSON data to upload
 * @param {string} name - Name for the pinned content
 * @returns {Promise<string>} - IPFS hash (CID)
 */
export const uploadJSONToIPFS = async (jsonData, name = "metadata.json") => {
    try {
        const data = JSON.stringify({
            pinataContent: jsonData,
            pinataMetadata: {
                name,
                keyvalues: {
                    type: "json",
                    uploadedAt: new Date().toISOString(),
                    system: "BioChain RTO"
                }
            },
            pinataOptions: {
                cidVersion: 1
            }
        });

        if (PINATA_API_KEY && PINATA_SECRET_KEY) {
            const response = await axios.post(
                `${PINATA_BASE_URL}/pinning/pinJSONToIPFS`,
                data,
                {
                    headers: {
                        "Content-Type": "application/json",
                        pinata_api_key: PINATA_API_KEY,
                        pinata_secret_api_key: PINATA_SECRET_KEY
                    }
                }
            );

            console.log(`JSON uploaded to IPFS. Hash: ${response.data.IpfsHash}`);
            return response.data.IpfsHash;
        } else {
            // Local IPFS fallback
            const buffer = Buffer.from(JSON.stringify(jsonData));
            return await uploadToLocalIPFS(buffer, name);
        }
    } catch (error) {
        // Same honest last resort as a file upload: keep the record, label it correctly.
        noteVaultFallback("record", error?.message || error?.code || "no Pinata credentials and no local IPFS node");
        return (await storeInVault(Buffer.from(JSON.stringify(jsonData)), name, jsonData?.metadata || {})).reference;
    }
};

/**
 * Get a retrievable URL for a stored reference.
 * @param {string} ref - IPFS CID or `sha256:` vault reference
 * @returns {string} - gateway URL, or this app's own download route
 */
export const getIPFSUrl = (ref) => {
    if (typeof ref === "string" && ref.startsWith(VAULT_PREFIX)) {
        return `${SERVE_BASE}/api/upload/document/${ref.slice(VAULT_PREFIX.length)}`;
    }
    // Use Pinata gateway or public IPFS gateway
    const gateway = process.env.IPFS_GATEWAY || "https://gateway.pinata.cloud";
    return `${gateway}/ipfs/${ref}`;
};

/**
 * Is this reference something the app itself serves (rather than an IPFS gateway)?
 */
export const isVaultReference = (ref) =>
    typeof ref === "string" && ref.startsWith(VAULT_PREFIX);

/**
 * Retrieve stored content by reference: the vault for `sha256:` refs, the
 * gateway for an IPFS CID.
 * @param {string} ref - reference returned by uploadToIPFS
 * @returns {Promise<Buffer>} - file content
 */
export const getFromIPFS = async (ref) => {
    try {
        if (isVaultReference(ref)) {
            const found = await resolveVaultFile(ref);
            if (!found) throw new Error("document is no longer in the local vault");
            const buffer = await fs.promises.readFile(found.filePath);
            // Re-hash on the way out: a file edited on disk stops matching here.
            const current = crypto.createHash("sha256").update(buffer).digest("hex");
            if (current !== ref.slice(VAULT_PREFIX.length)) {
                throw new Error("stored bytes no longer match their recorded hash");
            }
            return buffer;
        }
        const url = getIPFSUrl(ref);
        const response = await axios.get(url, {
            responseType: "arraybuffer"
        });
        return Buffer.from(response.data);
    } catch (error) {
        console.error("Error retrieving stored document:", error.message);
        // Keep the reason: callers answer with 409 for "bytes no longer match their
        // hash" and 502 for a plain storage miss, and both need the original text.
        throw new Error(`Failed to retrieve the stored document: ${error.message}`);
    }
};

/**
 * Store vehicle document on IPFS and return hash
 * This is the main function used by the document routes
 */
export const storeVehicleDocument = async (documentBuffer, documentType, vehicleRegNumber, metadata = {}) => {
    try {
        const extension = path.extname(metadata.originalName || "") || ".pdf";
        const fileName = `${documentType}_${vehicleRegNumber}_${Date.now()}${extension}`;

        const enrichedMetadata = {
            documentType,
            vehicleRegNumber,
            ...metadata
        };

        const ipfsHash = await uploadToIPFS(documentBuffer, fileName, enrichedMetadata);

        return {
            ipfsHash,
            ipfsUrl: getIPFSUrl(ipfsHash),
            // Which medium actually holds the bytes - the UI labels it honestly.
            storage: isVaultReference(ipfsHash) ? "local-verified-vault" : "ipfs",
            contentHash: isVaultReference(ipfsHash)
                ? ipfsHash.slice(VAULT_PREFIX.length)
                : null,
            documentType,
            storedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error storing vehicle document:", error.message);
        throw error;
    }
};

/**
 * Store ownership transfer record on IPFS
 * Creates an immutable record of the transfer with all details
 */
export const storeTransferRecord = async (transferData) => {
    try {
        const record = {
            ...transferData,
            timestamp: new Date().toISOString(),
            system: "BioChain RTO",
            version: "1.0"
        };

        // The name is kept beside the bytes and shown on download, so it must not
        // read "transfer_undefined_null.json" when a transfer has no registration
        // number on file or the chain commitment is still pending.
        const regLabel = transferData.vehicleRegNumber || transferData.vehicleId || "vehicle";
        const txLabel = transferData.txHash ? transferData.txHash.slice(2, 14) : "pending";
        const fileName = `transfer_${regLabel}_${txLabel}.json`;
        const ipfsHash = await uploadJSONToIPFS(record, fileName);

        return {
            ipfsHash,
            ipfsUrl: getIPFSUrl(ipfsHash),
            storedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error("Error storing transfer record:", error.message);
        throw error;
    }
};

/**
 * Check that a stored reference can still be served.
 * @param {string} ref - IPFS CID or `sha256:` vault reference
 * @returns {Promise<boolean>} - Whether the content is accessible
 */
export const verifyIPFSHash = async (ref) => {
    try {
        if (isVaultReference(ref)) return !!(await resolveVaultFile(ref));
        const url = getIPFSUrl(ref);
        await axios.head(url, { timeout: 5000 });
        return true;
    } catch (error) {
        console.warn(`Stored reference ${ref} not accessible:`, error.message);
        return false;
    }
};

/**
 * Unpin content from Pinata (when no longer needed)
 * @param {string} ipfsHash - IPFS hash to unpin
 */
export const unpinFromIPFS = async (ipfsHash) => {
    try {
        // Vaulted content is addressed by its own digest; nothing is pinned to
        // unpin, and deleting the bytes would destroy the record's proof.
        if (isVaultReference(ipfsHash)) return;
        if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
            console.warn("Pinata API keys not configured, cannot unpin");
            return;
        }

        await axios.delete(`${PINATA_BASE_URL}/pinning/unpin/${ipfsHash}`, {
            headers: {
                pinata_api_key: PINATA_API_KEY,
                pinata_secret_api_key: PINATA_SECRET_KEY
            }
        });

        console.log(`Unpinned ${ipfsHash} from Pinata`);
    } catch (error) {
        console.error("Error unpinning from IPFS:", error.message);
        throw error;
    }
};
