// recordAnchorService.js
// Shared tamper-evident anchoring helper for the Vehicle Intelligence features
// (service/odometer history, parts provenance, damage passport, battery passport,
// investigation casebook, transfer approvals).
//
// Design:
// - The canonical SHA-256 record hash is ALWAYS stored in MongoDB. This is the
// primary tamper-evident mechanism and works even when chain is unavailable.
// - On-chain: if a dedicated anchor contract is configured (ANCHOR_CONTRACT_ADDRESS)
// we call anchorRecord(bytes32) on it. Otherwise the hash is committed as the
// input data of a zero-value Polygon Amoy transaction (standard calldata
// anchoring - no contract required). Every anchored record therefore gets a
// REAL transaction hash the UI can open in the explorer, exactly like the
// registration/transfer flows. Set ANCHOR_TX=false to skip on-chain commits.
// - If submission fails (rate-limited demo RPC etc.) the record degrades
// honestly to "pending" - never a fake link, never a thrown error.
// - Personal data never leaves the database; only the 32-byte hash is anchored.

import crypto from "crypto";
import { ethers } from "ethers";
import { resolveFeeCaps, estimateLimit, affordabilityGap } from "./feePolicy.js";

// Minimal ABI for a future dedicated anchor contract (not the VehicleRegistry).
// If/when such a contract is deployed, set ANCHOR_CONTRACT_ADDRESS in .env.
const ANCHOR_ABI = [
    "function anchorRecord(bytes32 recordHash) external",
    "function getAnchor(bytes32 recordHash) view returns (uint256)"
];

/**
 * Produce a canonical JSON string so the same logical record always
 * yields the same hash regardless of key insertion order.
 */
export const canonicalize = (obj) => {
    if (obj === null || typeof obj !== "object") {
        return typeof obj === "undefined" ? null : JSON.stringify(obj);
    }
    if (Array.isArray(obj)) {
        return "[" + obj.map(canonicalize).join(",") + "]";
    }
    const keys = Object.keys(obj).sort();
    return "{" + keys
        .filter(k => obj[k] !== undefined)
        .map(k => JSON.stringify(k) + ":" + canonicalize(obj[k]))
        .join(",") + "}";
};

/**
 * Compute the tamper-evident SHA-256 hash of a structured record.
 * Dates/numbers are normalized so equivalent records hash identically.
 */
export const computeRecordHash = (record) => {
    const normalized = JSON.parse(canonicalize(toPlainObject(record)));
    const canon = canonicalize(normalized);
    return crypto.createHash("sha256").update(canon).digest("hex");
};

// Convert Mongoose docs / Dates / ObjectIds into plain serializable values
function toPlainObject(record) {
    if (record === null || record === undefined) return record;
    if (typeof record.toJSON === "function") record = record.toJSON();
    if (record instanceof Date) return record.toISOString();
    if (Array.isArray(record)) return record.map(toPlainObject);
    if (typeof record === "object") {
        const out = {};
        for (const k of Object.keys(record)) {
            const v = record[k];
            if (v instanceof Date) out[k] = v.toISOString();
            else if (v && typeof v === "object" && !Array.isArray(v) && v.toString && /^[0-9a-fA-F]{24}$/.test(v.toString())) out[k] = v.toString();
            else if (v && typeof v === "object") out[k] = toPlainObject(v);
            else out[k] = v;
        }
        return out;
    }
    return record;
}

// Fields excluded from the hash because they change after finalization:
// - anchor / timestamps / revisions: bookkeeping
// - corrections: append-only audit entries added after the record was hashed
// - verification metadata: an officer reviewing a record must not make that
//   record look tampered. The submitted content stays hashed; the finding is
//   stored alongside it.
// - case workflow (status, assignedOfficer, actions, notes, related*): an
//   investigation case is hashed when it is opened, but the log of what officers
//   did afterwards grows on the same document. Those entries are still stored and
//   still shown in the UI - they are simply not part of the promise "this case is
//   exactly as alleged". Without this split, adding a note would make every case
//   look as though it had been tampered with.
export const NON_CANONICAL_FIELDS = [
    "anchor", "updatedAt", "createdAt", "__v", "_id", "corrections",
    "verificationStatus", "verifiedBy", "verifiedAt", "officerReview",
    "status", "assignedOfficer", "actions", "notes", "relatedRequests", "relatedAlerts",
];

// The list as it stood before the case-workflow fields were separated out. Kept
// so an audit can recognise a hash produced under the old rule, instead of
// reporting every older record as altered.
export const LEGACY_NON_CANONICAL_FIELDS = [
    "anchor", "updatedAt", "createdAt", "__v", "_id", "corrections",
    "verificationStatus", "verifiedBy", "verifiedAt", "officerReview",
];

// Evidence arrays (see the reduction inside hashRecordContent) hold the file
// bytes or a disk reference plus a per-file SHA-256. Bytes must never enter the
// record hash: they are large, and every file is already checked individually
// against its own sha256. The hash keeps only the sorted set of those per-file
// digests, so the record still proves which files belonged to it - deleting or
// swapping one changes the set and the record hash stops matching.

/**
 * Hash only the immutable content fields of a record (excludes anchor metadata
 * and timestamps that mutate) so verification stays stable. `excludeFields` lets
 * a caller re-hash under a different rule - used by the integrity audit to tell a
 * rule revision apart from real alteration.
 */
export const hashRecordContent = (record, excludeFields = NON_CANONICAL_FIELDS) => {
    const plain = toPlainObject(record);
    const content = {};
    for (const k of Object.keys(plain)) {
        if (excludeFields.includes(k)) continue;
        content[k] = plain[k];
    }
    for (const k of Object.keys(content)) {
        const v = content[k];
        if (!Array.isArray(v)) continue;
        const items = v.filter((i) => i && typeof i === "object" && typeof i.sha256 === "string");
        if (items.length && items.length === v.length) {
            content[k] = items.map((i) => i.sha256).sort();
        }
    }
    return computeRecordHash(content);
};

/**
 * Anchor a finalized record hash. Returns the anchor metadata object to be
 * stored on the document. Never throws — chain problems degrade to "pending".
 */
let cachedSigner = null;
const getAnchorSigner = () => {
    if (process.env.ANCHOR_TX === "false") return null;
    if (!process.env.WALLET_PRIVATE_KEY) return null;
    if (!cachedSigner) {
        const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com");
        cachedSigner = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);
    }
    return cachedSigner;
};

export const anchorRecord = async (record, label = "record") => {
    const recordHash = hashRecordContent(record);
    const anchor = {
        algorithm: "sha256",
        recordHash,
        status: "hashed_only", // hashed_only | pending | anchored | failed
        network: "polygon-amoy",
        txHash: null,
        anchoredAt: null,
        note: null
    };

    const anchorContractAddress = process.env.ANCHOR_CONTRACT_ADDRESS;
    if (!anchorContractAddress) {
        // No dedicated contract: commit the hash as calldata of a real Amoy tx.
        const signer = getAnchorSigner();
        if (!signer) {
            anchor.status = "pending";
            anchor.note = "Record hash stored in MongoDB. On-chain commit skipped (no ANCHOR_CONTRACT_ADDRESS / wallet configured, or ANCHOR_TX=false).";
            return anchor;
        }
        // Self-send: the VehicleRegistry contract has no payable fallback, so
        // raw-calldata txs to it revert. An EOA self-transfer carries the hash as
        // public input data - the standard off-chain-record anchoring pattern.
        const to = await signer.getAddress();
        let tx;
        try {
            // Price the commit the way the network actually demands (Amoy enforces a
            // minimum tip) and confirm the wallet can pay BEFORE broadcasting.
            // Without this the node drops every attempt and the log fills with warnings.
            const caps = await resolveFeeCaps(signer.provider);
            const request = { to, value: 0, data: "0x" + recordHash };
            const gasLimit = (await estimateLimit(signer, request)) ?? 40000n;
            const gap = await affordabilityGap(signer, gasLimit, caps.maxFeePerGas).catch(() => null);
            if (gap) {
                anchor.status = "pending";
                anchor.note = `On-chain commit not attempted - ${gap}`;
                return anchor;
            }
            try {
                tx = await signer.sendTransaction({ ...request, ...caps, gasLimit });
            } catch (sendErr) {
                // Load-balanced public RPCs can briefly report a stale nonce, making
                // the node see this as an under-priced replacement. One short retry
                // with the fresh pending nonce recovers almost every such case.
                if (!/replacement fee too low|nonce too low|already known/i.test(sendErr.message || "")) throw sendErr;
                await new Promise((r) => setTimeout(r, 4000));
                const nonce = await signer.provider.getTransactionCount(to, "pending");
                tx = await signer.sendTransaction({ ...request, ...caps, gasLimit, nonce });
            }
        } catch (err) {
            console.warn(`On-chain anchor tx not submitted for ${label}: ${err.shortMessage || err.message}`);
            anchor.status = "pending";
            anchor.note = `On-chain commit not submitted (${err.shortMessage || err.message}); record stays protected by its database hash.`;
            return anchor;
        }
        anchor.txHash = tx.hash;
        // Real tx submitted; its explorer page shows the live confirmation state.
        anchor.status = "pending";
        anchor.note = "Record hash committed on Polygon Amoy as transaction input data. Open the transaction in the explorer to see its confirmation state and the anchored hash in the input data.";
        // Await the receipt in the background only to surface a revert; the stored
        // status stays "pending", which the UI renders honestly either way.
        tx.wait()
            .then((r) => { if (r.status !== 1) console.warn(`Anchor tx reverted: ${tx.hash}`); })
            .catch(() => { });
        return anchor;
    }

    try {
        const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com");
        const signer = new ethers.Wallet(process.env.WALLET_PRIVATE_KEY, provider);
        const anchorContract = new ethers.Contract(anchorContractAddress, ANCHOR_ABI, signer);
        const bytes32 = "0x" + recordHash;
        const tx = await anchorContract.anchorRecord(bytes32, await resolveFeeCaps(provider));
        const receipt = await tx.wait();
        anchor.status = "anchored";
        anchor.txHash = receipt.hash;
        anchor.anchoredAt = new Date();
    } catch (err) {
        console.warn(`On-chain anchor failed for ${label}: ${err.message}`);
        anchor.status = "failed";
        anchor.note = `On-chain anchoring attempted but failed: ${err.message}. Database hash remains the source of truth.`;
    }
    return anchor;
};

/**
 * Verify that a record's current content still matches its stored anchor hash.
 */
export const verifyRecordIntegrity = (record) => {
    if (!record?.anchor?.recordHash) {
        return { verified: false, reason: "No anchor hash recorded for this entry." };
    }
    const currentHash = hashRecordContent(record);
    const match = currentHash === record.anchor.recordHash;
    return {
        verified: match,
        currentHash,
        storedHash: record.anchor.recordHash,
        anchorStatus: record.anchor.status,
        txHash: record.anchor.txHash,
        reason: match
            ? "Content matches the tamper-evident hash recorded at finalization."
            : "Content has changed since the hash was recorded — review this entry."
    };
};

/**
 * Verify a file buffer against a previously recorded SHA-256.
 * Used by the casebook / damage passport evidence checks. A match proves the
 * file has not been altered since hashing; it does not prove truthfulness of
 * the original content.
 */
export const verifyFileHash = (buffer, recordedSha256Hex) => {
    const current = crypto.createHash("sha256").update(buffer).digest("hex");
    return {
        verified: current.toLowerCase() === String(recordedSha256Hex || "").toLowerCase(),
        currentHash: current,
        recordedHash: recordedSha256Hex
    };
};

export const hashFileBuffer = (buffer) =>
    crypto.createHash("sha256").update(buffer).digest("hex");
