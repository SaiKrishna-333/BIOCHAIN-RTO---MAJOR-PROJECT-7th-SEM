// test-feature-suite.js
// Smoke test for the remaining feature family (Features 2-8) on the running
// backend: node src/test-feature-suite.js
// F2 Parts Provenance · F6 Damage Passport · F7 EV Battery Passport
// F3 Casebook · F4 Transaction Anomaly · F5 Identity Cloning · F8 Transfer Approvals
// It seeds a temporary workshop + a synthetic transfer request and DELETES
// every document it creates.

import fs from "fs";

const BASE = "http://localhost:5000/api";
const startTs = new Date();
let passed = 0, failed = 0;

const check = (name, cond, extra = "") => {
    if (cond) { passed++; console.log(` [PASS] ${name}`); }
    else { failed++; console.log(` [FAIL] ${name} ${extra}`); }
};

const json = async (path, opts = {}, token) => {
    const res = await fetch(BASE + path, {
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

// multipart/form-data POST (fetch sets the boundary; only auth header added)
const formAuth = async (path, fields, token) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) if (v !== undefined && v !== null) fd.append(k, String(v));
    const res = await fetch(BASE + path, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const formJson = async (path, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const res = await fetch(BASE + path, { method: "POST", body: fd });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const run = async () => {
    console.log("\n=== Vehicle Intelligence / Features 2-8 smoke test ===\n");

    const { default: mongoose } = await import("mongoose");
    const envText = fs.existsSync(new URL("../.env", import.meta.url)) ? fs.readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
    const mongoUri = (envText.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/biochain";

    // ---- Setup: RTO, vehicle, verified workshop ----
    const rto = await json("/auth/login", { method: "POST", body: { email: "ka.rto@biochain.com", password: "ka123" } });
    check("RTO login", rto.status === 200 && rto.data.token, `(status ${rto.status} - is the DB seeded?)`);
    if (!rto.data.token) return report();
    const rtoToken = rto.data.token;

    const search = await json("/vehicles/search?limit=200", {}, rtoToken);
    const vehicles = search.data.vehicles || search.data || [];
    const maruti = vehicles.find((v) => /maruti/i.test(v.make));
    check("Found a Maruti vehicle in DB", !!maruti, "(seed one if missing)");
    if (!maruti) return report();

    const stamp = Date.now();
    const wsEmail = `suite.workshop.${stamp}@workshop.com`;
    const reg = await formJson("/auth/register", {
        name: "Suite Workshop", email: wsEmail, password: "suite123", role: "workshop",
        phone: "8888888888", address: "Bengaluru", state: "KA", district: "Bengaluru Urban",
        aadhaarNumber: String(stamp).padStart(12, "0").slice(-12), dlNumber: "KA-SUITE-0001",
        workshopDetails: JSON.stringify({ companyName: "Suite Motors", affiliatedManufacturer: "Maruti Suzuki" }),
    });
    check("Workshop registration accepted", reg.status === 201, `(status ${reg.status} ${JSON.stringify(reg.data)})`);
    const wsUserId = reg.data.userId;

    await mongoose.connect(mongoUri);
    const oid = (id) => new mongoose.Types.ObjectId(id);
    await mongoose.connection.collection("users").updateOne(
        { _id: oid(wsUserId) },
        { $set: { "workshopDetails.verified": true } }
    );
    // Idempotent pre-clean so re-runs on the same vehicle don't collide (unique battery passport).
    const mvid = oid(maruti._id);
    await mongoose.connection.collection("componentrecords").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("componentevents").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("damageevents").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("batterypassports").deleteMany({ vehicle: mvid });
    const wsToken = (await json("/auth/login", { method: "POST", body: { email: wsEmail, password: "suite123" } })).data.token;
    check("Verified workshop login", !!wsToken);

    // =========================================================================
    console.log("\n-- Feature 2: Parts Provenance --");
    const serial = `SUITE-ENG-${stamp}`;
    const comp = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {
        method: "POST", body: { componentType: "engine", serialNumber: serial, installationDate: "2024-01-10", reason: "Suite test engine" }
    }, wsToken);
    check("F2 register serialized component", comp.status === 201 && comp.data.component?.anchor?.recordHash, `(status ${comp.status})`);
    const compId = comp.data.component?._id;

    const dup = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {
        method: "POST", body: { componentType: "engine", serialNumber: serial }
    }, wsToken);
    check("F2 duplicate serial on same vehicle refused", dup.status === 409);

    const ev = await json(`/vehicle-intelligence/components/${compId}/events`, {
        method: "POST", body: { eventType: "inspected", inspectionResult: "pass", reason: "Suite inspection" }
    }, wsToken);
    check("F2 append lifecycle event", ev.status === 201 && ev.data.component.status === "inspected-passed");

    const compList = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {}, wsToken);
    check("F2 components list shows events", compList.status === 200 && compList.data.components.some((c) => c._id === compId && c.events?.length >= 2));

    const ownerLogin = await json("/auth/login", { method: "POST", body: { email: "owner@biochain.com", password: "owner123" } });
    const ownerTok = ownerLogin.data.token;
    const ownerComp = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {
        method: "POST", body: { componentType: "gearbox", serialNumber: `NOPE-${stamp}` }
    }, ownerTok);
    check("F2 owner blocked from registering components", ownerComp.status === 403);

    // =========================================================================
    console.log("\n-- Feature 6: Damage & Repair Passport --");
    const dmg = await formAuth(`/vehicle-intelligence/vehicle-history/${maruti._id}/damage-events`, {
        eventType: "accident-damage", eventDate: "2024-03-01", description: "Suite front bumper damage", severity: "moderate", affectedAreas: "front bumper"
    }, wsToken);
    check("F6 submit damage event (as reported)", dmg.status === 201 && dmg.data.event?.verificationStatus === "reported", `(status ${dmg.status})`);
    const dmgId = dmg.data.event?._id;

    // Integrity of the SUBMITTED record must match its hash before any later
    // authorized verification mutates the verification metadata.
    const integ = await json(`/vehicle-intelligence/damage-events/${dmgId}/verify-integrity`, {}, rtoToken);
    check("F6 submitted record integrity verified", integ.status === 200 && integ.data.recordIntegrity?.verified === true, `(status ${integ.status} ${JSON.stringify(integ.data.recordIntegrity)})`);

    const dmgVerify = await json(`/vehicle-intelligence/damage-events/${dmgId}/decision`, { method: "PATCH", body: { decision: "verified", remarks: "Suite inspector check" } }, rtoToken);
    check("F6 authorized verification flips to verified", dmgVerify.status === 200 && dmgVerify.data.event?.verificationStatus === "verified");

    const dmgList = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/damage-events`, {}, rtoToken);
    check("F6 timeline counts the verified event", dmgList.status === 200 && dmgList.data.summary.verified >= 1);

    const ownerDmg = await formAuth(`/vehicle-intelligence/vehicle-history/${maruti._id}/damage-events`, { eventType: "inspection", eventDate: "2024-04-01", description: "nope" }, ownerTok);
    check("F6 owner blocked from submitting damage", ownerDmg.status === 403);

    // =========================================================================
    console.log("\n-- Feature 7: EV Battery Passport --");
    const bat = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/battery`, {
        method: "POST", body: { batteryIdentifier: `SUITE-BAT-${stamp}`, manufacturer: "SuiteEnergy", chemistry: "lithium-ion", nominalCapacityKwh: 39.2, isElectric: true }
    }, wsToken);
    check("F7 create battery passport", bat.status === 201, `(status ${bat.status} ${JSON.stringify(bat.data).slice(0, 120)})`);

    const batEv = await json(`/vehicle-intelligence/battery/${maruti._id}/events`, {
        method: "POST", body: { eventType: "soh-report", eventDate: "2024-06-01", stateOfHealthPercent: 92, capacityKwh: 36.1, sourceType: "workshop-verified", sourceDescription: "Suite OBD scan" }
    }, wsToken);
    check("F7 append battery event", batEv.status === 201);

    const batBad = await json(`/vehicle-intelligence/battery/${maruti._id}/events`, {
        method: "POST", body: { eventType: "soh-report", stateOfHealthPercent: 80, sourceType: "telepathy" }
    }, wsToken);
    check("F7 undeclared source rejected", batBad.status === 400 && batBad.data.errors?.length >= 1);

    const batGet = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/battery`, {}, rtoToken);
    check("F7 passport reflects latest SoH + chart", batGet.status === 200 && batGet.data.exists && batGet.data.passport.currentSoH === 92 && batGet.data.healthChart.length >= 1);

    // =========================================================================
    console.log("\n-- Feature 3: Investigation Casebook --");
    const police = await json("/auth/login", { method: "POST", body: { email: "police@biochain.com", password: "police123" } });
    const policeTok = police.data.token;
    check("Police login", !!policeTok);

    const caseCreate = await json("/investigations/cases", {
        method: "POST", body: { title: "Suite odometer review", reason: "Suite: inconsistent readings", priority: "medium", vehicleId: maruti._id }
    }, policeTok);
    check("F3 create case with CASE ref", caseCreate.status === 201 && /^CASE-\d{4}-\d{4}$/.test(caseCreate.data.case?.caseRef || ""), `(status ${caseCreate.status})`);
    const caseId = caseCreate.data.case?._id;

    await json(`/investigations/cases/${caseId}/notes`, { method: "POST", body: { text: "Suite investigator note" } }, policeTok);
    await json(`/investigations/cases/${caseId}/link-tx`, { method: "POST", body: { txHash: "0xdeadbeefcafe", label: "Suite linked tx" } }, policeTok);
    const caseDetail = await json(`/investigations/cases/${caseId}`, {}, policeTok);
    check("F3 case detail has note + linked tx + timeline", caseDetail.status === 200 && caseDetail.data.case.notes.length >= 1 && caseDetail.data.case.blockchainTxRefs.length >= 1 && caseDetail.data.case.actions.length >= 1);

    const caseStatus = await json(`/investigations/cases/${caseId}/status`, { method: "PATCH", body: { status: "resolved", remarks: "Suite resolution" } }, policeTok);
    check("F3 status change to resolved", caseStatus.status === 200 && caseStatus.data.case.status === "resolved");

    const ownerCases = await json("/investigations/cases", {}, ownerTok);
    check("F3 owner blocked from casebook", ownerCases.status === 403);

    // =========================================================================
    console.log("\n-- Feature 4: Transaction Anomaly Detection --");
    const scan = await json("/investigations/anomaly/scan", { method: "POST" }, policeTok);
    check("F4 anomaly scan runs", scan.status === 200, `(status ${scan.status})`);
    const preview = await json("/investigations/anomaly/preview", {}, policeTok);
    check("F4 preview exposes explainable stats", preview.status === 200 && "resale" in preview.data && "churn" in preview.data);
    const alerts = await json("/investigations/anomaly/alerts", {}, policeTok);
    check("F4 alerts list returns array", alerts.status === 200 && Array.isArray(alerts.data.alerts));

    // =========================================================================
    console.log("\n-- Feature 5: Identity Cloning Detector --");
    const cScan = await json("/investigations/cloning/scan", { method: "POST" }, policeTok);
    check("F5 cloning scan runs", cScan.status === 200, `(status ${cScan.status})`);
    const conflicts = await json("/investigations/cloning/conflicts", {}, policeTok);
    check("F5 conflicts list returns array + honest note", conflicts.status === 200 && Array.isArray(conflicts.data.conflicts) && typeof conflicts.data.note === "string");

    // =========================================================================
    console.log("\n-- Feature 8: Multi-Party Transfer Approvals --");
    const ownerId = (await mongoose.connection.collection("users").findOne({ email: "owner@biochain.com" }))?._id;
    const buyerId = (await mongoose.connection.collection("users").findOne({ email: "dealer@biochain.com" }))?._id;
    const reqRes = await mongoose.connection.collection("requests").insertOne({
        type: "transfer", vehicle: maruti._id, seller: ownerId, buyer: buyerId, status: "pending",
        createdAt: startTs, updatedAt: startTs
    });
    const trId = reqRes.insertedId;

    const init = await json(`/transfer-approvals/${trId}/init`, { method: "POST" }, rtoToken);
    check("F8 RTO initializes approval checklist", init.status === 201 && init.data.workflow?.steps?.length === 5, `(status ${init.status})`);

    const view = await json(`/transfer-approvals/${trId}`, {}, rtoToken);
    check("F8 RTO canDecide lists document-verification (not seller consent)", view.status === 200 && view.data.canDecide.includes("document-verification") && !view.data.canDecide.includes("seller-authorization"));

    const rtoDecide = await json(`/transfer-approvals/${trId}/steps/document-verification/decision`, { method: "POST", body: { decision: "approve" } }, rtoToken);
    check("F8 RTO approves document-verification, transfer not yet finalizable", rtoDecide.status === 200 && rtoDecide.data.canFinalize === false && rtoDecide.data.progress.mandatoryApproved >= 1);

    const forge = await json(`/transfer-approvals/${trId}/steps/seller-authorization/decision`, { method: "POST", body: { decision: "approve" } }, rtoToken);
    check("F8 RTO cannot forge seller authorization", forge.status === 403);

    const sellerDecide = await json(`/transfer-approvals/${trId}/steps/seller-authorization/decision`, { method: "POST", body: { decision: "approve" } }, ownerTok);
    check("F8 actual seller can authorize", sellerDecide.status === 200 && sellerDecide.data.workflow.steps.find((s) => s.key === "seller-authorization").status === "approved");

    // Existing finalize endpoint must be gated by the incomplete checklist.
    const gate = await json(`/requests/${trId}/approve`, { method: "POST", body: {} }, rtoToken);
    check("F8 finalize blocked while checklist incomplete", gate.status === 400 && Array.isArray(gate.data.pendingSteps) && gate.data.pendingSteps.length > 0, `(status ${gate.status} ${JSON.stringify(gate.data).slice(0, 140)})`);

    // ---- Cleanup (delete everything this suite created) ----
    await mongoose.connection.collection("componentrecords").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("componentevents").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("damageevents").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("batterypassports").deleteMany({ vehicle: mvid });
    await mongoose.connection.collection("investigationcases").deleteMany({ title: "Suite odometer review" });
    await mongoose.connection.collection("anomalyalerts").deleteMany({ createdAt: { $gte: startTs } });
    await mongoose.connection.collection("identityconflicts").deleteMany({ createdAt: { $gte: startTs } });
    await mongoose.connection.collection("transferapprovalworkflows").deleteMany({ request: trId });
    await mongoose.connection.collection("requests").deleteOne({ _id: trId });
    await mongoose.connection.collection("servicerecords").deleteMany({ submittedBy: oid(wsUserId) });
    await mongoose.connection.collection("biometrictemplates").deleteMany({ user: oid(wsUserId) });
    await mongoose.connection.collection("users").deleteOne({ _id: oid(wsUserId) });
    await mongoose.disconnect();
    console.log("\nTest data cleaned up");

    report();
};

const report = () => {
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed ? 1 : 0);
};

run().catch((err) => { console.error("Smoke test crashed:", err); process.exit(1); });
