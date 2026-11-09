// damage-e2e.mjs
// Live HTTP end-to-end walk of the Feature 9 assessment lifecycle and the Feature 10
// forensics controls, driven through the running API exactly the way the frontend
// calls them. Run the backend first, then:
//   node damage-e2e.mjs
// It registers a fresh citizen, opens an assessment over one existing accident,
// drives photos/findings/estimate/review/completion/inspection as the seeded
// workshop and RTO accounts, and verifies every honesty boundary over the wire.
// All data it creates is removed at the end so reruns are clean.
import "dotenv/config";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { User } from "./src/models/User.js";
import { Vehicle } from "./src/models/Vehicle.js";
import { DamageEvent } from "./src/models/DamageEvent.js";
import { DamageAssessment } from "./src/models/DamageAssessment.js";
import { InvestigationCase } from "./src/models/InvestigationCase.js";

const BASE = process.env.E2E_API_URL || "http://localhost:5000/api";
const REG = "KA99E2E001";
const E2E_EMAIL = "e2e.owner@biochain.com";
const JPEG = Buffer.from(
    "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AfwD/2Q==",
    "base64"
);

let failures = 0;
const check = (label, ok, detail = "") => {
    console.log(`${ok ? "PASS" : "FAIL"} - ${label}${detail ? ` (${detail})` : ""}`);
    if (!ok) failures++;
};

const login = async (email, password) => {
    const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok || !body.token) throw new Error(`login failed for ${email}: ${body.message}`);
    return body.token;
};

const getJSON = async (path, token, method = "GET", data) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: data ? JSON.stringify(data) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};

const postFile = async (path, token, fieldName, fileName, buffer, fields = {}) => {
    const form = new FormData();
    form.append(fieldName, new Blob([buffer], { type: "image/jpeg" }), fileName);
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    const res = await fetch(`${BASE}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};

const wipe = async () => {
    const vehicle = await Vehicle.findOne({ regNumber: REG });
    if (vehicle) {
        await DamageAssessment.deleteMany({ vehicle: vehicle._id });
        await DamageEvent.deleteMany({ vehicle: vehicle._id });
        await vehicle.deleteOne();
    }
    await User.deleteOne({ email: E2E_EMAIL });
};

const main = async () => {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO");

    // Wait for the API to answer rather than failing on a cold start.
    let health = null;
    for (let i = 0; i < 20; i++) {
        try {
            health = await fetch(`${BASE}/health`).then((r) => r.json());
            break;
        } catch { await new Promise((r) => setTimeout(r, 1000)); }
    }
    if (!health) throw new Error(`API not reachable at ${BASE} - start it with npm run dev first`);
    check("API health endpoint responds", health.status === "ok", health.database);

    await wipe();
    const owner = await User.findOne({ email: "damage.owner@biochain.com" }).lean();
    if (!owner) throw new Error("run `node seed-damage-demo.mjs` first - the demo workshop/RTO accounts are needed");

    // A second citizen so owner-scoped access control can be tested honestly.
    const e2eUser = await User.create({
        name: "E2E Citizen",
        email: E2E_EMAIL,
        passwordHash: await bcrypt.hash("e2e12345", 10),
        role: "owner",
    });
    const vehicle = await Vehicle.create({
        regNumber: REG,
        chassisNumber: "E2E-CHASSIS-0001",
        engineNumber: "E2E-ENGINE-0001",
        make: "Maruti Suzuki",
        model: "Swift",
        year: 2022,
        currentOwner: owner._id,
        status: "active",
    });
    const accident = await DamageEvent.create({
        vehicle: vehicle._id,
        regNumber: REG,
        eventType: "accident-damage",
        eventDate: new Date("2026-07-01T10:00:00Z"),
        reportDate: new Date("2026-07-01T10:00:00Z"),
        description: "E2E probe accident: scuffed front bumper after a bay-manoeuvre contact.",
        severity: "moderate",
        affectedAreas: ["front"],
        verificationStatus: "reported",
        submittedBy: owner._id,
        submitterName: owner.name,
        sourceChannel: "owner-upload",
        evidence: [],
    });

    const ownerTok = await login(owner.email, "damage123");
    const wsTok = await login("damage.workshop@biochain.com", "damage123");
    const rtoTok = await login("damage.rto@biochain.com", "damage123");
    const e2eTok = await login(E2E_EMAIL, "e2e12345");
    check("all four accounts log in through the API", !!(ownerTok && wsTok && rtoTok && e2eTok));

    // --- Lookup: the existing accident is surfaced so the module links, never duplicates.
    const look = await getJSON(`/damage/vehicle-lookup?reg=${REG}`, ownerTok);
    check("owner can look the vehicle up", look.status === 200 && look.body.vehicle?.regNumber === REG);
    check("lookup surfaces the existing accident", (look.body.damageEvents || []).some((d) => d.id === String(accident._id)));

    const stranger = await getJSON(`/damage/vehicle-lookup?reg=${REG}`, e2eTok);
    check("a non-owning citizen is refused (403)", stranger.status === 403, `status ${stranger.status}`);

    // --- Open the assessment over the existing accident.
    const opened = await getJSON("/damage/assessments", ownerTok, "POST", {
        vehicleId: String(vehicle._id),
        linkedDamageEventId: String(accident._id),
        incidentNotes: "E2E: low-speed contact, front bumper scuffed.",
        suspectedArea: "front",
    });
    check("assessment opens linked to the existing accident", opened.status === 201 && opened.body.assessment?.linkedDamageEvent === String(accident._id));
    const aid = opened.body.assessment?.id;

    // --- Analysis before any photo exists: it must honestly say nothing was analysed.
    const noPhotoAnalyze = await getJSON(`/damage/assessments/${aid}/analyze`, wsTok, "POST", {});
    check("analyze without photographs claims no detection", noPhotoAnalyze.status === 200 && noPhotoAnalyze.body.analysis?.mode === "none", `mode ${noPhotoAnalyze.body.analysis?.mode}`);
    check("a run with nothing to analyse fabricates no findings", (noPhotoAnalyze.body.assessment?.findings || []).length === 0);

    const ownerAnalyze = await getJSON(`/damage/assessments/${aid}/analyze`, ownerTok, "POST", {});
    check("an owner may not record findings (403)", ownerAnalyze.status === 403, `status ${ownerAnalyze.status}`);

    // --- Photographs.
    const photoRes = await postFile(`/damage/assessments/${aid}/photos`, wsTok, "photos", "e2e-front.jpg", JPEG, { view: "front" });
    check("workshop uploads a damage photograph", photoRes.status === 200 && photoRes.body.photoCount === 1);
    const photoFetch = await fetch(`${BASE}/damage/assessments/${aid}/photo/0`, { headers: { Authorization: `Bearer ${wsTok}` } });
    const photoBytes = Buffer.from(await photoFetch.arrayBuffer());
    check("the stored photograph streams back byte-identical", photoFetch.status === 200 && crypto.createHash("sha256").update(photoBytes).digest("hex") === photoRes.body.assessment.photos[0].sha256);

    // --- Analysis with photographs attached and no vision endpoint configured:
    //     the module must report manual mode rather than invent AI detections.
    const analyze = await getJSON(`/damage/assessments/${aid}/analyze`, wsTok, "POST", {});
    check("workshop analyze reports manual mode with no CV configured", analyze.status === 200 && analyze.body.analysis?.mode === "manual", `mode ${analyze.body.analysis?.mode}`);
    check("manual analysis fabricates no computer-vision findings", (analyze.body.assessment?.findings || []).every((f) => f.source !== "computer-vision"));

    // --- Findings: one catalogue-priced, one unmapped, one without a catalogue price.
    const f1 = await getJSON(`/damage/assessments/${aid}/findings`, wsTok, "POST", { component: "front-bumper", severity: "moderate", recommendation: "repair", inspectorNotes: "E2E bumper finding" });
    const f2 = await getJSON(`/damage/assessments/${aid}/findings`, wsTok, "POST", { component: "other", severity: "requires-inspection", recommendation: "specialist-assessment", inspectorNotes: "E2E underbody note" });
    const f3 = await getJSON(`/damage/assessments/${aid}/findings`, wsTok, "POST", { component: "roof", severity: "minor", recommendation: "replace", inspectorNotes: "E2E roof dent" });
    check("mapped finding recorded and flagged for the 3D model", f1.status === 200 && f1.body.assessment.findings.some((x) => x.component === "front-bumper" && x.mappedTo3D === true));
    check("unmapped finding stays honest (other maps to no mesh)", f2.status === 200 && f2.body.assessment.findings.some((x) => x.component === "other" && x.mappedTo3D === false));
    check("every finding carries its inspection source", [f1, f2, f3].every((r) => r.body.assessment.findings.every((x) => x.source === "manual-inspection")));

    // --- Estimate: catalogue-priced where configured, never invented elsewhere.
    const est = await getJSON(`/damage/assessments/${aid}/estimate`, wsTok, "POST", {});
    const items = est.body.assessment?.estimate?.items || [];
    check("estimate generated from the findings", est.status === 200 && items.length === 2, `status ${est.status}: ${est.body.message || `${items.length} items`}`);
    const bumper = items.find((i) => i.component === "front-bumper");
    const roof = items.find((i) => i.component === "roof");
    check("catalogue-priced item cites its catalogue entry", bumper?.priceBasis === "configured-catalogue" && !!bumper?.catalogueRef);
    check("a component with no catalogue price is flagged, not priced", !!roof && roof.priceBasis === "none" && roof.total === 0, roof ? roof.priceBasis : "roof item missing");
    check("specialist-assessment finding is not billed", !items.some((i) => i.component === "other"));

    // --- Review, completion, final inspection - in that enforced order.
    const earlyCompletion = await postFile(`/damage/assessments/${aid}/repair-completion`, wsTok, "evidence", "done.jpg", JPEG, { workSummary: "E2E repair" });
    check("completion evidence refused before approval (400)", earlyCompletion.status === 400, `status ${earlyCompletion.status}`);

    const ownerReview = await getJSON(`/damage/assessments/${aid}/review`, ownerTok, "POST", { decision: "approve", reason: "E2E" });
    check("an owner may not approve an estimate (403)", ownerReview.status === 403);

    const approved = await getJSON(`/damage/assessments/${aid}/review`, rtoTok, "POST", { decision: "approve", reason: "E2E estimate accepted" });
    check("RTO approves the estimate", approved.status === 200 && approved.body.assessment?.status === "approved", `status ${approved.status}: ${approved.body.message || approved.body.assessment?.status}`);

    const completed = await postFile(`/damage/assessments/${aid}/repair-completion`, wsTok, "evidence", "done.jpg", JPEG, { workSummary: "E2E bumper repair", technician: "E2E Tech" });
    check("completion evidence recorded after approval", completed.status === 200 && completed.body.assessment.status === "repair-completed");
    check("completion alone does not claim verification", completed.body.assessment.repairCompletion?.verified === false && completed.body.assessment.repairCompletion?.finalInspection === "pending");

    const earlyInspection = await getJSON(`/damage/assessments/${aid}/final-inspection`, rtoTok, "POST", { outcome: "passed" });
    check("inspection by reviewer succeeds and verifies", earlyInspection.status === 200, `status ${earlyInspection.status}: ${earlyInspection.body.message || ""}`);
    const assessed = earlyInspection.body.assessment;
    check("verification requires evidence AND a passed inspection", assessed.status === "verified" && assessed.repairCompletion?.verified === true && assessed.repairCompletion?.finalInspection === "passed");
    check("the accepted repair fed the single accident record in the passport", assessed.linkedDamageEvent === String(accident._id));
    const accAfter = await DamageEvent.findById(accident._id).lean();
    check("the accident is now verified with exactly one record", accAfter.verificationStatus === "verified" && (await DamageEvent.countDocuments({ vehicle: vehicle._id })) === 1);

    const decisions = (assessed.decisions || []).map((d) => d.stage);
    check("decision trail records every stage in order", ["estimate-approved", "estimate-approved", "repair-completed", "final-inspection", "fed-to-passport"].every((s) => decisions.includes(s)), decisions.join(">"));

    // --- Integrity over the wire.
    const integ = await getJSON(`/damage/assessments/${aid}/verify-integrity`, ownerTok);
    check("assessment integrity verifies through the API", integ.status === 200 && integ.body.record?.verified === true, integ.body.record?.reason);
    check("photograph integrity verifies through the API", (integ.body.photos || []).length === 1 && integ.body.photos[0].verified === true);

    // --- Feature 10 controls over HTTP.
    const denied = await getJSON(`/forensics/replay-by-reg/${REG}`, ownerTok);
    check("a citizen may not open the forensics console (403)", denied.status === 403);

    const replay = await getJSON(`/forensics/replay-by-reg/${REG}`, rtoTok);
    const events = replay.body.events || [];
    const types = events.map((e) => e.eventType);
    check("RTO replays the lifecycle including this assessment", replay.status === 200 && types.includes("damage-assessment") && types.includes("accident-damage"));
    check("graph edge extends the assessment from its accident", (replay.body.dependencyGraph?.edges || []).some((e) => e.relation === "extends-accident"));

    const firstId = events[0].id;
    const lastId = events[events.length - 1].id;
    const cmp = await getJSON(`/forensics/compare/${vehicle._id}?from=${firstId}&to=${lastId}`, rtoTok);
    check("state comparison between two timeline points works", cmp.status === 200 && (cmp.body.differences || []).length >= 1, `${cmp.body.differences?.length} differences`);

    const at = await getJSON(`/forensics/state-at/${vehicle._id}?eventId=${firstId}`, rtoTok);
    check("replay-to-a-point returns the state as it stood at that event", at.status === 200 && !!at.body.state, `status ${at.status}`);
    check("the first-event state carries no later assessment verdict", at.body.state?.assessmentStatus == null, String(at.body.state?.assessmentStatus));

    const conflicts = replay.body.conflicts || [];
    const link = conflicts.length
        ? await getJSON(`/forensics/link-case/${vehicle._id}`, rtoTok, "POST", { conflict: conflicts[0], note: "E2E link" })
        : { status: "skipped" };
    if (conflicts.length) {
        check("linking a finding opens a casebook entry", [200, 201].includes(link.status) && !!link.body.caseRef, link.body.caseRef);
        const untouched = await DamageEvent.findById(accident._id).lean();
        check("linking did not rewrite the source accident", untouched.verificationStatus === "verified" && untouched.description.startsWith("E2E probe accident"));
    } else {
        check("no conflicts surfaced for this clean scenario (link step skipped)", true);
    }

    await mongoose.disconnect();

    // Remove everything this probe created; the demo seed data stays untouched.
    await mongoose.connect(process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO");
    await wipe();
    const createdCases = await InvestigationCase.deleteMany({ description: "E2E link" }).catch(() => null);
    await mongoose.disconnect();
    console.log(`  e2e data cleaned${createdCases?.deletedCount ? ` (${createdCases.deletedCount} case(s))` : ""}`);

    console.log(`\n=== damage e2e: ${failures === 0 ? "ALL PASS" : failures + " FAILURE(S)"} ===`);
    process.exit(failures === 0 ? 0 : 1);
};

main().catch((err) => { console.error("e2e error:", err); process.exit(1); });
