// cleanup-demo.mjs - remove every row the A-to-Z recording creates.
// Removes only the rows the demo/seed scripts create, keyed by their unique values,
// so a second run starts from a clean slate. It NEVER touches the seeded owner B
// (owner@biochain.com) or any other demo account.
// Run from the backend folder:  node cleanup-demo.mjs
import "dotenv/config";
import mongoose from "mongoose";
import { User } from "./src/models/User.js";
import { Vehicle } from "./src/models/Vehicle.js";
import { Challan } from "./src/models/Challan.js";
import { TheftReport } from "./src/models/TheftReport.js";
import { Request } from "./src/models/Request.js";
import { InheritanceTransfer } from "./src/models/InheritanceTransfer.js";
import { OwnershipHistory } from "./src/models/OwnershipHistory.js";
import { ServiceRecord } from "./src/models/ServiceRecord.js";
import { ComponentRecord, ComponentEvent } from "./src/models/ComponentRecord.js";
import { DamageEvent } from "./src/models/DamageEvent.js";
import { DamageAssessment, RepairCostCatalogue } from "./src/models/DamageAssessment.js";
import { BatteryPassport } from "./src/models/BatteryPassport.js";
import { InvestigationCase } from "./src/models/InvestigationCase.js";
import { AnomalyAlert } from "./src/models/AnomalyAlert.js";
import { IdentityConflict } from "./src/models/IdentityConflict.js";
import { TransferApprovalWorkflow } from "./src/models/TransferApprovalWorkflow.js";
import { SmartMigration } from "./src/models/SmartMigration.js";
import { VehicleIntelRequest } from "./src/models/VehicleIntelRequest.js";
import { UserIdCard } from "./src/models/UserIdCard.js";
import { Notification } from "./src/models/Notification.js";

// Citizen A (registered live) and Citizen C (seeded). B is never removed.
const CITIZEN_EMAIL = "ananya.demo@biochain.com";
const CITIZEN_AADHAAR = "119988776655";
const CITIZEN_DL = "KA0520260099887";
const CAROL_EMAIL = "carol.demo@biochain.com";
const CAROL_AADHAAR = "229988776655";
const CAROL_DL = "KA0520260088776";

// Vehicle Lifecycle Forensics demo accounts (owner A, owner B of the case, officer).
const FORENSIC_EMAILS = [
    "forensics.alpha@biochain.com",
    "forensics.beta@biochain.com",
    "forensics.rto@biochain.com",
];

// 3D Damage & Repair Intelligence demo accounts (owner, workshop, officer).
const DAMAGE_EMAILS = [
    "damage.owner@biochain.com",
    "damage.workshop@biochain.com",
    "damage.rto@biochain.com",
];
// Catalogue components the damage seed configures; removed for a clean slate.
const DAMAGE_CATALOGUE_COMPONENTS = [
    "front-bumper", "fender-front-left", "headlight-left", "radiator", "door-front-right", "windshield",
];

// Every registration number the recording can attach rows to. V1 is matched on
// chassis (its reg changes on the inter-state move), so all reg variants are listed.
const REGISTRATIONS = [
    "KA45CF1234", "TN45CF1234", // V1 (before / after inter-state)
    "KA45CF2468",               // V2 EV
    "KA45CF1357",               // V3 theft
    "KA45CF8642",               // V4 inheritance
    "XX00SHDW01",               // SHADOW clone
    "KA45FG1234",               // Forensics replay case
    "KA46DH5566",               // 3D Damage & Repair case
];
const CHASSIS = [
    "MA12E45FG90112233", // V1
    "MA12E45FG9024680", // V2
    "MA12E45FG9031357", // V3
    "MA12E45FG9086420", // V4
    "ma12-e45fg-90112233", // SHADOW (normalises to V1)
    "MA12E45FG9012345", // Forensics replay case
    "MB22K88DH7766554", // 3D Damage & Repair case
];
const ENGINES = [
    "EN45DE9988771", // V1
    "EN45DE9924681", // V2
    "EN45DE9935711", // V3
    "EN45DE9986421", // V4
    "EN45SHDW9988771", // SHADOW
    "ENG-DH5566", // 3D Damage & Repair case
];

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO";
await mongoose.connect(uri);

const out = [];
const del = async (label, model, q) => { out.push(`${label}: ${(await model.deleteMany(q)).deletedCount}`); };

// The demo vehicles (matched by any of reg / chassis / engine, so a re-registered
// V1 is still found).
const vehicles = await Vehicle.find({
    $or: [
        { regNumber: { $in: REGISTRATIONS } },
        { chassisNumber: { $in: CHASSIS } },
        { engineNumber: { $in: ENGINES } },
    ]
}).select("_id");
const vIds = vehicles.map((v) => v._id);
const inV = { $in: vIds };

if (vIds.length) {
    await del("challans", Challan, { vehicle: inV });
    await del("theft", TheftReport, { vehicle: inV });
    await del("inheritance", InheritanceTransfer, { vehicle: inV });
    await del("requests", Request, { vehicle: inV });
    await del("service", ServiceRecord, { vehicle: inV });
    await del("components", ComponentRecord, { vehicle: inV });
    await del("component-events", ComponentEvent, { vehicle: inV });
    await del("damage", DamageEvent, { vehicle: inV });
    await del("damage-assessments", DamageAssessment, { vehicle: inV });
    await del("battery", BatteryPassport, { vehicle: inV });
    await del("intel-requests", VehicleIntelRequest, { vehicle: inV });
    await del("ownership-history", OwnershipHistory, { vehicle: inV });
    await del("workflows", TransferApprovalWorkflow, { vehicle: inV });
    await del("notifications-vehicle", Notification, { relatedVehicle: inV });
}

// The three officer-analytics / casebook collections are regenerated wholesale by
// the recording (the anomaly and cloning tabs run their own scan, and the casebook
// creates fresh cases), and every row in them is a demo artifact. They are cleared
// unconditionally because their rows often carry a null vehicle/reg linkage (the
// casebook "Vehicle ID" is optional, and review-opened cases inherit none), which a
// vehicle-scoped delete would miss. Leftover rows otherwise corrupt the detectors on
// the next run: a stale caseRef makes nextCaseRef() collide on its unique index, and a
// stale conflict collides on the (conflictType, identifierValue) unique index.
await del("cases", InvestigationCase, {});
await del("anomalies", AnomalyAlert, {});
await del("conflicts", IdentityConflict, {});

// The Smart Migration Orchestrator is exercised only by the recording and its own
// end-to-end test, so every migration row and every migration notification is a
// demo artefact. They are cleared wholesale to keep the officer queue pristine.
await del("smart-migrations", SmartMigration, {});
await del("migration-notifications", Notification, {
    type: { $in: ["migration_stage", "migration_deadline", "migration_overdue", "migration_exception"] },
});

// Rows keyed only by the (now-changing) registration number.
await del("challans-by-reg", Challan, { regNumber: { $in: REGISTRATIONS } });
await del("workflows-by-reg", TransferApprovalWorkflow, { regNumber: { $in: REGISTRATIONS } });

// Any surviving request / offer addressed to the demo citizens.
await del("requests-by-citizen", Request, {
    buyerEmail: { $in: [CITIZEN_EMAIL, CAROL_EMAIL] },
});
await del("requests-by-offer", Request, {
    "offer.buyerEmail": { $in: [CITIZEN_EMAIL, CAROL_EMAIL] },
});

// The demo vehicles themselves.
await del("vehicles", Vehicle, { _id: inV });

// Citizen A and Citizen C accounts + their identity artefacts. B is never touched.
const demoUsers = await User.find({
    $or: [
        { email: { $in: [CITIZEN_EMAIL, CAROL_EMAIL] } },
        { aadhaarNumber: { $in: [CITIZEN_AADHAAR, CAROL_AADHAAR] } },
        { dlNumber: { $in: [CITIZEN_DL, CAROL_DL] } },
    ]
}).select("_id");
const uIds = demoUsers.map((u) => u._id);
if (uIds.length) {
    await del("user-id-cards", UserIdCard, { user: { $in: uIds } });
    await del("notifications-user", Notification, { recipient: { $in: uIds } });
}
await del("citizens", User, {
    $or: [
        { email: { $in: [CITIZEN_EMAIL, CAROL_EMAIL] } },
        { aadhaarNumber: { $in: [CITIZEN_AADHAAR, CAROL_AADHAAR] } },
        { dlNumber: { $in: [CITIZEN_DL, CAROL_DL] } },
    ]
});

// Forensics replay-case accounts and any artefacts keyed to them.
const forensicsUsers = await User.find({ email: { $in: FORENSIC_EMAILS } }).select("_id");
const fIds = forensicsUsers.map((u) => u._id);
if (fIds.length) {
    await del("forensics-id-cards", UserIdCard, { user: { $in: fIds } });
    await del("forensics-notifications", Notification, { recipient: { $in: fIds } });
    await del("forensics-requests", Request, { seller: { $in: fIds } });
}
await del("forensics-users", User, { email: { $in: FORENSIC_EMAILS } });

// 3D Damage & Repair accounts, their assessments and the configured catalogue rows.
const damageUsers = await User.find({ email: { $in: DAMAGE_EMAILS } }).select("_id");
const dIds = damageUsers.map((u) => u._id);
if (dIds.length) {
    await del("damage-assessments-by-submitter", DamageAssessment, { submittedBy: { $in: dIds } });
    await del("damage-notifications", Notification, { recipient: { $in: dIds } });
}
await del("damage-users", User, { email: { $in: DAMAGE_EMAILS } });
await del("damage-catalogue", RepairCostCatalogue, { component: { $in: DAMAGE_CATALOGUE_COMPONENTS } });

console.log("cleanup -> " + out.join(", "));
await mongoose.disconnect();
