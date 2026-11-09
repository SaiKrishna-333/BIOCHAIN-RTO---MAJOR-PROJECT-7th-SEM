// seed-damage-demo.mjs
// Feature 9: 3D Vehicle Damage & Repair Intelligence - one complete, honest case.
//
// It builds a vehicle with a single accident, an assessment that EXTENDS that accident
// (never a duplicate), photographs with per-file hashes, component findings (each with
// real provenance and the 3D-mapping flag), a catalogue-priced estimate, an authorised
// review, workshop completion evidence and a passed final inspection that verified the
// repair and fed the damage passport. A few service/odometer records are added so the
// Vehicle Lifecycle Forensics replay has more to show (including an odometer reading
// that decreases - a review flag, never a fraud verdict).
//
// Everything here is clearly-labelled demo data. The analysis mode is "manual" because
// no computer-vision endpoint is configured - so findings are recorded as assessor
// observations, not as AI detections, exactly as the module behaves in production.
//
// Idempotent: it removes its own prior rows first. It NEVER touches owner B
// (owner@biochain.com) or any other demo account.
//
// Run from the backend folder:  node seed-damage-demo.mjs
import "dotenv/config";
import zlib from "zlib";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./src/models/User.js";
import { Vehicle } from "./src/models/Vehicle.js";
import { OwnershipHistory } from "./src/models/OwnershipHistory.js";
import { DamageEvent } from "./src/models/DamageEvent.js";
import { ServiceRecord } from "./src/models/ServiceRecord.js";
import {
    DamageAssessment,
    RepairCostCatalogue,
    nextAssessmentRef,
} from "./src/models/DamageAssessment.js";
import { hashRecordContent, hashFileBuffer } from "./src/services/recordAnchorService.js";

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO";

const VEH = {
    regNumber: "KA46DH5566",
    chassisNumber: "MB22K88DH7766554",
    engineNumber: "ENG-DH5566",
    make: "Maruti Suzuki",
    model: "Baleno ZXi",
    year: 2022,
};
const OWNER = { name: "Divya Menon", email: "damage.owner@biochain.com", aadhaarNumber: "519988776655", dlNumber: "KA0620260011223" };
const WORKSHOP = { name: "Deccan Certified Works", email: "damage.workshop@biochain.com", workshopDetails: { verified: true, affiliatedManufacturer: "Maruti Suzuki" } };
const OFFICER = { name: "Damage RTO Demo", email: "damage.rto@biochain.com" };

const D = (s) => new Date(s);
const REG_DATE = D("2025-03-05T09:00:00Z");
const ACCIDENT_DATE = D("2026-05-20T18:30:00Z");
const ANALYSIS_DATE = D("2026-05-24T11:00:00Z");
const COMPLETION_DATE = D("2026-06-10T16:00:00Z");

// The seeded "photographs" are synthetic illustrations drawn here, not real pictures
// of a real car - the UI labels them as demo captures. They are encoded as genuine
// PNG bytes so the assessment console can display them and so each file has a real
// byte length and a real SHA-256 to anchor, exactly like an uploaded photograph.
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c;
    }
    return t;
})();
const crc32 = (buf) => {
    let c = -1;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
};
const pngChunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
};
const encodePng = (width, height, pixels) => {
    const raw = Buffer.alloc((width * 4 + 1) * height);
    for (let y = 0; y < height; y++) {
        raw[y * (width * 4 + 1)] = 0; // no per-scanline filter
        pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // 8-bit depth
    ihdr[9] = 6; // RGBA
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk("IHDR", ihdr),
        pngChunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
        pngChunk("IEND", Buffer.alloc(0)),
    ]);
};

const CANVAS = { w: 640, h: 400 };
const drawScene = (view) => {
    const { w, h } = CANVAS;
    const IN = { x0: 7, y0: 7, x1: w - 8, y1: h - 8 }; // the picture sits inside the mount
    const px = Buffer.alloc(w * h * 4);
    const put = (x, y, r, g, b) => {
        if (x < IN.x0 || y < IN.y0 || x > IN.x1 || y > IN.y1) return;
        const i = (y * w + x) * 4;
        px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    };
    const rect = (x0, y0, x1, y1, c) => {
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, ...c);
    };
    const disc = (cx, cy, rad, c) => {
        for (let y = cy - rad; y <= cy + rad; y++)
            for (let x = cx - rad; x <= cx + rad; x++)
                if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) put(x, y, ...c);
    };
    const ring = (cx, cy, rad, thick, c) => {
        for (let y = cy - rad; y <= cy + rad; y++)
            for (let x = cx - rad; x <= cx + rad; x++) {
                const d2 = (x - cx) ** 2 + (y - cy) ** 2;
                if (d2 <= rad * rad && d2 >= (rad - thick) ** 2) put(x, y, ...c);
            }
    };

    // White mount with a dark edge, drawn first; every scene element is clipped to
    // the inner rectangle, so the frame always survives.
    for (let i = 0; i < px.length; i += 4) { px[i] = 255; px[i + 1] = 255; px[i + 2] = 255; px[i + 3] = 255; }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (x >= 6 && y >= 6 && x < w - 6 && y < h - 6) continue;
        const i = (y * w + x) * 4;
        px[i] = 30; px[i + 1] = 41; px[i + 2] = 59; px[i + 3] = 255;
    }

    // Workshop wall, floor with bay markings, and the accent rail.
    for (let y = IN.y0; y <= 300; y++)
        for (let x = IN.x0; x <= IN.x1; x++) put(x, y, 210 - Math.floor(y / 22), 218 - Math.floor(y / 26), 228 - Math.floor(y / 40));
    rect(IN.x0, 300, IN.x1, IN.y1, [152, 157, 164]);
    for (let x = 20; x < w; x += 46) rect(x, 300, x + 2, IN.y1, [133, 138, 145]);
    rect(IN.x0, IN.y0, IN.x1, IN.y0 + 14, [30, 90, 168]);

    // Hatchback silhouette: body, cabin, glazing, bumpers, lamps and wheels.
    rect(70, 190, 570, 312, [62, 92, 132]);
    rect(170, 128, 440, 192, [74, 106, 148]);
    rect(186, 140, 296, 182, [188, 212, 231]);
    rect(310, 140, 424, 182, [188, 212, 231]);
    rect(60, 240, 82, 296, [205, 209, 215]);
    rect(558, 240, 580, 296, [205, 209, 215]);
    rect(96, 222, 160, 248, [246, 234, 182]);
    rect(500, 222, 556, 244, [204, 88, 82]);
    disc(180, 312, 46, [40, 44, 50]);
    disc(470, 312, 46, [40, 44, 50]);
    ring(180, 312, 46, 7, [24, 26, 30]);
    ring(470, 312, 46, 7, [24, 26, 30]);

    // The reported area carries diagonal hatching; the rest stays neutral so the
    // illustration never claims an area it does not depict.
    const areas = {
        front: [70, 190, 180, 300],
        "close-up": [60, 180, 210, 310],
        right: [440, 130, 580, 300],
        rear: [480, 190, 580, 300],
    };
    const a = areas[view] || areas.front;
    for (let d = -140; d < 240; d += 14)
        for (let x = a[0]; x <= a[2]; x++) {
            const y = a[1] + (x - a[0]) + d;
            if (y >= a[1] && y <= a[3]) put(x, y, 196, 60, 48);
        }
    return px;
};
const scenePng = (view) => encodePng(CANVAS.w, CANVAS.h, drawScene(view));

const makePhoto = (fileName, view) => {
    const data = scenePng(view);
    return { fileName, contentType: "image/png", fileSize: data.length, data, sha256: hashFileBuffer(data), storage: "inline", view, uploadedAt: ANALYSIS_DATE };
};

const hashedAnchor = (doc) => ({
    algorithm: "sha256",
    // Hash the document exactly the way damageRoutes.reAnchor does - straight from
    // the Mongoose doc - so the stored hash and a later integrity re-check see the
    // same representation of nested Buffers and subdocument arrays.
    recordHash: hashRecordContent(doc),
    status: "hashed_only",
    network: "polygon-amoy",
    txHash: null,
    anchoredAt: null,
    note: "Record hash stored in MongoDB; the database hash is the authoritative safeguard. No on-chain commit performed for this demo record.",
});

const LIMITATION =
    "Photographs reveal visible surface damage only. They cannot confirm hidden structural or mechanical damage, and a photo assessment does not certify that the vehicle is roadworthy.";

async function ensureUser(spec, role, extra = {}) {
    await User.deleteMany({ email: spec.email });
    const passwordHash = await bcrypt.hash("damage123", 10);
    return User.create({ ...spec, passwordHash, role, verificationStatus: "verified", state: "Karnataka", district: "Bengaluru Urban", ...extra });
}

async function wipePrior() {
    const v = await Vehicle.findOne({ regNumber: VEH.regNumber }).select("_id");
    if (v) {
        await DamageAssessment.deleteMany({ vehicle: v._id });
        await ServiceRecord.deleteMany({ vehicle: v._id });
        await DamageEvent.deleteMany({ vehicle: v._id });
        await OwnershipHistory.deleteMany({ vehicle: v._id });
        await Vehicle.deleteMany({ _id: v._id });
    }
    for (const e of [OWNER.email, WORKSHOP.email, OFFICER.email]) await User.deleteMany({ email: e });
}

// Configured parts + labour base prices. Estimates read prices ONLY from here, so a
// number is always traceable to the catalogue rather than invented at review time.
const CATALOGUE = [
    { component: "front-bumper", displayName: "Front bumper", category: "panel", repairLabour: 2500, replacePart: 8000, replaceLabour: 2000 },
    { component: "fender-front-left", displayName: "Front left fender", category: "panel", repairLabour: 3000, replacePart: 6000, replaceLabour: 2000 },
    { component: "headlight-left", displayName: "Left headlight", category: "electrical", repairLabour: 500, replacePart: 4500, replaceLabour: 800 },
    { component: "radiator", displayName: "Radiator", category: "cooling", repairLabour: 4000, replacePart: 12000, replaceLabour: 3000 },
    { component: "door-front-right", displayName: "Front right door", category: "panel", repairLabour: 3000, replacePart: 9000, replaceLabour: 2500 },
    { component: "windshield", displayName: "Windshield", category: "glass", repairLabour: 2000, replacePart: 11000, replaceLabour: 2500 },
];

async function seed() {
    for (const c of CATALOGUE) {
        await RepairCostCatalogue.findOneAndUpdate({ component: c.component }, { $set: c }, { upsert: true });
    }
    console.log(`  catalogue ready: ${CATALOGUE.length} components`);

    const owner = await ensureUser(OWNER, "owner");
    const workshop = await ensureUser(WORKSHOP, "workshop");
    const officer = await ensureUser(OFFICER, "rto", { rtoDetails: { stateCode: "KA", stateName: "Karnataka", employeeId: "DMG-RTO-0001", rtoOfficeName: "KA-06 Bangalore BTP RTO" } });
    console.log(`  users ready: ${owner.email}, ${workshop.email}, ${officer.email}`);

    const vehicle = await Vehicle.create({
        regNumber: VEH.regNumber,
        chassisNumber: VEH.chassisNumber,
        engineNumber: VEH.engineNumber,
        make: VEH.make,
        model: VEH.model,
        year: VEH.year,
        currentOwner: owner._id,
        registeredBy: owner._id,
        status: "active",
        registrationDate: REG_DATE,
        issuedByOffice: "KA-06 Bangalore BTP RTO",
        ipfsDocuments: { rcCertificate: "ipfs://demo-rc-ka46dh5566" },
        ownershipHistory: [{ owner: owner._id, transferDate: REG_DATE, transferReason: "purchase" }],
    });

    await OwnershipHistory.create({
        vehicle: vehicle._id, fromOwner: owner._id, toOwner: owner._id,
        transferType: "purchase", timestamp: REG_DATE,
    });

    // The ONE accident record the assessment will extend (already officer-verified,
    // because the final inspection in this scenario passed and fed the passport).
    const accident = new DamageEvent({
        vehicle: vehicle._id,
        regNumber: vehicle.regNumber,
        eventType: "accident-damage",
        eventDate: ACCIDENT_DATE,
        reportDate: ACCIDENT_DATE,
        description: "Low-speed frontal impact on the left side: bumper cracked, left fender creased, headlight housing broken, radiator seeping. Right door only scuffed.",
        severity: "moderate",
        affectedAreas: ["front-bumper", "fender-front-left", "headlight-left", "radiator"],
        verificationStatus: "verified",
        verifiedBy: officer._id,
        verifiedAt: COMPLETION_DATE,
        submittedBy: owner._id,
        submitterName: owner.name,
        sourceChannel: "owner-upload",
        accident: { location: "Bengaluru", injuries: "none", policeStation: "BTP", firNumber: "FIR-2026-0123" },
        officerReview: { outcome: "verified", remarks: "Repair verified via assessment final inspection.", reviewedBy: officer._id, reviewedByName: officer.name, reviewedByRole: "rto", reviewedAt: COMPLETION_DATE },
        evidence: [],
    });
    accident.anchor = hashedAnchor(accident);
    await accident.save();

    // A couple of service/odometer records. The second shows a LOWER reading than the
    // first, which the forensics engine flags as an odometer anomaly for review - it is
    // a lead, not a verdict (could be a data-entry error or a replaced instrument).
    await ServiceRecord.create([
        { vehicle: vehicle._id, regNumber: vehicle.regNumber, serviceType: "periodic-service", serviceDate: D("2025-09-01T10:00:00Z"), odometerKm: 21500, description: "First paid service.", status: "verified", submittedBy: workshop._id, submitterName: workshop.name },
        { vehicle: vehicle._id, regNumber: vehicle.regNumber, serviceType: "inspection", serviceDate: D("2026-01-15T10:00:00Z"), odometerKm: 19800, description: "Reading recorded lower than the previous service - flagged for review.", status: "flagged_for_review", flagReason: "Odometer reading decreased versus last recorded value.", submittedBy: workshop._id, submitterName: workshop.name },
    ]);

    // ---- The assessment: extends the accident, manual mode, verified repair. ----
    const photos = [
        makePhoto("front-view.png", "front"),
        makePhoto("front-left-close.png", "close-up"),
        makePhoto("right-side.png", "right"),
    ];

    const findings = [
        { component: "front-bumper", label: "Front bumper - crack", detectionState: "detected", source: "manual-inspection", sourceDetail: `${workshop.name} reviewed photo #1`, severity: "severe", recommendation: "replace", linkedPhotoIndex: 0, inspectorNotes: "Through-crack across the lower lip.", mappedTo3D: true, assessedBy: workshop._id, assessedByName: workshop.name },
        { component: "fender-front-left", label: "Front left fender - crease", detectionState: "detected", source: "manual-inspection", sourceDetail: `${workshop.name} reviewed photo #2`, severity: "moderate", recommendation: "repair", linkedPhotoIndex: 1, inspectorNotes: "Crease without paint fracture; paintable dent repair.", mappedTo3D: true, assessedBy: workshop._id, assessedByName: workshop.name },
        { component: "headlight-left", label: "Left headlight - broken housing", detectionState: "detected", source: "manual-inspection", sourceDetail: `${workshop.name} reviewed photo #2`, severity: "minor", recommendation: "replace", linkedPhotoIndex: 1, inspectorNotes: "Housing cracked, lens intact.", mappedTo3D: true, assessedBy: workshop._id, assessedByName: workshop.name },
        { component: "radiator", label: "Radiator - seep", detectionState: "needs-review", source: "manual-inspection", sourceDetail: `${workshop.name} reviewed photo #1`, severity: "severe", recommendation: "replace", linkedPhotoIndex: 0, inspectorNotes: "Coolant residue at the left tank; pressure test advised.", mappedTo3D: true, assessedBy: workshop._id, assessedByName: workshop.name },
        { component: "door-front-right", label: "Front right door - scuff only", detectionState: "detected", source: "manual-inspection", sourceDetail: `${workshop.name} reviewed photo #3`, severity: "no-visible-damage", recommendation: "no-action", linkedPhotoIndex: 2, inspectorNotes: "Surface scuff, no panel deformation.", mappedTo3D: true, assessedBy: workshop._id, assessedByName: workshop.name },
        { component: "other", label: "Undercarriage - not visible in photos", detectionState: "not-assessed", source: "manual-inspection", sourceDetail: "Cannot be judged from these photographs", severity: "requires-inspection", recommendation: "specialist-assessment", linkedPhotoIndex: null, inspectorNotes: "Chassis/suspension damage cannot be confirmed or denied from exterior photos.", mappedTo3D: false, assessedBy: workshop._id, assessedByName: workshop.name },
    ];

    // Estimate items derive ONLY from the repair/replace findings and catalogue prices.
    const price = Object.fromEntries(CATALOGUE.map((c) => [c.component, c]));
    const estItems = [];
    for (const f of findings) {
        if (f.recommendation !== "repair" && f.recommendation !== "replace") continue;
        const c = price[f.component];
        const isReplace = f.recommendation === "replace";
        const partsCost = isReplace ? c.replacePart : 0;
        const labourCost = isReplace ? c.replaceLabour : c.repairLabour;
        estItems.push({ component: f.component, findingLabel: f.label, proposedAction: f.recommendation, partsCost, labourCost, additionalCost: 0, total: partsCost + labourCost, catalogueRef: c.component, priceBasis: "configured-catalogue", note: `Catalogue base price for ${c.displayName}. Estimate only.` });
    }
    const sum = (k) => estItems.reduce((n, it) => n + it[k], 0);

    const evidence = [makePhoto("completion-front.png", "front")];
    evidence[0].uploadedAt = COMPLETION_DATE;

    const assessment = new DamageAssessment({
        assessmentRef: await nextAssessmentRef(),
        vehicle: vehicle._id,
        regNumber: vehicle.regNumber,
        linkedDamageEvent: accident._id,
        status: "verified",
        incidentNotes: "Owner reported a low-speed frontal impact; workshop inspected the vehicle in the bay.",
        suspectedArea: "front-left",
        photos,
        findings,
        analysis: { mode: "manual", ranAt: ANALYSIS_DATE, engineName: null, note: "No computer-vision endpoint is configured for this deployment, so findings were recorded by an authorised assessor from the photographs.", limitation: LIMITATION },
        estimate: {
            version: 1, currency: "INR", items: estItems,
            partsTotal: sum("partsCost"), labourTotal: sum("labourCost"), additionalTotal: 0, grandTotal: sum("total"),
            status: "approved", createdBy: workshop._id, createdByName: workshop.name, createdAt: ANALYSIS_DATE,
            note: "An estimate, not a guaranteed final bill. Prices come only from the configured catalogue.",
        },
        decisions: [
            { stage: "estimate-approved", decision: "recorded", reason: "Estimate v1 submitted for review", by: workshop._id, byName: workshop.name, byRole: "workshop", at: ANALYSIS_DATE },
            { stage: "estimate-approved", decision: "approved", reason: "Estimate approved for the workshop to proceed", by: officer._id, byName: officer.name, byRole: "rto", at: D("2026-05-26T10:00:00Z") },
            { stage: "repair-completed", decision: "recorded", reason: "Workshop submitted completion evidence", by: workshop._id, byName: workshop.name, byRole: "workshop", at: COMPLETION_DATE },
            { stage: "final-inspection", decision: "approved", reason: "Final inspection passed with completion evidence", by: officer._id, byName: officer.name, byRole: "rto", at: COMPLETION_DATE },
            { stage: "fed-to-passport", decision: "recorded", reason: "Accepted repair reflected in the Damage and Repair Passport", by: officer._id, byName: officer.name, byRole: "rto", at: COMPLETION_DATE },
        ],
        repairCompletion: {
            workshop: workshop.name, technician: "S. Kumar", completedAt: COMPLETION_DATE,
            workSummary: "Front bumper replaced, left fender dent-repaired and refinished, left headlight replaced, radiator replaced and system refilled. Pressure test passed.",
            evidence, finalInspection: "passed", inspectedBy: officer._id, verified: true,
            note: "Repair verified after a passed final inspection with completion evidence photographs.",
        },
        submittedBy: workshop._id,
        submitterName: workshop.name,
    });
    // Match the production flow exactly: save first, then anchor the saved document
    // (the same in-memory representation damageRoutes.reAnchor hashes), so a later
    // integrity re-check against the stored hash passes.
    await assessment.save();
    assessment.anchor = hashedAnchor(assessment);
    await assessment.save();

    console.log(`  damage assessment seeded: ${assessment.assessmentRef} linked to accident ${accident._id} (verified)`);
    console.log(`  estimate grand total: INR ${sum("total")} (catalogue-priced)`);
}

const main = async () => {
    await mongoose.connect(uri);
    console.log(`Connected to ${uri} for Damage demo seeding`);
    await wipePrior();
    await seed();
    console.log("Damage demo seed complete. Open 3D Damage & Repair and search " + VEH.regNumber + ".");
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error("Damage demo seed failed:", err);
    process.exit(1);
});
