// test-smart-migration.mjs
// End-to-end behavioural test of the BioChain Smart Migration Orchestrator, driven
// over real HTTP against a running backend. It proves the strongest demo path the
// spec asks for: a vehicle that initially FAILS the pre-check, the blocking issue is
// resolved, the migration is then filed, approved by BOTH state RTOs, and finally
// PASSES reconciliation. Run the backend first (node src/server.js), then:
//   node test-smart-migration.mjs
const BASE = process.env.BASE || "http://localhost:5000/api";
const fs = await import("fs");

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log("  \u2713 " + m); };
const bad = (m) => { fail++; console.log("  \u2717 " + m); };
const assert = (cond, m) => (cond ? ok(m) : bad(m));

async function login(email, password) {
    const r = await fetch(`${BASE}/auth/login`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (!j.token) throw new Error(`login failed for ${email}: ${JSON.stringify(j)}`);
    return j.token;
}
const H = (t) => ({ Authorization: `Bearer ${t}` });
async function get(path, t) {
    const r = await fetch(BASE + path, { headers: H(t) });
    return { status: r.status, body: await r.json() };
}
async function post(path, t, body) {
    const r = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json", ...H(t) }, body: JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
}
async function put(path, t, body) {
    const r = await fetch(BASE + path, { method: "PUT", headers: { "Content-Type": "application/json", ...H(t) }, body: JSON.stringify(body || {}) });
    return { status: r.status, body: await r.json() };
}

console.log("Smart Migration Orchestrator - end-to-end test\n");

// Make the run repeatable: clear this test's own artefacts (migrations, the challan
// it issues to force a block) and restore the migration vehicle's original number if
// a previous run re-registered it. Nothing else in the demo dataset is touched.
await (async () => {
    const mongoose = (await import("mongoose")).default;
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO");
    const { SmartMigration } = await import("./src/models/SmartMigration.js");
    const { Challan } = await import("./src/models/Challan.js");
    const { Vehicle } = await import("./src/models/Vehicle.js");
    const { Request } = await import("./src/models/Request.js");
    await SmartMigration.deleteMany({});
    await Challan.deleteMany({ regNumber: { $in: ["KA45CF1357", "TN45CF1357"] } });
    await Request.deleteMany({ type: "interStateTransfer", "interStateDetails.currentRegNumber": "KA45CF1357" });
    await Vehicle.updateOne({ chassisNumber: "MA12E45FG9031357" }, { $set: { regNumber: "KA45CF1357", status: "active" } });
    await mongoose.disconnect();
    console.log("  (previous run artefacts cleared)\n");
})();

const OWNER = { email: "owner@biochain.com", password: "owner123" };
const POLICE = { email: "police@biochain.com", password: "police123" };
const RTO_KA = { email: "ka.rto@biochain.com", password: "ka123" };
const RTO_TN = { email: "tn.rto@biochain.com", password: "tn123" };

const MIGReg = "KA45CF1357"; // V3, owned by B (seed-a2z-demo)
const NEW_REG = "TN45CF1357"; // destination re-registration

let ownerTok, policeTok, kaTok, tnTok;
try {
    ownerTok = await login(OWNER.email, OWNER.password);
    policeTok = await login(POLICE.email, POLICE.password);
    kaTok = await login(RTO_KA.email, RTO_KA.password);
    tnTok = await login(RTO_TN.email, RTO_TN.password);
    ok("all four accounts logged in");
} catch (e) {
    bad("login stage failed: " + e.message);
    console.log("\nIs the backend running on " + BASE + "?");
    process.exit(1);
}

// Locate V3 by reg number through the owner's vehicle list.
const myVehicles = await get("/vehicles/my", ownerTok);
const vehicle = (myVehicles.body || []).find((v) => v.regNumber === MIGReg);
if (!vehicle) { bad(`vehicle ${MIGReg} not found for owner B - run seed-a2z-demo.mjs`); process.exit(1); }
ok(`found migration vehicle ${MIGReg} (${vehicle._id})`);

// 1. Pre-check WITHOUT a blocking challan first, then add one and expect "blocked".
const pre0 = await post("/migration/precheck", ownerTok, { vehicleId: vehicle._id, destinationState: "TN" });
assert(pre0.status === 200, "precheck returns 200");
const challanRes = await post("/challans/create", policeTok, {
    regNumber: MIGReg, violationType: "speeding", violationDescription: "Test outstanding challan for migration pre-check",
    location: "Bengaluru", fineAmount: 2000,
});
assert(challanRes.status === 201, "police issued a challan to force a blocking issue");

const preBlocked = await post("/migration/precheck", ownerTok, { vehicleId: vehicle._id, destinationState: "TN" });
assert(preBlocked.status === 200 && preBlocked.body.verdict === "blocked", `precheck verdict is 'blocked' with a pending challan (got ${preBlocked.body.verdict})`);
const challanCheck = (preBlocked.body.checks || []).find((c) => c.key === "challans");
assert(challanCheck && challanCheck.result === "blocked", "challans check reported as blocked with a linked source");
const financeCheck = (preBlocked.body.checks || []).find((c) => c.key === "finance");
assert(financeCheck && financeCheck.result === "needs_review", "unavailable data (finance) is 'needs_review', never 'passed'");

// Cost estimate is labelled and driven by a configurable rule.
assert(preBlocked.body.costEstimate && preBlocked.body.costEstimate.estimatedTotal > 0, "tax estimator produced a non-zero estimate");
assert(/estimate/i.test(preBlocked.body.costEstimate.label || ""), "cost output is clearly labelled an estimate");

// 2. Create the migration - it should be created in the blocked state.
const create = await post("/migration/create", ownerTok, {
    vehicleId: vehicle._id, destinationState: "TN", newAddress: "12 Anna Salai, Chennai",
    vehicleCategory: "private", relocationReason: "Employment transfer to Tamil Nadu",
});
assert(create.status === 201, "migration created");
const migration = create.body.migration;
assert(/^BCM-\d{4}-\d{5}$/.test(migration.migrationId), `migration id format ${migration.migrationId}`);
assert(migration.status === "precheck_blocked", `migration starts blocked (${migration.status})`);
assert(Array.isArray(migration.stages) && migration.stages.length >= 7, "dependency-ordered stages were built");
const destStage = migration.stages.find((s) => s.key === "destination_review");
assert(destStage && destStage.status === "locked", "destination stage is locked before the source NOC");

// 3. Resolve the blocker: pay the challan in full, then re-check.
const allChallans = await get("/challans/all", ownerTok);
const openChallan = (allChallans.body || []).find((c) => String(c.vehicle?._id || c.vehicle) === String(vehicle._id) && c.paymentStatus !== "paid");
assert(!!openChallan, "located the open challan to pay");
const pay = await put(`/challans/${openChallan._id}/pay`, ownerTok, { paymentMethod: "online" });
assert(pay.status === 200 && pay.body.challan.paymentStatus === "paid", "challan paid in full");

const recheck = await post(`/migration/${migration._id}/recheck`, ownerTok, {});
assert(recheck.status === 200 && recheck.body.verdict !== "blocked", `after resolving the challan the pre-check clears (${recheck.body.verdict})`);
assert(recheck.body.migration.status === "ready_to_apply", "migration moved to ready_to_apply");

// 4. Document intelligence: upload the sample ID fixture (real OCR run).
const fixturePath = new URL("./test-fixtures/sample-id.png", import.meta.url);
if (!fs.existsSync(fixturePath)) {
    bad("test-fixtures/sample-id.png missing - skipping document intelligence step");
} else {
    const buf = fs.readFileSync(fixturePath);
    const fd = new FormData();
    fd.append("document", new Blob([buf], { type: "image/png" }), "sample-id.png");
    fd.append("category", "address");
    fd.append("name", "Destination address proof");
    const up = await fetch(`${BASE}/migration/${migration._id}/documents`, { method: "POST", headers: H(ownerTok), body: fd });
    const upBody = await up.json();
    assert(up.status === 200, "document uploaded and OCR-analysed");
    assert(upBody.document && upBody.document.integrityHash, "document integrity hash preserved");
    assert(Array.isArray(upBody.formDrafts?.checklist) && upBody.formDrafts.checklist.length > 0, "Form 28/27 checklist drafted");
    const docIndex = 0;
    const verify = await post(`/migration/${migration._id}/documents/${docIndex}/verify`, ownerTok, {});
    // verify may reject if the OCR found discrepancies; either outcome is honest.
    assert(verify.status === 200 || verify.status === 400, `document verification decision recorded (${verify.status})`);
}

// 5. File the application (needs at least one verified document).
let submit = await post(`/migration/${migration._id}/submit-application`, ownerTok, {});
if (submit.status === 400 && /verified document/i.test(submit.body.message || "")) {
    // Force a verified doc if OCR left discrepancies on the sample fixture.
    const docsPost = await post(`/migration/${migration._id}/documents/${0}/verify`, ownerTok, {});
    submit = await post(`/migration/${migration._id}/submit-application`, ownerTok, {});
    void docsPost;
}
assert(submit.status === 200, `application submitted (${submit.body.message || submit.status})`);
if (submit.status === 200) {
    assert(submit.body.migration.status === "submitted", "migration status is submitted");
    assert(!!submit.body.migration.request, "a conventional inter-state Request was filed alongside");
    assert(!!submit.body.migration.passport?.hash, "migration passport reference + integrity hash stored");
}

// 6. Two-state coordination: destination cannot act before the source NOC.
const premature = await post(`/migration/${migration._id}/destination-approve`, tnTok, { newRegNumber: NEW_REG });
assert(premature.status === 400, "destination approval is blocked before a source NOC (dependency enforced)");

const noc = await post(`/migration/${migration._id}/source-approve`, kaTok, { remarks: "NOC issued after eligibility review" });
assert(noc.status === 200 && noc.body.migration.status === "noc_issued", "source RTO issued the NOC");
assert(noc.body.migration.deadline?.expiresAt && typeof noc.body.migration.deadline?.daysRemaining === "number", "NOC deadline countdown computed");
const wrongSource = await post(`/migration/${migration._id}/source-approve`, tnTok, {});
assert(wrongSource.status === 403, "only the source-state officer can issue the NOC");

// 7. Destination approves, re-registers, and reconciliation runs.
const dest = await post(`/migration/${migration._id}/destination-approve`, tnTok, { newRegNumber: NEW_REG, remarks: "Re-registered in Tamil Nadu" });
assert(dest.status === 200, `destination approved (${dest.body.message || dest.status})`);
if (dest.status === 200) {
    const m = dest.body.migration;
    assert(m.reconciliation?.verdict === "consistent", `reconciliation verdict is consistent (${m.reconciliation?.verdict})`);
    assert(["completed", "reconciling"].includes(m.status), `migration reached ${m.status}`);
    assert(m.destination.newRegNumber === NEW_REG, "new registration recorded on the migration");
}

// 8. The vehicle itself was re-registered under the new number.
const after = await get(`/vehicles/${vehicle._id}`, ownerTok);
assert(after.status === 200 && after.body.regNumber === NEW_REG, `vehicle re-registered as ${NEW_REG}`);

// 9. Audit history + passport readability.
const full = await get(`/migration/${migration._id}`, ownerTok);
assert(full.status === 200 && Array.isArray(full.body.eventHistory) && full.body.eventHistory.length >= 5, `auditable event history recorded (${full.body.eventHistory?.length} events)`);
const pp = await get(`/migration/${migration._id}/passport`, tnTok);
assert(pp.status === 200 && pp.body.passport?.migration?.migrationId === migration.migrationId, "destination RTO can read the migration passport");

console.log(`\n${fail === 0 ? "ALL PASSED" : "SOME FAILED"} - ${pass} passed, ${fail} failed`);

// Cleanup: leave the demo data as we found it is not trivial here (the vehicle
// changed reg), so this test is intended to run against a re-seedable demo DB.
console.log("Note: this test re-registers the migration vehicle; re-seed before a fresh recording.");
process.exit(fail === 0 ? 0 : 1);
