// test-accident-evidence.js
// Smoke test for the owner accident-evidence upload + officer verification flow.
// Run with the backend up: node src/test-accident-evidence.js
//
// Flow proven: owner uploads dashcam media with an accident statement -> police
// and RTO are alerted and see it in a review queue -> the media can be streamed
// back (including a byte Range) -> each file re-hashes to what was recorded ->
// an officer's finding is stored beside the statement without rewriting it.
// Everything it creates (the record, the media files on disk, any test user) is
// removed at the end.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const BASE = "http://localhost:5000/api";
const startTs = new Date();
let passed = 0, failed = 0, reported = false;
const createdEventIds = [];
const createdMediaPaths = [];
const createdUserIds = [];

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

// multipart upload with one file part
const formWithFile = async (p, fields, file, token) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null) fd.append(k, String(v));
    }
    if (file) {
        const blob = new Blob([file.bytes], { type: file.type });
        fd.append("media", blob, file.name);
    }
    const res = await fetch(BASE + p, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

// urlencoded-style multipart POST without files (used to register a temp workshop)
const formJson = async (p, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const res = await fetch(BASE + p, { method: "POST", body: fd });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

// Deterministic fake clip: bytes are what they are, nothing is invented about
// their content, and the hash assertions compare like-for-like digests.
const fakeClip = (marker) => {
    const head = new Uint8Array(64);
    new TextEncoder().encodeInto(`DASHCAM-CLIP ${marker}`, head);
    return head;
};

const login = async (email, password) => {
    const r = await json("/auth/login", { method: "POST", body: { email, password } });
    return r.data?.token || null;
};

// Anything a previous crashed run left behind: the suite records itself and the
// batches its media lived in, plus half-written files still in staging.
const sweepLeftovers = async (mongoose) => {
    const db = mongoose.connection.db;
    const orphans = await db.collection("damageevents")
        .find({ sourceChannel: "owner-upload", description: /^Suite test/ })
        .project({ evidence: 1 })
        .toArray();
    for (const o of orphans) {
        for (const f of o.evidence || []) {
            if (f.storage === "disk" && f.storedAs) {
                fs.rmSync(path.dirname(path.resolve("uploads/accident-evidence", f.storedAs)), { recursive: true, force: true });
            }
        }
    }
    if (orphans.length) await db.collection("damageevents").deleteMany({ _id: { $in: orphans.map((o) => o._id) } });
    // A staged file is moved out on success, so one that has sat here for more than
    // ten minutes belongs to an upload that never finished. Anything newer is left
    // alone, because it could be somebody else's upload in flight.
    const root = path.resolve("uploads/accident-evidence");
    const staging = path.join(root, "_staging");
    if (fs.existsSync(staging)) {
        const cutoff = Date.now() - 10 * 60 * 1000;
        for (const name of fs.readdirSync(staging)) {
            const p = path.join(staging, name);
            if (fs.statSync(p).mtimeMs < cutoff) fs.rmSync(p, { force: true });
        }
    }
    if (orphans.length) console.log(` [NOTE] removed ${orphans.length} leftover record(s) from an earlier interrupted run`);
};

const run = async () => {
    console.log("\n=== Owner Accident Evidence upload + officer verification ===\n");

    const { default: mongoose } = await import("mongoose");
    const envFile = new URL("../.env", import.meta.url);
    const envText = fs.existsSync(envFile) ? fs.readFileSync(envFile, "utf8") : "";
    const mongoUri = (envText.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || "mongodb://127.0.0.1:27017/BioChainRTO";
    await mongoose.connect(mongoUri);
    await sweepLeftovers(mongoose);

    const ownerToken = await login("owner@biochain.com", "owner123");
    check("Owner login", !!ownerToken);
    if (!ownerToken) return report();

    const policeToken = await login("police@biochain.com", "police123");
    const rtoToken = await login("ka.rto@biochain.com", "ka123");
    const dealerToken = await login("dealer@biochain.com", "dealer123");
    check("Police, RTO and dealer logins", !!policeToken && !!rtoToken && !!dealerToken);

    const mine = await json("/vehicles/my", {}, ownerToken);
    const vehicle = (mine.data.vehicles || mine.data || [])[0];
    check("Owner holds a vehicle to report against", !!vehicle?._id, `(status ${mine.status})`);
    if (!vehicle?._id) return report();

    const claimUrl = `/vehicle-intelligence/vehicle-history/${vehicle._id}/accident-upload`;
    const base = {
        eventDate: "2026-09-14",
        description: "Suite test: rear-ended at a signal, dashcam captured the impact.",
        location: "Suite Road, Hyderabad",
        severity: "moderate",
        injuries: "none",
        oppositePartyRegNumber: "TS07ZZ9999",
        oppositePartyName: "Suite Opposite Party",
        policeStation: "Banjara Hills",
        firNumber: "SUITE-FIR-1",
    };

    // ---- Access rules ----
    const noMedia = await formWithFile(claimUrl, base, null, ownerToken);
    check("Submission without any media is refused", noMedia.status === 400 && Array.isArray(noMedia.data.errors), `(${noMedia.status})`);

    const future = await formWithFile(claimUrl, { ...base, eventDate: "2099-01-01" }, { name: "f.mp4", type: "video/mp4", bytes: fakeClip("f") }, ownerToken);
    check("Future accident date refused", future.status === 400 && /future/i.test(JSON.stringify(future.data)), `(${future.status})`);

    const badType = await formWithFile(claimUrl, base, { name: "x.exe", type: "application/x-msdownload", bytes: fakeClip("x") }, ownerToken);
    check("Non-media file type refused with a clear reason", badType.status === 400 && /Unsupported evidence type/.test(JSON.stringify(badType.data)), `(${badType.status} ${JSON.stringify(badType.data).slice(0, 120)})`);

    const asDealer = await formWithFile(claimUrl, base, { name: "d.mp4", type: "video/mp4", bytes: fakeClip("d") }, dealerToken);
    check("Dealer cannot submit an owner accident report", asDealer.status === 403, `(${asDealer.status})`);

    const otherOwnerToken = await login("owner2@biochain.com", "owner123");
    if (otherOwnerToken) {
        const notMine = await formWithFile(claimUrl, base, { name: "n.mp4", type: "video/mp4", bytes: fakeClip("n") }, otherOwnerToken);
        check("A different owner cannot upload onto this vehicle", notMine.status === 403, `(${notMine.status})`);
    } else {
        console.log(" [NOTE] owner2 account absent, cross-owner check skipped");
    }

    // ---- Accepted upload ----
    const uploaded = await formWithFile(claimUrl, base, { name: "dashcam-front.mp4", type: "video/mp4", bytes: fakeClip("A") }, ownerToken);
    const ev = uploaded.data?.event;
    check("Owner upload accepted", uploaded.status === 201 && !!ev?._id, `(${uploaded.status} ${JSON.stringify(uploaded.data).slice(0, 160)})`);
    if (!ev?._id) return report();
    createdEventIds.push(ev._id);

    check("Recorded as REPORTED, not verified", ev.verificationStatus === "reported");
    check("Recorded on the owner-upload channel", ev.sourceChannel === "owner-upload");
    check("Accident details stored in structured fields", ev.accident?.oppositePartyRegNumber === "TS07ZZ9999" && ev.accident?.firNumber === "SUITE-FIR-1" && ev.accident?.location === "Suite Road, Hyderabad");
    check("Evidence carries a SHA-256 taken at upload", /^[0-9a-f]{64}$/.test(ev.evidence?.[0]?.sha256 || ""), `(${ev.evidence?.[0]?.sha256})`);
    check("Response hides the server file path", ev.evidence?.[0]?.storedAs === undefined, `(${ev.evidence?.[0]?.storedAs})`);
    check("Record has a tamper-evident hash", /^[0-9a-f]{64}$/.test(ev.anchor?.recordHash || ""));

    // The stored reference is server-side detail, so it is read from the database
    // rather than expected from an API response.
    const doc = await mongoose.connection.db.collection("damageevents").findOne({ _id: new mongoose.Types.ObjectId(ev._id) });
    const storedAs = doc?.evidence?.[0]?.storedAs;
    check("Media stored on the evidence disk, not in the document", doc?.evidence?.[0]?.storage === "disk" && !!storedAs, `(${doc?.evidence?.[0]?.storage})`);
    check("Original bytes are not held in the record", doc?.evidence?.[0]?.data === undefined, `(${typeof doc?.evidence?.[0]?.data})`);
    if (storedAs) createdMediaPaths.push(storedAs);

    const abs = path.resolve("uploads/accident-evidence", storedAs || "missing");
    check("The uploaded file exists on the evidence disk", fs.existsSync(abs), `(${abs})`);

    // The on-chain commitment must tell the truth about itself: either a real
    // transaction was submitted, or the record explains why it was not - with a
    // reason somebody can act on, never an invented explorer link.
    const anchor = doc?.anchor || {};
    if (anchor.txHash) {
        check("A committed record carries a real transaction hash", /^0x[0-9a-f]{64}$/.test(anchor.txHash), `(${anchor.txHash})`);
    } else {
        check("An uncommitted record stays honestly 'pending'", anchor.status === "pending", `(${anchor.status})`);
        check("And explains why no transaction was made", /not attempted|not submitted|skipped/i.test(anchor.note || ""), `(${(anchor.note || "").slice(0, 80)})`);
        check("Naming the wallet funding limit, which is actionable", /wallet holds [\d.]+ POL/.test(anchor.note || ""), `(${(anchor.note || "").slice(0, 120)})`);
    }

    // ---- Officer queue ----
    const queue = await json("/vehicle-intelligence/accident-uploads?status=pending", {}, policeToken);
    const row = (queue.data.uploads || []).find((u) => u._id === ev._id);
    check("Police review queue lists the submission", queue.status === 200 && !!row, `(${queue.status})`);
    check("Queue row carries the owner contact for follow-up", !!row?.owner?.email && !!row?.owner?.name);
    check("Queue row lists the media with its hash", row?.media?.[0]?.sha256 === ev.evidence[0].sha256 && row.media[0].isVideo === true);
    check("Queue marks the account as unproven", /does not prove/.test(queue.data.note || ""));

    const rtoQueue = await json("/vehicle-intelligence/accident-uploads?status=pending", {}, rtoToken);
    check("RTO queue lists the same submission", rtoQueue.status === 200 && (rtoQueue.data.uploads || []).some((u) => u._id === ev._id));

    const dealerQueue = await json("/vehicle-intelligence/accident-uploads", {}, dealerToken);
    check("Dealer is blocked from the officer queue", dealerQueue.status === 403, `(${dealerQueue.status})`);

    const alert = await json("/notifications?limit=50", {}, policeToken);
    const alertText = JSON.stringify(alert.data);
    check("Police were alerted on upload", /Accident evidence uploaded/.test(alertText));
    const ownerAlerts = await json("/notifications?limit=50", {}, ownerToken);
    check("Owner was not spammed with their own alert", !/Accident evidence uploaded/.test(JSON.stringify(ownerAlerts.data)));

    // ---- Evidence retrieval ----
    const mediaUrl = `/vehicle-intelligence/accident-uploads/${ev._id}/media/0`;
    const full = await fetch(BASE + mediaUrl, { headers: { Authorization: `Bearer ${policeToken}` } });
    const bytes = new Uint8Array(await full.arrayBuffer());
    check("Officer can retrieve the file", full.status === 200 && bytes.length === 64, `(${full.status} len=${bytes.length})`);
    check("Served with the recorded content type", (full.headers.get("content-type") || "").includes("video/mp4"), `(${full.headers.get("content-type")})`);
    check("Retrieved bytes match the recorded hash", Buffer.from(bytes).toString("hex") === Buffer.from(fakeClip("A")).toString("hex"));

    const ranged = await fetch(BASE + mediaUrl, { headers: { Authorization: `Bearer ${policeToken}`, Range: "bytes=0-15" } });
    const rangedLen = (await ranged.arrayBuffer()).byteLength;
    check("Video can be seeked (HTTP Range returns 206)", ranged.status === 206 && rangedLen === 16, `(${ranged.status} len=${rangedLen})`);

    const ownerMedia = await fetch(BASE + mediaUrl, { headers: { Authorization: `Bearer ${ownerToken}` } });
    check("Submitter can retrieve their own file", ownerMedia.status === 200);
    if (otherOwnerToken) {
        const stranger = await fetch(BASE + mediaUrl, { headers: { Authorization: `Bearer ${otherOwnerToken}` } });
        check("Another owner cannot retrieve it", stranger.status === 403, `(${stranger.status})`);
    }

    // The damage passport's own download route must serve disk-stored media to the
    // right people and withhold it from everyone else - a buyer sees the fingerprint,
    // not the owner's clip.
    const passportOfficer = await fetch(`${BASE}/vehicle-intelligence/damage-events/${ev._id}/evidence/0`, { headers: { Authorization: `Bearer ${policeToken}` } });
    const passportBytes = await passportOfficer.arrayBuffer();
    check("Passport download serves the clip to an officer", passportOfficer.status === 200 && passportBytes.byteLength === 64, `(${passportOfficer.status} len=${passportBytes.byteLength})`);
    const passportDealer = await fetch(`${BASE}/vehicle-intelligence/damage-events/${ev._id}/evidence/0`, { headers: { Authorization: `Bearer ${dealerToken}` } });
    check("A buyer role is shown the hash, not the bytes", passportDealer.status === 403, `(${passportDealer.status})`);

    // ---- Integrity ----
    const integ = await json(`/vehicle-intelligence/damage-events/${ev._id}/verify-integrity`, {}, policeToken);
    check("Stored file re-hashes to the recorded digest", integ.status === 200 && integ.data.allEvidenceIntact === true, `(${integ.status} ${JSON.stringify(integ.data.evidence)})`);
    check("Record metadata re-hashes to the recorded digest", integ.data.recordIntegrity?.verified === true, `(${JSON.stringify(integ.data.recordIntegrity?.currentHash)} vs ${ev.anchor?.recordHash})`);

    // Integrity checks follow the same visibility rule as the damage passport itself:
    // a dealer reviewing the vehicle for resale may re-check it, a workshop of an
    // unrelated brand may not even resolve the record.
    const wsStamp = Date.now();
    const wsEmail = `suite.accident.${wsStamp}@workshop.com`;
    const wsReg = await formJson("/auth/register", {
        name: "Suite Unrelated Workshop", email: wsEmail, password: "suite123", role: "workshop",
        phone: "8888888888", address: "Hyderabad", state: "TS", district: "Hyderabad",
        aadhaarNumber: String(wsStamp).padStart(12, "0").slice(-12), dlNumber: "TS-SUITE-0001",
        workshopDetails: JSON.stringify({ companyName: "Suite Unrelated Motors", affiliatedManufacturer: "Unrelated Brand" }),
    });
    const wsUserId = wsReg.data.userId;
    if (wsUserId) {
        createdUserIds.push(wsUserId);
        await mongoose.connection.collection("users").updateOne(
            { _id: new mongoose.Types.ObjectId(wsUserId) },
            { $set: { "workshopDetails.verified": true } }
        );
    }
    const wsLogin = await json("/auth/login", { method: "POST", body: { email: wsEmail, password: "suite123" } });
    const otherBrand = await json(`/vehicle-intelligence/damage-events/${ev._id}/verify-integrity`, {}, wsLogin.data.token);
    check("An unrelated-brand workshop is refused the integrity check", otherBrand.status === 403, `(${otherBrand.status})`);

    // ---- Officer decision must not rewrite the statement ----
    const descriptionBefore = (await json(`/vehicle-intelligence/accident-uploads?status=all`, {}, policeToken)).data.uploads.find((u) => u._id === ev._id)?.description;
    const decision = await json(`/vehicle-intelligence/damage-events/${ev._id}/decision`, {
        method: "PATCH",
        body: { decision: "verified", remarks: "Clip reviewed, timestamp matches FIR." },
    }, policeToken);
    check("Officer can mark the evidence verified", decision.status === 200 && decision.data.event?.verificationStatus === "verified", `(${decision.status})`);

    const after = (await json(`/vehicle-intelligence/accident-uploads?status=all`, {}, policeToken)).data.uploads.find((u) => u._id === ev._id);
    check("Owner statement text was not rewritten by the review", after?.description === descriptionBefore);
    check("Review outcome stored separately with reviewer identity", after?.officerReview?.outcome === "verified" && /Suite|Police|police/i.test(after?.officerReview?.reviewedByName || "") && !!after?.officerReview?.reviewedAt);

    const integAfter = await json(`/vehicle-intelligence/damage-events/${ev._id}/verify-integrity`, {}, policeToken);
    check("Record still verifies after an officer reviewed it", integAfter.data.allEvidenceIntact === true && integAfter.data.recordIntegrity?.verified === true, `(${JSON.stringify(integAfter.data.recordIntegrity)})`);

    const ownerNotified = await json("/notifications?limit=50", {}, ownerToken);
    check("Owner notified of the review outcome", /Accident evidence verified/.test(JSON.stringify(ownerNotified.data)));

    const workshopDecision = await json(`/vehicle-intelligence/damage-events/${ev._id}/decision`, { method: "PATCH", body: { decision: "disputed" } }, rtoToken);
    check("A second officer can overturn to disputed", workshopDecision.status === 200 && workshopDecision.data.event?.verificationStatus === "disputed");

    const closed = await json(`/vehicle-intelligence/accident-uploads?status=pending`, {}, policeToken);
    check("Reviewed submissions leave the pending queue", !(closed.data.uploads || []).some((u) => u._id === ev._id));

    // ---- A refused upload must not leave the owner's bytes on the server ----
    const stagingPath = path.resolve("uploads/accident-evidence/_staging");
    const freshStaged = fs.existsSync(stagingPath)
        ? fs.readdirSync(stagingPath).filter((n) => fs.statSync(path.join(stagingPath, n)).mtimeMs >= startTs.getTime())
        : [];
    check("Refused uploads leave no files behind", freshStaged.length === 0, `(${freshStaged.join(", ")})`);

    await report();
};

const report = async () => {
    if (reported) return;
    reported = true;
    // Remove every trace: DB record, the alerts it raised, the test accounts, then
    // the media folder it pointed at.
    try {
        const { default: mongoose } = await import("mongoose");
        if (mongoose.connection.readyState === 1) {
            const db = mongoose.connection.db;
            if (createdEventIds.length) {
                await db.collection("damageevents").deleteMany({ _id: { $in: createdEventIds.map((id) => new mongoose.Types.ObjectId(id)) } });
            }
            await db.collection("notifications").deleteMany({ title: /^Accident evidence /, createdAt: { $gte: startTs } });
            if (createdUserIds.length) {
                const createdOids = createdUserIds.map((id) => new mongoose.Types.ObjectId(id));
                await db.collection("biometrictemplates").deleteMany({ user: { $in: createdOids } });
                await db.collection("users").deleteMany({ _id: { $in: createdOids } });
            }
            await mongoose.disconnect();
        }
    } catch (err) {
        console.log(" cleanup warning:", err.message);
    }
    for (const storedAs of createdMediaPaths) {
        if (!storedAs) continue;
        const batch = path.dirname(path.resolve("uploads/accident-evidence", storedAs));
        try { fs.rmSync(batch, { recursive: true, force: true }); } catch { /* ignore */ }
    }
    const secs = ((Date.now() - startTs.getTime()) / 1000).toFixed(1);
    console.log(`\n=== Accident evidence check: ${passed} passed, ${failed} failed (${secs}s) ===\n`);
    process.exit(failed ? 1 : 0);
};

run().catch(async (err) => {
    console.error("Smoke test crashed:", err);
    await report();
});
