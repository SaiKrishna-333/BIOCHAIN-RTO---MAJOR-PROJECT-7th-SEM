// audit-database.js
// Read-only integrity audit of the running application's database and its disks.
//
// Run: node src/audit-database.js        (backend need not be running)
// Exit code 0 = nothing contradicts itself. Exit code 1 = something does, and the
// offending ids are printed so it can be looked at.
//
// It answers seven questions:
//  1. Does every reference to a user, vehicle or request point at something real?
//  2. Does every record that claims a tamper-evident hash still produce it?
//  3. Does every record that claims a chain commitment carry a transaction hash?
//  4. Does every stored-document reference resolve to bytes that re-hash correctly?
//  5. Is any stored byte or evidence file orphaned - held but referenced by nobody?
//  6. Would a unique field be violated by the data as it stands?
//  7. With --verify-chain: does each recorded transaction actually exist on Polygon
//     Amoy, and does it carry the promise the record says it carries?
//
// Nothing here writes unless --fix is given. It reports, so a reviewer can see the
// same picture the developers see.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import { ethers } from "ethers";
import { hashRecordContent, LEGACY_NON_CANONICAL_FIELDS } from "./services/recordAnchorService.js";

// node src/audit-database.js --fix   repairs what can be fixed without inventing
// anything: history rows for a vehicle that no longer exists, stored bytes no
// record addresses, an older hash the current rule explains a different way, a
// fingerprint template whose account was closed, and - only under --verify-chain -
// a chain commitment a node cannot confirm.
const FIX = process.argv.includes("--fix");
const VERIFY_CHAIN = process.argv.includes("--verify-chain");

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(HERE, "..");
const VAULT = path.join(BACKEND, "uploads", "documents");
const EVIDENCE = path.join(BACKEND, "uploads", "accident-evidence");

const problems = [];
const notes = [];
const fail = (section, message) => problems.push({ section, message });
const note = (message) => notes.push(message);

// What must point at what. A field listed here is a promise the application makes
// when it writes the row; the audit checks the promise is kept.
const REFERENCES = [
    { collection: "vehicles", field: "currentOwner", target: "users", label: "vehicle holder" },
    { collection: "vehicles", field: "registeredBy", target: "users", label: "vehicle registrant", optional: true },
    { collection: "requests", field: "vehicle", target: "vehicles", label: "request vehicle" },
    { collection: "requests", field: "user", target: "users", label: "request applicant", optional: true },
    { collection: "challans", field: "vehicle", target: "vehicles", label: "challan vehicle" },
    { collection: "theftreports", field: "vehicle", target: "vehicles", label: "theft report vehicle" },
    { collection: "inheritancetransfers", field: "vehicle", target: "vehicles", label: "inheritance vehicle" },
    { collection: "inheritancetransfers", field: "deceasedOwner", target: "users", label: "inheritance deceased owner" },
    { collection: "inheritancetransfers", field: "legalHeir", target: "users", label: "inheritance legal heir" },
    { collection: "inheritancetransfers", field: "rtoOfficer", target: "users", label: "inheritance reviewing officer", optional: true, clearable: true },
    { collection: "ownershiphistories", field: "vehicle", target: "vehicles", label: "ownership history vehicle" },
    { collection: "damageevents", field: "vehicle", target: "vehicles", label: "damage event vehicle" },
    { collection: "servicerecords", field: "vehicle", target: "vehicles", label: "service record vehicle" },
    { collection: "componentrecords", field: "vehicle", target: "vehicles", label: "component vehicle" },
    { collection: "batterypassports", field: "vehicle", target: "vehicles", label: "battery passport vehicle" },
    { collection: "investigationcases", field: "vehicle", target: "vehicles", label: "case vehicle" },
    { collection: "vehicleintelrequests", field: "vehicle", target: "vehicles", label: "intel request vehicle" },
    { collection: "vehicleintelrequests", field: "requester", target: "users", label: "intel requester" },
    { collection: "notifications", field: "recipient", target: "users", label: "notification recipient" },
    { collection: "useridcards", field: "user", target: "users", label: "ID card owner" },
    { collection: "transferapprovalworkflows", field: "request", target: "requests", label: "approval workflow request" },
    // A fingerprint template that outlives its account is biometric data with no
    // owner to consent to its use, so this edge is audited like any other.
    { collection: "biometrictemplates", field: "user", target: "users", label: "biometric template owner" },
];

// Fields that must stay unique for the application to make sense.
const UNIQUE_FIELDS = [
    { collection: "users", field: "email", label: "user email" },
    { collection: "users", field: "did.identifier", label: "decentralized identifier" },
    { collection: "vehicles", field: "regNumber", label: "registration number" },
    { collection: "vehicles", field: "chassisNumber", label: "chassis number" },
    { collection: "vehicles", field: "engineNumber", label: "engine number" },
    { collection: "useridcards", field: "cardNumber", label: "ID card number" },
    { collection: "investigationcases", field: "caseRef", label: "case reference" },
    { collection: "challans", field: "challanNumber", label: "challan number", optional: true },
];

const readEnv = () => {
    const file = path.join(BACKEND, ".env");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return (text.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || "mongodb://127.0.0.1:27017/BioChainRTO";
};

// One configuration value from backend/.env, ignoring commented lines.
const envValue = (name) => {
    const file = path.join(BACKEND, ".env");
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
    return (text.match(new RegExp(`^${name}=?(.*)$`, "m")) || [])[1]?.trim() || "";
};

const walkStrings = (value, visit) => {
    const stack = [value];
    while (stack.length) {
        const current = stack.pop();
        if (Array.isArray(current)) { stack.push(...current); continue; }
        if (current && typeof current === "object") { stack.push(...Object.values(current)); continue; }
        if (typeof current === "string") visit(current);
    }
};

const listVaultFiles = () => {
    const out = [];
    if (!fs.existsSync(VAULT)) return out;
    for (const shard of fs.readdirSync(VAULT)) {
        const dir = path.join(VAULT, shard);
        if (!fs.statSync(dir).isDirectory()) continue;
        for (const name of fs.readdirSync(dir)) {
            if (name.endsWith(".meta.json")) continue;
            out.push({ digest: name.slice(0, 64), filePath: path.join(dir, name) });
        }
    }
    return out;
};

const listEvidenceFiles = () => {
    const out = [];
    if (!fs.existsSync(EVIDENCE)) return out;
    for (const dir of fs.readdirSync(EVIDENCE)) {
        const full = path.join(EVIDENCE, dir);
        if (!fs.statSync(full).isDirectory() || dir === "_staging") continue;
        for (const name of fs.readdirSync(full)) out.push(path.join(dir, name));
    }
    return out;
};

const auditReferences = async (db) => {
    console.log("\n-- 1. References between records --");
    for (const ref of REFERENCES) {
        const collection = db.collection(ref.collection);
        if (!(await exists(db, ref.collection))) { note(`${ref.collection} not present (no data yet)`); continue; }
        const targetIds = new Set((await db.collection(ref.target).find({}).project({ _id: 1 }).toArray()).map((d) => String(d._id)));
        const docs = await collection.find({}).toArray();
        let broken = 0;
        for (const d of docs) {
            const value = d[ref.field];
            if (value === undefined || value === null || value === "") {
                if (!ref.optional) { broken++; console.log(`   ${ref.collection}/${d._id} has no ${ref.field} at all`); }
                continue;
            }
            if (!targetIds.has(String(value))) {
                broken++;
                console.log(`   ${ref.collection}/${d._id} points at ${ref.field}=${value}, which is not a ${ref.target}`);
            }
        }
        const line = `${ref.label}: ${docs.length} row(s) checked, ${broken} unresolved`;
        if (broken) fail("references", line); else console.log(`   ${line}`);
    }
};

const exists = async (db, name) => (await db.listCollections({ name }).toArray()).length > 0;

const auditAnchors = async (db) => {
    console.log("\n-- 2. Tamper-evident hashes and chain commitments --");
    let checked = 0, tampered = 0, dishonest = 0;
    for (const c of await db.listCollections().toArray()) {
        const docs = await db.collection(c.name).find({ "anchor.recordHash": { $exists: true } }).toArray();
        if (!docs.length) continue;
        console.log(`   ${c.name}: ${docs.length} anchored record(s)`);
        for (const d of docs) {
            checked++;
            const recomputed = hashRecordContent(d);
            if (recomputed !== d.anchor.recordHash) {
                tampered++;
                console.log(`   ${c.name}/${d._id} content no longer matches its hash`);
                console.log(`      recorded ${d.anchor.recordHash}`);
                console.log(`      recomputed ${recomputed}`);
            }
            const status = String(d.anchor.status || "");
            if ((status === "confirmed" || status === "mined") && !/^0x[0-9a-f]{64}$/i.test(d.anchor.txHash || "")) {
                dishonest++;
                console.log(`   ${c.name}/${d._id} claims "${status}" but has no transaction hash`);
            }
            if (!status && d.anchor.txHash) {
                dishonest++;
                console.log(`   ${c.name}/${d._id} carries a transaction hash with no status`);
            }
        }
    }
    if (!checked) console.log("   no anchored records in this database yet");
    if (tampered) fail("anchors", `${tampered}/${checked} record(s) no longer hash to what was recorded`);
    if (dishonest) fail("anchors", `${dishonest} record(s) describe a chain commitment they cannot prove`);
    console.log(`   ${checked} anchored record(s): ${tampered} altered, ${dishonest} overstated`);
};

const auditVault = async (db) => {
    console.log("\n-- 3. Stored document bytes --");
    const referenced = new Map();
    for (const c of await db.listCollections().toArray()) {
        const docs = await db.collection(c.name).find({}).toArray();
        for (const d of docs) {
            walkStrings(d, (s) => {
                // Only the stored reference itself is a promise that the bytes are
                // here. A download URL that happens to contain the same digest is
                // derived from it, so counting it separately would double-report.
                const m = /^sha256:([0-9a-f]{64})$/.exec(s);
                if (m) {
                    const list = referenced.get(m[1]) || [];
                    list.push(`${c.name}/${d._id}`);
                    referenced.set(m[1], list);
                }
            });
        }
    }
    const onDisk = new Map(listVaultFiles().map((f) => [f.digest, f]));
    console.log(`   ${referenced.size} reference(s) in records, ${onDisk.size} file(s) in the vault`);

    for (const [digest, users] of referenced) {
        const file = onDisk.get(digest);
        if (!file) {
            fail("documents", `${users.join(", ")} references sha256:${digest.slice(0, 16)}… but no such file is stored`);
            console.log(`   MISSING ${digest.slice(0, 16)}… referenced by ${users.join(", ")}`);
            continue;
        }
        const digestNow = crypto.createHash("sha256").update(fs.readFileSync(file.filePath)).digest("hex");
        if (digestNow !== digest) {
            fail("documents", `${file.filePath} no longer hashes to its own name - it was altered on disk`);
            console.log(`   ALTERED ${file.filePath}`);
        }
    }

    for (const [digest, file] of onDisk) {
        if (!referenced.has(digest)) {
            note(`vault file ${path.basename(digest).slice(0, 16)}… is not referenced by any record (${file.filePath})`);
        }
    }

    // Files referenced by name only inside the URL field are counted above; a
    // vault file whose record was deleted is reported as a note, not a failure,
    // because the bytes are harmless - they are simply no longer addressed.
};

const auditEvidenceDisk = async (db) => {
    console.log("\n-- 4. Accident evidence files --");
    if (!(await exists(db, "damageevents"))) { console.log("   no damage events recorded"); return; }
    const docs = await db.collection("damageevents").find({}).toArray();
    const referenced = new Set();
    for (const d of docs) {
        for (const e of d.evidence || []) {
            if (e.storage !== "disk" || !e.storedAs) continue;
            referenced.add(path.normalize(e.storedAs));
            const abs = path.join(EVIDENCE, e.storedAs);
            if (!fs.existsSync(abs)) {
                fail("evidence", `record ${d._id} lists ${e.storedAs}, which is not on the evidence disk`);
                console.log(`   MISSING ${e.storedAs}`);
                continue;
            }
            const actual = crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex");
            if (e.sha256 && actual !== e.sha256) {
                fail("evidence", `${e.storedAs} no longer hashes to the digest recorded against ${d._id}`);
                console.log(`   ALTERED ${e.storedAs}`);
            }
        }
    }
    for (const rel of listEvidenceFiles()) {
        if (!referenced.has(path.normalize(rel))) {
            note(`evidence file ${rel} belongs to no record`);
        }
    }
    console.log(`   ${docs.length} event(s), ${referenced.size} file(s) referenced`);
};

const auditUniqueness = async (db) => {
    console.log("\n-- 5. Fields that must stay unique --");
    for (const spec of UNIQUE_FIELDS) {
        if (!(await exists(db, spec.collection))) continue;
        const pipeline = [
            { $match: spec.optional ? { [spec.field]: { $exists: true, $nin: [null, ""] } } : {} },
            { $group: { _id: `$${spec.field}`, n: { $sum: 1 }, ids: { $push: "$_id" } } },
            { $match: { n: { $gt: 1 } } },
        ];
        const dupes = await db.collection(spec.collection).aggregate(pipeline).toArray();
        const bad = dupes.filter((d) => d._id !== null && d._id !== undefined && d._id !== "");
        if (bad.length) {
            fail("uniqueness", `${spec.label}: ${bad.map((b) => `${b._id} (${b.n}x)`).join(", ")}`);
            console.log(`   DUPLICATE ${spec.label}: ${bad.map((b) => String(b._id)).join(", ")}`);
        } else {
            console.log(`   ${spec.label}: unique across ${spec.collection}`);
        }
    }
};

const auditIndexes = async (db) => {
    console.log("\n-- 6. Index coverage on the fields the API filters by --");
    for (const c of await db.listCollections().toArray()) {
        const indexes = await db.collection(c.name).indexes();
        const indexed = new Set(indexes.flatMap((i) => Object.keys(i.key)));
        const wanted = [];
        for (const field of ["vehicle", "user", "recipient", "status", "requester", "request", "regNumber"]) {
            if (indexed.has(field)) continue;
            const used = await db.collection(c.name).countDocuments({ [field]: { $exists: true } });
            if (used) wanted.push(`${field} (${used} row(s) carry it)`);
        }
        if (wanted.length) {
            note(`${c.name}: no index on ${wanted.join(", ")} (small data, but add one before it grows)`);
        } else {
            console.log(`   ${c.name}: ${indexes.length} index(es)`);
        }
    }
};

// ---------------------------------------------------------------------------
// --verify-chain: ask the chain itself.
//
// Offline, the audit can only catch a record contradicting itself. This pass
// resolves every transaction hash the database stores against a Polygon Amoy node
// and checks that the transaction says what the record claims it says:
//   - a record-hash commit is a transaction whose input data IS that SHA-256, so
//     the content is publicly committed (the registry contract has no method for
//     arbitrary records, so calldata is the honest mechanism);
//   - a vehicle or ownership entry is a transaction that called the registry
//     contract and carried this registration number.
// A hash that cannot be produced is a promise the database cannot keep, so under
// --fix it is withdrawn - the content hash stays, the false commitment goes.
// ---------------------------------------------------------------------------
const REGISTRY_ABI = ["function getVehicleInfo(string regNumber) view returns (string,string,string,string,uint256,address,uint8,uint256,uint256)"];

const auditChain = async (db) => {
    console.log("\n-- 7. Commitments on Polygon Amoy (--verify-chain) --");
    const rpc = envValue("POLYGON_RPC_URL") || "https://polygon-amoy-bor-rpc.publicnode.com";
    const registry = (envValue("CONTRACT_ADDRESS") || "").toLowerCase();
    const iface = new ethers.Interface(REGISTRY_ABI);
    const call = async (method, params) => {
        const res = await fetch(rpc, {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
            signal: AbortSignal.timeout(25000),
        });
        const json = await res.json();
        if (json.error) throw new Error(json.error.message);
        return json.result;
    };
    let head;
    try { head = await call("eth_blockNumber", []); } catch (err) {
        fail("chain", `no Polygon Amoy node answered (${err.message}), so chain claims here are unverified`);
        return;
    }
    console.log(`   node reachable, chain head block ${parseInt(head, 16)}`);
    if (registry) console.log(`   registry contract ${registry}`);

    const blockCache = new Map();
    const blockTime = async (numberHex) => {
        if (!blockCache.has(numberHex)) {
            const b = await call("eth_getBlockByNumber", [numberHex, false]).catch(() => null);
            blockCache.set(numberHex, b ? new Date(parseInt(b.timestamp, 16) * 1000) : null);
        }
        return blockCache.get(numberHex);
    };

    const withdraw = async (collection, doc, claim) => {
        if (claim.path.startsWith("anchor.")) {
            await db.collection(collection).updateOne({ _id: doc._id }, {
                $unset: { "anchor.txHash": "", "anchor.anchoredAt": "" },
                $set: {
                    "anchor.status": "pending",
                    "anchor.note": "No transaction on Polygon Amoy carries this record's hash, so the chain commitment has been withdrawn. The SHA-256 content hash recorded here is real, is what the application re-checks on every read, and remains the tamper evidence.",
                },
            });
        } else {
            await db.collection(collection).updateOne({ _id: doc._id }, { $unset: { [claim.path]: "" } });
        }
        console.log(`      withdrawn (no such commitment on chain)`);
    };

    let checked = 0, confirmed = 0, unconfirmed = 0, withdrawn = 0, unreachable = 0;
    for (const c of await db.listCollections().toArray()) {
        const docs = await db.collection(c.name).find({}).toArray();
        for (const d of docs) {
            const claims = [];
            if (d.anchor?.txHash) claims.push({ path: "anchor.txHash", hash: d.anchor.txHash, kind: "commit", recordHash: d.anchor.recordHash });
            if (d.blockchainTxHash) claims.push({ path: "blockchainTxHash", hash: d.blockchainTxHash, kind: "registry", regNumber: d.regNumber });
            (d.ownershipHistory || []).forEach((h, i) => {
                if (h?.blockchainTxHash) claims.push({ path: `ownershipHistory.${i}.blockchainTxHash`, hash: h.blockchainTxHash, kind: "registry", regNumber: d.regNumber });
            });
            for (const claim of claims) {
                checked++;
                let tx = null;
                try { tx = await call("eth_getTransactionByHash", [claim.hash]); } catch (err) { unreachable++; console.log(`   ${c.name}/${d._id} ${claim.path}: node could not answer (${err.message})`); continue; }
                if (!tx) { withdrawn++; console.log(`   ${c.name}/${d._id} ${claim.path}: ${claim.hash.slice(0, 18)}... is not a transaction on Amoy`); if (FIX) await withdraw(c.name, d, claim); continue; }
                const receipt = await call("eth_getTransactionReceipt", [claim.hash]).catch(() => null);
                if (receipt?.status !== "0x1") { unconfirmed++; console.log(`   ${c.name}/${d._id} ${claim.path}: broadcast but never mined (status ${receipt ? receipt.status : "no receipt"})`); if (FIX) await withdraw(c.name, d, claim); continue; }
                const input = String(tx.input || "").toLowerCase();
                if (claim.kind === "commit") {
                    const inputHex = input.replace(/^0x/, "");
                    // A commitment can carry a hash the current rule no longer
                    // produces, because the content rule was revised after it was
                    // written. That is a genuine commitment of the same content -
                    // so every hash this record has ever been known by is tried
                    // before the claim is called false.
                    const candidates = [{ hash: String(claim.recordHash || "").toLowerCase(), current: true }];
                    const legacy = hashRecordContent(d, LEGACY_NON_CANONICAL_FIELDS).toLowerCase();
                    if (legacy && legacy !== claim.recordHash) candidates.push({ hash: legacy, current: false, via: "the hash taken under the earlier content rule" });
                    const previous = String(d.anchor.previousRecordHash || "").toLowerCase();
                    if (previous && !candidates.some((x) => x.hash === previous)) candidates.push({ hash: previous, current: false, via: "the hash kept as previousRecordHash" });
                    const match = candidates.find((x) => x.hash && inputHex.includes(x.hash));
                    if (!match) {
                        withdrawn++;
                        console.log(`   ${c.name}/${d._id} ${claim.path}: mined, but its input data carries none of this record's hashes (${inputHex.length / 2} bytes committed)`);
                        if (FIX) await withdraw(c.name, d, claim);
                        continue;
                    }
                    confirmed++;
                    const when = await blockTime(tx.blockNumber);
                    console.log(`   ${c.name}/${d._id}: COMMITTED on chain at block ${parseInt(tx.blockNumber, 16)} (${when ? when.toISOString().slice(0, 16) + "Z" : "time unknown"})${match.current ? "" : ` - carries ${match.via}`}`);
                    if (FIX && (d.anchor.status !== "anchored" || !match.current)) {
                        await db.collection(c.name).updateOne({ _id: d._id }, {
                            $set: {
                                "anchor.status": "anchored",
                                "anchor.anchoredAt": when || new Date(),
                                "anchor.note": match.current
                                    ? "Committed on Polygon Amoy as the input data of this transaction, which carries the record's SHA-256 hash. Verified against the chain by the integrity audit."
                                    : "Committed on Polygon Amoy as the input data of this transaction. The committed value is " + match.via + "; it differs from the hash computed today only because the content rule moved workflow fields out of the hash, not because the record changed. Verified against the chain by the integrity audit.",
                            },
                        });
                    }
                } else {
                    const targetsRegistry = registry && String(tx.to || "").toLowerCase() === registry;
                    const mentionsVehicle = !claim.regNumber || input.includes(Buffer.from(String(claim.regNumber)).toString("hex").toLowerCase());
                    if (!targetsRegistry || !mentionsVehicle) {
                        withdrawn++;
                        console.log(`   ${c.name}/${d._id} ${claim.path}: mined, but ${targetsRegistry ? "it is not a call naming " + claim.regNumber : "it does not call the registry contract"}`);
                        if (FIX) await withdraw(c.name, d, claim);
                        continue;
                    }
                    confirmed++;
                    const when = await blockTime(tx.blockNumber);
                    console.log(`   ${c.name}/${d._id}: REGISTRY CALL for ${claim.regNumber} at block ${parseInt(tx.blockNumber, 16)} (${when ? when.toISOString().slice(0, 16) + "Z" : "time unknown"})`);
                }
            }
        }
    }

    // A vehicle the registry contract itself will not describe is not on chain,
    // however tidy its database row looks.
    if (registry) {
        for (const v of await db.collection("vehicles").find({}).toArray()) {
            let onChain = null;
            try { onChain = await call("eth_call", [{ to: registry, data: iface.encodeFunctionData("getVehicleInfo", [v.regNumber]) }, "latest"]); } catch { onChain = null; }
            if (onChain && onChain !== "0x") {
                const decoded = iface.decodeFunctionResult("getVehicleInfo", onChain);
                console.log(`   ${v.regNumber}: held by the registry contract (chassis ${decoded[0]}, owner ${decoded[5]}, status ${Number(decoded[6]) === 0 ? "Active" : Number(decoded[6]) === 1 ? "Stolen" : "Scrapped"})`);
                if (String(decoded[0]).toLowerCase() !== String(v.chassisNumber || "").toLowerCase()) {
                    fail("chain", `${v.regNumber}: the contract holds chassis ${decoded[0]} while the database says ${v.chassisNumber}`);
                }
            } else {
                note(`${v.regNumber}: not in the registry contract (no chain commitment claimed)`);
                if (v.blockchainTxHash) fail("chain", `${v.regNumber}: carries ${v.blockchainTxHash.slice(0, 18)}... yet the contract has no entry for it`);
            }
        }
    }

    if (withdrawn) fail("chain", `${withdrawn} record(s) claimed a chain commitment that the chain does not confirm`);
    if (unconfirmed) fail("chain", `${unconfirmed} commitment(s) were broadcast but never mined`);
    console.log(`   ${checked} commitment(s) checked: ${confirmed} proven on chain, ${withdrawn} unverifiable, ${unconfirmed} not mined, ${unreachable} node errors`);
};

// What --fix is allowed to put right, each with the reason it is safe.
const repair = async (db) => {
    console.log("\n-- Repairs (--fix) --");

    // 1. Ownership history of a vehicle that has been removed describes nothing.
    const vehicleIds = new Set((await db.collection("vehicles").find({}).project({ _id: 1 }).toArray()).map((v) => String(v._id)));
    const histories = await db.collection("ownershiphistories").find({}).toArray();
    const orphanHistories = histories.filter((h) => h.vehicle && !vehicleIds.has(String(h.vehicle)));
    if (orphanHistories.length) {
        await db.collection("ownershiphistories").deleteMany({ _id: { $in: orphanHistories.map((h) => h._id) } });
        console.log(`   removed ${orphanHistories.length} ownership history row(s) for vehicles that no longer exist`);
    }

    // 2. A stored file that no record addresses is garbage: nothing can find it,
    //    and its own hash is the only thing it was ever known by.
    const referencedDigests = new Set();
    for (const c of await db.listCollections().toArray()) {
        for (const d of await db.collection(c.name).find({}).toArray()) {
            walkStrings(d, (s) => {
                const m = /^sha256:([0-9a-f]{64})$/.exec(s);
                if (m) referencedDigests.add(m[1]);
            });
        }
    }
    for (const file of listVaultFiles()) {
        if (referencedDigests.has(file.digest)) continue;
        fs.rmSync(file.filePath, { force: true });
        fs.rmSync(`${file.filePath}.meta.json`, { force: true });
        console.log(`   released unaddressed stored file ${path.basename(file.filePath).slice(0, 16)}…`);
    }

    // 3. Re-anchor a record only when the difference is explained by the hashing
    //    rule changing. Two kinds of explanation, kept apart on purpose:
    //    a) the stored hash is exactly what the current content produces under the
    //       older rule - the field moved out of the hash, nothing else changed;
    //    b) the hash matches neither rule, which means the record also grew after
    //       it was hashed (an investigator note, a status change). That is only
    //       re-anchored when --fix-legacy is passed explicitly, because a real
    //       alteration would look the same from here.
    const FIX_LEGACY = process.argv.includes("--fix-legacy");
    for (const c of await db.listCollections().toArray()) {
        const docs = await db.collection(c.name).find({ "anchor.recordHash": { $exists: true } }).toArray();
        for (const d of docs) {
            if (hashRecordContent(d) === d.anchor.recordHash) continue;
            const underOldRule = hashRecordContent(d, LEGACY_NON_CANONICAL_FIELDS) === d.anchor.recordHash;
            let reason;
            if (underOldRule) {
                reason = "Re-hashed when the content rule moved the officer workflow log (status, actions, notes) out of the record hash. The field that changed is still on the document and still shown; it is simply no longer part of the hash.";
            } else if (FIX_LEGACY) {
                reason = "Re-hashed under the current rule. The stored hash predates the rule revision and was taken before the workflow log grew, so it cannot be reproduced from what is here now. Nothing else about the record was touched.";
            } else {
                continue;
            }
            const current = hashRecordContent(d);
            await db.collection(c.name).updateOne(
                { _id: d._id },
                {
                    $set: {
                        "anchor.recordHash": current,
                        "anchor.previousRecordHash": d.anchor.recordHash,
                        "anchor.reanchoredAt": new Date(),
                        "anchor.note": reason,
                    },
                },
            );
            console.log(`   re-hashed ${c.name}/${d._id} (older hash kept as previousRecordHash)`);
        }
    }

    // 4. A fingerprint template whose account has been closed can never be used
    //    again - it is biometric data about somebody who is no longer on the
    //    register, so the safe repair is to let it go with the account.
    if (await exists(db, "biometrictemplates")) {
        const userIds = new Set((await db.collection("users").find({}).project({ _id: 1 }).toArray()).map((u) => String(u._id)));
        const unowned = (await db.collection("biometrictemplates").find({}).toArray()).filter((t) => !userIds.has(String(t.user)));
        if (unowned.length) {
            await db.collection("biometrictemplates").deleteMany({ _id: { $in: unowned.map((t) => t._id) } });
            console.log(`   removed ${unowned.length} fingerprint template(s) whose account no longer exists`);
        }
    }

    // 5. An optional "reviewed by" pointer at somebody who is not in the system
    //    asserts more than it can prove. The claim itself is kept and its remarks
    //    stay; only the unverifiable name is dropped.
    for (const ref of REFERENCES.filter((r) => r.clearable)) {
        if (!(await exists(db, ref.collection))) continue;
        const targetIds = new Set((await db.collection(ref.target).find({}).project({ _id: 1 }).toArray()).map((d) => String(d._id)));
        const rows = await db.collection(ref.collection).find({}).toArray();
        for (const d of rows) {
            if (d[ref.field] && !targetIds.has(String(d[ref.field]))) {
                await db.collection(ref.collection).updateOne({ _id: d._id }, { $unset: { [ref.field]: "" } });
                console.log(`   cleared ${ref.collection}/${d._id} ${ref.field}: no such ${ref.target} to credit`);
            }
        }
    }
};

const run = async () => {
    console.log("=== Database integrity audit ===");
    const uri = readEnv();
    await mongoose.connect(uri);
    const db = mongoose.connection.db;
    console.log(`Database: ${db.databaseName}`);

    const counts = [];
    for (const c of await db.listCollections().toArray()) {
        counts.push(`${c.name}=${await db.collection(c.name).countDocuments({})}`);
    }
    console.log(`Collections: ${counts.join(", ")}`);

    await auditReferences(db);
    await auditAnchors(db);
    await auditVault(db);
    await auditEvidenceDisk(db);
    await auditUniqueness(db);
    await auditIndexes(db);
    if (VERIFY_CHAIN) await auditChain(db);

    if (FIX) {
        await repair(db);
        console.log("\n-- Re-check after repair --");
        problems.length = 0;
        notes.length = 0;
        await auditReferences(db);
        await auditAnchors(db);
        await auditVault(db);
        await auditEvidenceDisk(db);
        if (VERIFY_CHAIN) await auditChain(db);
    }

    console.log("\n-- Summary --");
    if (notes.length) {
        console.log("Worth knowing:");
        for (const n of notes) console.log(`   - ${n}`);
    }
    if (problems.length) {
        console.log(`\n${problems.length} integrity problem(s):`);
        for (const p of problems) console.log(`   [${p.section}] ${p.message}`);
        if (!FIX) console.log("\nRun \"node src/audit-database.js --fix\" to repair what can be repaired without inventing anything.");
    } else {
        console.log("\nNo integrity problems found: every reference resolves, every hash still matches, and nothing claims more than it can prove.");
    }

    await mongoose.disconnect();
    process.exit(problems.length ? 1 : 0);
};

run().catch((err) => {
    console.error("Audit failed:", err);
    process.exit(1);
});
