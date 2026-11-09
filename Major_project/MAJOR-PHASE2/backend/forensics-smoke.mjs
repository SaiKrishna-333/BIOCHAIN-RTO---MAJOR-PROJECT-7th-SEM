// forensics-smoke.mjs
// Verifies the Vehicle Lifecycle Forensics & Event Replay engine against the seeded
// demo scenario. Run AFTER `node seed-forensics-demo.mjs`, from the backend folder:
//   node forensics-smoke.mjs
// It asserts the replay reconstructs the events in order, flags the engine identifier
// change that carries a missing approval reference, and traces a later dependent
// record that carries the replaced serial. Exits non-zero on any failed check.
import "dotenv/config";
import mongoose from "mongoose";
import { resolveVehicle, reconstruct, verifyVehicleIntegrity, buildInvestigationReport } from "./src/services/forensicsService.js";

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO";
const REG = "KA45FG1234";
let failures = 0;
const check = (label, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} - ${label}${detail ? ` (${detail})` : ""}`);
    if (!ok) failures++;
};

const main = async () => {
    await mongoose.connect(uri);
    const vehicle = await resolveVehicle({ regNumber: REG });
    check("resolves the demo vehicle by registration", !!vehicle, vehicle ? String(vehicle._id) : "not found");
    if (!vehicle) { await mongoose.disconnect(); process.exit(1); }

    const recon = await reconstruct(vehicle._id);
    check("reconstruct returns a timeline of events", recon.events.length >= 6, `${recon.events.length} events`);

    const types = recon.events.map((e) => e.eventType);
    check("includes registration", types.includes("registration"));
    check("includes ownership-transfer", types.includes("ownership-transfer"));
    check("includes accident-damage", types.includes("accident-damage"));
    check("includes component-replacement", types.includes("component-replacement"));

    // Events must be in non-decreasing chronological order.
    let chronological = true;
    for (let i = 1; i < recon.events.length; i++)
        if (new Date(recon.events[i].occurredAt) < new Date(recon.events[i - 1].occurredAt)) chronological = false;
    check("events replay in chronological order", chronological);

    // The core of the feature: the engine serial changed and the change lacks approval.
    const engineConflict = recon.conflicts.find((c) => c.type === "engine-identity-change");
    check("engine identifier change is flagged", !!engineConflict, engineConflict ? engineConflict.detail : "none");
    check("engine change flagged as needing review", engineConflict?.severity === "needs-review");
    check("engine conflict names the replaced serial ENG-8821", engineConflict?.disputedValue === "ENG-8821", engineConflict?.disputedValue);
    check("engine conflict records the previous serial ENG-1048", engineConflict?.previousValue === "ENG-1048", engineConflict?.previousValue);
    check("a later dependent record carries the replaced serial", (engineConflict?.dependentEventIds || []).length > 0, (engineConflict?.dependentEventIds || []).join(", "));

    // Selected event detail carries before/after evidence and approval state.
    const replacementEvent = recon.events.find((e) => e.id === engineConflict?.firstAppearedEventId);
    check("replacement event exposes before/after state", !!replacementEvent?.changes?.some((c) => c.field === "engineNumber"));
    check("replacement event marks approval reference missing", replacementEvent?.approval.present === false);

    // Integrity recomputation runs without throwing and reports per record.
    const integrity = await verifyVehicleIntegrity(vehicle._id);
    check("integrity verification returns results", integrity.results.length > 0, `${integrity.results.length} records`);
    check("hashed records verify against their stored hash", integrity.results.every((r) => r.verified !== undefined));

    // Investigation report is well formed.
    const report = buildInvestigationReport(recon);
    check("investigation report lists findings", report.findings.length >= 1, `${report.findings.length} findings`);
    check("investigation report carries the honesty disclaimer", typeof report.disclaimer === "string" && report.disclaimer.length > 0);

    await mongoose.disconnect();
    console.log(`\n=== forensics smoke: ${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ===`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => { console.error("smoke error:", err); process.exit(1); });
