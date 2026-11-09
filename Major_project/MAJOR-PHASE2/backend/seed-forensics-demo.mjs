// seed-forensics-demo.mjs
// Builds ONE complete, convincing Vehicle Lifecycle Forensics & Event Replay case
// from the records the application already keeps, so the replay engine can
// reconstruct it exactly as described in the feature specification:
//
//   register (engine ENG-1048)  ->  ownership transfer  ->  accident & repair
//   ->  engine replacement (ENG-8821) with the approval / evidence reference
//       DELIBERATELY left missing  ->  a later inspection that carries the new
//       serial (the dependent record the replay can trace).
//
// Every value below is fictional demo data. The missing approval on the engine
// replacement is a deliberately configured condition for the demonstration, not a
// claim of real fraud. It is idempotent: it removes its own prior rows first.
// It NEVER touches owner B (owner@biochain.com) or any A-to-Z recording row.
//
// Run from the backend folder:  node seed-forensics-demo.mjs
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./src/models/User.js";
import { Vehicle } from "./src/models/Vehicle.js";
import { OwnershipHistory } from "./src/models/OwnershipHistory.js";
import { DamageEvent } from "./src/models/DamageEvent.js";
import { ComponentRecord, ComponentEvent } from "./src/models/ComponentRecord.js";
import { Request } from "./src/models/Request.js";
import { hashRecordContent } from "./src/services/recordAnchorService.js";

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO";

// --- Fixed demo keys --------------------------------------------------------
const VEH = {
    regNumber: "KA45FG1234",
    chassisNumber: "MA12E45FG9012345",
    make: "Hyundai",
    model: "Crete SX",
    year: 2023,
    engineInitial: "ENG-1048",
    engineReplaced: "ENG-8821",
};
const ALPHA = { name: "Arjun Nair", email: "forensics.alpha@biochain.com", aadhaarNumber: "319988776655", dlNumber: "KA0520260112233" };
const BETA = { name: "Beena Rao", email: "forensics.beta@biochain.com", aadhaarNumber: "419988776655", dlNumber: "KA0520260223344" };
const OFFICER = { name: "Forensics RTO Demo", email: "forensics.rto@biochain.com" };

const D = (s) => new Date(s);
const REG_DATE = D("2025-01-10T09:00:00Z");
const TRANSFER_DATE = D("2025-08-18T11:30:00Z");
const ACCIDENT_DATE = D("2026-02-12T14:00:00Z");
const REPLACE_DATE = D("2026-06-03T10:15:00Z");
const INSPECT_DATE = D("2026-07-15T08:45:00Z");

// A hashed-only integrity anchor, stored honestly: no on-chain commit is claimed.
const hashedAnchor = (doc) => ({
    algorithm: "sha256",
    recordHash: hashRecordContent(typeof doc.toObject === "function" ? doc.toObject() : doc),
    status: "hashed_only",
    network: "polygon-amoy",
    txHash: null,
    anchoredAt: null,
    note: "Record hash stored in MongoDB; the database hash is the authoritative safeguard. No on-chain commit performed for this demo record.",
});

async function ensureUser(spec, role, extra = {}) {
    await User.deleteMany({ email: spec.email });
    const passwordHash = await bcrypt.hash("forensics123", 10);
    return User.create({ ...spec, passwordHash, role, verificationStatus: "verified", state: "Karnataka", district: "Bengaluru Urban", ...extra });
}

async function wipePrior() {
    const v = await Vehicle.findOne({ regNumber: VEH.regNumber }).select("_id");
    if (v) {
        const ids = [v._id];
        await ComponentEvent.deleteMany({ vehicle: { $in: ids } });
        await ComponentRecord.deleteMany({ vehicle: { $in: ids } });
        await DamageEvent.deleteMany({ vehicle: { $in: ids } });
        await OwnershipHistory.deleteMany({ vehicle: { $in: ids } });
        await Request.deleteMany({ vehicle: { $in: ids } });
        await Vehicle.deleteMany({ _id: { $in: ids } });
    }
    for (const e of [ALPHA.email, BETA.email, OFFICER.email]) await User.deleteMany({ email: e });
}

async function seed() {
    const alpha = await ensureUser(ALPHA, "owner");
    const beta = await ensureUser(BETA, "owner");
    const officer = await ensureUser(OFFICER, "rto", { rtoDetails: { stateCode: "KA", stateName: "Karnataka", employeeId: "FRN-RTO-0001", rtoOfficeName: "KA-01 Bangalore Central RTO" } });
    console.log(`  users ready: ${alpha.email}, ${beta.email}, ${officer.email}`);

    // Vehicle registered with the ORIGINAL engine serial, now showing the REPLACED
    // serial on its live record - the exact mismatch the replay is meant to trace.
    const vehicle = await Vehicle.create({
        regNumber: VEH.regNumber,
        chassisNumber: VEH.chassisNumber,
        engineNumber: VEH.engineReplaced,
        make: VEH.make,
        model: VEH.model,
        year: VEH.year,
        currentOwner: beta._id,
        registeredBy: alpha._id,
        status: "active",
        registrationDate: REG_DATE,
        issuedByOffice: "KA-01 Bangalore Central RTO",
        issuedByOfficer: officer.name,
        ipfsDocuments: { rcCertificate: "ipfs://demo-rc-ka45fg1234" },
        ownershipHistory: [
            { owner: alpha._id, transferDate: REG_DATE, transferReason: "purchase" },
            { owner: beta._id, transferDate: TRANSFER_DATE, transferReason: "purchase" },
        ],
    });
    console.log(`  vehicle ready: ${vehicle.regNumber} (live engine shows ${vehicle.engineNumber})`);

    // Ownership transfer A -> B.
    await OwnershipHistory.create({
        vehicle: vehicle._id,
        fromOwner: alpha._id,
        toOwner: beta._id,
        transferType: "purchase",
        timestamp: TRANSFER_DATE,
    });

    // Accident and repair, verified by an officer (owner-uploaded, then reviewed).
    const damage = new DamageEvent({
        vehicle: vehicle._id,
        regNumber: vehicle.regNumber,
        eventType: "accident-damage",
        eventDate: ACCIDENT_DATE,
        reportDate: ACCIDENT_DATE,
        description: "Front-end collision; bumper and left fender damaged, radiator support bent. Repaired at an authorised workshop.",
        severity: "moderate",
        affectedAreas: ["front-bumper", "left-fender", "radiator-support"],
        verificationStatus: "verified",
        verifiedBy: officer._id,
        verifiedAt: D("2026-02-20T10:00:00Z"),
        submittedBy: beta._id,
        submitterName: beta.name,
        sourceChannel: "owner-upload",
        accident: { location: "Bengaluru", injuries: "minor", policeStation: "Central", firNumber: "Fir-2026-0045" },
        officerReview: { outcome: "verified", remarks: "Repair evidence reviewed and accepted.", reviewedBy: officer._id, reviewedByName: officer.name, reviewedByRole: "rto", reviewedAt: D("2026-02-20T10:00:00Z") },
        evidence: [],
    });
    damage.anchor = hashedAnchor(damage);
    await damage.save();

    // Engine ENG-1048: installed at registration (with a reference), then REPLACED.
    const oldEngine = new ComponentRecord({
        componentType: "engine",
        serialNumber: VEH.engineInitial,
        vehicle: vehicle._id,
        regNumber: vehicle.regNumber,
        status: "replaced",
        evidenceReference: "REG-DOC-ENG1048",
    });
    oldEngine.anchor = hashedAnchor(oldEngine);
    await oldEngine.save();
    await ComponentEvent.create({
        component: oldEngine._id, vehicle: vehicle._id, eventType: "installed",
        eventDate: REG_DATE, reason: "Fitted at registration", recordedBy: officer._id,
        evidenceReference: "REG-DOC-ENG1048",
    });
    await ComponentEvent.create({
        component: oldEngine._id, vehicle: vehicle._id, eventType: "replaced",
        eventDate: REPLACE_DATE, reason: "Engine replaced after accident repair",
        recordedBy: officer._id, evidenceReference: null, // approval / evidence deliberately missing
    });

    // Engine ENG-8821: installed at the replacement WITHOUT an approval reference
    // (the flagged event), then inspected later (a dependent record carrying the new serial).
    const newEngine = new ComponentRecord({
        componentType: "engine",
        serialNumber: VEH.engineReplaced,
        vehicle: vehicle._id,
        regNumber: vehicle.regNumber,
        status: "active",
        evidenceReference: null,
    });
    newEngine.anchor = hashedAnchor(newEngine);
    await newEngine.save();
    await ComponentEvent.create({
        component: newEngine._id, vehicle: vehicle._id, eventType: "installed",
        eventDate: REPLACE_DATE, reason: "Replacement engine fitted",
        recordedBy: officer._id, evidenceReference: null, // identity change with no supporting reference
    });
    await ComponentEvent.create({
        component: newEngine._id, vehicle: vehicle._id, eventType: "inspected",
        eventDate: INSPECT_DATE, inspectionResult: "pass",
        reason: `Post-replacement inspection of ${VEH.engineReplaced}`,
        recordedBy: officer._id, evidenceReference: "INSP-8821",
    });

    // A later resale request that depends on the vehicle's current (replaced) record.
    await Request.create({
        type: "transfer",
        vehicle: vehicle._id,
        seller: beta._id,
        status: "pending",
        createdAt: D("2026-08-01T12:00:00Z"),
        offer: { salePrice: 1450000, message: "Resale after engine replacement - buyer to review lifecycle." },
    });

    console.log(`  scenario seeded: ${VEH.engineInitial} -> ${VEH.engineReplaced} (approval reference missing on the replacement)`);
}

const main = async () => {
    await mongoose.connect(uri);
    console.log(`Connected to ${uri} for Forensics demo seeding`);
    await wipePrior();
    await seed();
    console.log("Forensics demo seed complete. Replay it by searching registration " + VEH.regNumber + " in Vehicle Forensics.");
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error("Forensics demo seed failed:", err);
    process.exit(1);
});
