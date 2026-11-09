// damage-smoke.mjs
// Verifies Feature 9 (3D Damage & Repair Intelligence) and the Feature 10 broadening
// against the seeded damage demo. Run AFTER `node seed-damage-demo.mjs`, from the
// backend folder:
//   node damage-smoke.mjs
// It checks the assessment links (never duplicates) its accident, the estimate is
// traceable to the catalogue, the integrity hash verifies, the forensics replay now
// surfaces the assessment + odometer-anomaly + dependency edge, and that linking a
// finding to the casebook leaves the source records untouched.
import "dotenv/config";
import mongoose from "mongoose";
import { DamageAssessment } from "./src/models/DamageAssessment.js";
import { DamageEvent } from "./src/models/DamageEvent.js";
import { InvestigationCase } from "./src/models/InvestigationCase.js";
import { verifyRecordIntegrity } from "./src/services/recordAnchorService.js";
import {
    resolveVehicle,
    reconstruct,
    compareStates,
    stateAtEvent,
    linkFindingToCase,
} from "./src/services/forensicsService.js";

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO";
const REG = "KA46DH5566";
let failures = 0;
const check = (label, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} - ${label}${detail ? ` (${detail})` : ""}`);
    if (!ok) failures++;
};

const main = async () => {
    await mongoose.connect(uri);
    const vehicle = await resolveVehicle({ regNumber: REG });
    check("resolves the damage demo vehicle", !!vehicle, vehicle ? String(vehicle._id) : "not found");
    if (!vehicle) { await mongoose.disconnect(); process.exit(1); }

    const assessment = await DamageAssessment.findOne({ vehicle: vehicle._id });
    check("an assessment exists for the vehicle", !!assessment);
    if (!assessment) { await mongoose.disconnect(); process.exit(1); }

    // One accident, linked - not duplicated.
    check("assessment links to an existing accident", !!assessment.linkedDamageEvent);
    const accident = await DamageEvent.findById(assessment.linkedDamageEvent);
    check("the linked accident belongs to the same vehicle", String(accident?.vehicle) === String(vehicle._id));
    check("the accident was fed to verified by the final inspection", accident?.verificationStatus === "verified", accident?.verificationStatus);

    // Integrity: the hashed record still matches its stored hash.
    const integrity = verifyRecordIntegrity(assessment);
    check("assessment integrity verifies against its hash", integrity.verified === true, integrity.reason);

    // Estimate is catalogue-traceable, never invented, and totals reconcile.
    const est = assessment.estimate;
    check("estimate has items", (est?.items || []).length > 0, `${est?.items?.length} items`);
    check("every priced item cites the configured catalogue", est.items.every((it) => it.priceBasis === "configured-catalogue" && !!it.catalogueRef));
    const recomputed = est.items.reduce((n, it) => n + it.partsCost + it.labourCost + it.additionalCost, 0);
    check("estimate grand total reconciles with its items", recomputed === est.grandTotal, `${recomputed} vs ${est.grandTotal}`);
    check("estimate was approved", est.status === "approved", est.status);

    // Honesty: an unmapped finding is not pretended to be on the 3D model.
    const unmapped = assessment.findings.filter((f) => !f.mappedTo3D);
    check("an unmapped finding is present and flagged not-mapped", unmapped.length >= 1, `${unmapped.length} unmapped`);
    const cvFindings = assessment.findings.filter((f) => f.source === "computer-vision");
    check("manual mode produced no fake computer-vision findings", assessment.analysis.mode === "manual" && cvFindings.length === 0, `mode=${assessment.analysis.mode}`);

    // Verification is a real, earned state (not just an approved estimate).
    check("repair verified only after a passed final inspection", assessment.repairCompletion?.verified === true && assessment.repairCompletion?.finalInspection === "passed");

    // ---- Feature 10 broadening ----
    const recon = await reconstruct(vehicle._id);
    const types = recon.events.map((e) => e.eventType);
    check("replay includes the 3D damage-assessment event", types.includes("damage-assessment"));
    check("replay includes service-odometer events", types.includes("service-odometer"));
    check("replay includes the accident event", types.includes("accident-damage"));

    const odometerConflict = recon.conflicts.find((c) => c.type === "odometer-anomaly");
    check("odometer decrease is flagged as a review conflict", !!odometerConflict, odometerConflict?.detail?.slice(0, 60));

    const graph = recon.dependencyGraph || { edges: [] };
    check("dependency graph links the assessment to its accident", graph.edges.some((e) => e.relation === "extends-accident"), `${graph.edges.length} edges`);

    // Compare the reconstructed state between the first and last timeline points.
    const first = recon.events[0];
    const last = recon.events[recon.events.length - 1];
    const cmp = await compareStates(vehicle._id, first.id, last.id);
    check("state comparison returns differences between the endpoints", (cmp.differences || []).length >= 1, `${cmp.differences?.length} differences`);
    check("comparison exposes the assessment status change", cmp.differences.some((d) => d.field === "assessmentStatus"));

    // Replay to a single point; unrecorded fields must come back null, never invented.
    const at = await stateAtEvent(vehicle._id, first.id);
    check("state-at-event replays to the first event", at.state && at.event.sequence === first.sequence);
    check("state-at-event does not invent a later assessment", at.state.assessmentStatus == null, String(at.state.assessmentStatus));

    // The one allowed write: link a finding to the casebook, leaving sources untouched.
    const before = await DamageEvent.findById(assessment.linkedDamageEvent).lean();
    const linked = await linkFindingToCase({
        vehicleId: vehicle._id,
        conflict: odometerConflict || recon.conflicts[0],
        actor: { id: new mongoose.Types.ObjectId(), name: "Smoke Officer", role: "rto" },
        note: "smoke test link",
    });
    check("linking a finding opens a casebook entry", !!linked.caseRef && linked.created === true, linked.caseRef);
    const after = await DamageEvent.findById(assessment.linkedDamageEvent).lean();
    check("linking a finding did not modify the source accident", String(before.verificationStatus) === String(after.verificationStatus) && String(before.description) === String(after.description));

    // Clean up the case this smoke run created so reruns stay idempotent.
    if (linked.caseId) await InvestigationCase.deleteOne({ _id: linked.caseId });

    await mongoose.disconnect();
    console.log(`\n=== damage smoke: ${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ===`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => { console.error("damage smoke error:", err); process.exit(1); });
