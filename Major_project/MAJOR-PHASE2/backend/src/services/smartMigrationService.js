// smartMigrationService.js
// The engine behind the BioChain Smart Migration Orchestrator.
//
// Every capability the spec asks for lives here as a small, honest function:
//   - runPreCheck            (Feature A) inspects only records that actually exist
//   - analyseDocumentIntelligence (Feature B) OCR + comparison + Form 28/27 drafts
//   - buildStages / advanceStage  (Feature C) dependency-ordered two-state tracker
//   - estimateMigrationCost  (Feature D) configurable, clearly-labelled estimates
//   - computeDeadline        (Feature E) per-state NOC validity + reminders
//   - generateMigrationPassport (Feature F) reuses the existing passport generator
//   - reconcile              (Feature G) old-vs-new record comparison + exceptions
//
// Two rules are enforced throughout: missing data is reported as "needs_review",
// never as a passed check; and nothing here mutates a source record to hide a
// discrepancy - reconciliation only raises exceptions for an officer to resolve.

import crypto from "crypto";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Challan } from "../models/Challan.js";
import { Request } from "../models/Request.js";
import { TheftReport } from "../models/TheftReport.js";
import { SmartMigration } from "../models/SmartMigration.js";
import {
    generateVehiclePassport,
    extractStateFromRegNumber,
    STATE_RTO_CODES,
} from "./crossStateInteroperability.js";
import { ocrImageBuffer, parseIdentityText } from "./ocrService.js";
import { createNotification, createRoleNotification } from "./notificationService.js";

// ---------------------------------------------------------------------------
// Feature D + E: configurable, per-state migration rules.
//
// These are DEMONSTRATION values maintained inside the application, not official
// government rate tables. Each rule carries a source string and an effective date
// so the UI can label every number as an estimate and show where it came from.
// A state absent from this map is reported as unsupported rather than guessed.
// ---------------------------------------------------------------------------
export const STATE_MIGRATION_RULES = {
    KA: { roadTaxPct: 0.06, registrationFee: 600, reassignmentFee: 300, nocValidityDays: 180 },
    TN: { roadTaxPct: 0.08, registrationFee: 500, reassignmentFee: 300, nocValidityDays: 180 },
    TS: { roadTaxPct: 0.07, registrationFee: 500, reassignmentFee: 300, nocValidityDays: 180 },
    MH: { roadTaxPct: 0.05, registrationFee: 600, reassignmentFee: 300, nocValidityDays: 180 },
    DL: { roadTaxPct: 0.04, registrationFee: 500, reassignmentFee: 300, nocValidityDays: 180 },
    GJ: { roadTaxPct: 0.06, registrationFee: 500, reassignmentFee: 300, nocValidityDays: 180 },
    KL: { roadTaxPct: 0.06, registrationFee: 500, reassignmentFee: 300, nocValidityDays: 180 },
    UP: { roadTaxPct: 0.07, registrationFee: 500, reassignmentFee: 300, nocValidityDays: 180 },
};

const RULE_SOURCE = "BioChain configured demo rule table (not an official state gazette)";
const RULE_EFFECTIVE_DATE = "2026-01-01";

// Vehicle "value" for the estimate: there is no invoice amount on the vehicle model,
// so age from the recorded make/model year drives a depreciated band. This is a
// coarse estimate and is labelled as such wherever it surfaces.
function estimateVehicleValue(vehicle) {
    const age = Math.max(0, new Date().getFullYear() - (vehicle.year || new Date().getFullYear()));
    // A simple depreciation band keeps the estimate transparent and reproducible.
    const base = 800000; // illustrative ex-showroom band for a passenger car
    return Math.max(50000, Math.round(base * Math.pow(0.9, age)));
}

export function estimateMigrationCost(vehicle, destinationStateCode, category = "private") {
    const rule = STATE_MIGRATION_RULES[destinationStateCode];
    const unsupported = [];
    const computedAt = new Date();

    if (!rule) {
        return {
            label: "Estimate only - not an official tax demand",
            destinationRoadTax: null,
            registrationFee: null,
            reassignmentFee: null,
            otherCharges: null,
            estimatedTotal: null,
            refundNote:
                "Original-state tax refund is tracked separately and depends on the source state's rules; it is not computed here.",
            ruleSource: RULE_SOURCE,
            ruleEffectiveDate: RULE_EFFECTIVE_DATE,
            unsupported: [
                `No configured tax rule is available for ${STATE_RTO_CODES[destinationStateCode] || destinationStateCode}. This destination's cost cannot be estimated.`,
            ],
            computedAt,
        };
    }

    const value = estimateVehicleValue(vehicle);
    const age = Math.max(0, computedAt.getFullYear() - (vehicle.year || computedAt.getFullYear()));
    // Older vehicles attract a higher percentage for a used re-registration in the
    // configured demo model; this is a demonstration factor, not a legal one.
    const ageFactor = 1 + Math.min(0.5, age * 0.02);
    const categoryFactor = category === "commercial" ? 1.25 : 1;

    const destinationRoadTax = Math.round(value * rule.roadTaxPct * ageFactor * categoryFactor);
    const registrationFee = rule.registrationFee;
    const reassignmentFee = rule.reassignmentFee;
    const otherCharges = Math.round((registrationFee + reassignmentFee) * 0.15); // illustrative handling
    const estimatedTotal = destinationRoadTax + registrationFee + reassignmentFee + otherCharges;

    if (!vehicle.year) unsupported.push("Vehicle year of manufacture is not recorded, so the age factor is an assumption.");

    return {
        label: "Estimate only - not an official tax demand",
        destinationRoadTax,
        registrationFee,
        reassignmentFee,
        otherCharges,
        estimatedTotal,
        refundNote:
            "Original-state tax refund eligibility is handled separately under the source state's rules and is not included in this total.",
        ruleSource: RULE_SOURCE,
        ruleEffectiveDate: RULE_EFFECTIVE_DATE,
        unsupported,
        computedAt,
        _basis: { estimatedVehicleValue: value, ageYears: age, category },
    };
}

// ---------------------------------------------------------------------------
// Feature E: NOC expiry + migration deadline automation.
// ---------------------------------------------------------------------------
export function computeDeadline(nocIssueDate, destinationStateCode, existing = {}) {
    const rule = STATE_MIGRATION_RULES[destinationStateCode];
    const validityDays = rule ? rule.nocValidityDays : null;
    if (!nocIssueDate || !validityDays) {
        return {
            nocIssueDate: nocIssueDate || existing.nocIssueDate || null,
            validityDays,
            expiresAt: existing.expiresAt || null,
            daysRemaining: existing.daysRemaining ?? null,
            expired: existing.expired ?? false,
            reminders: existing.reminders || [],
            nextAction:
                validityDays === null
                    ? "NOC validity for this destination state is not configured; confirm against current official requirements."
                    : existing.nextAction || "",
        };
    }
    const issued = new Date(nocIssueDate);
    const expiresAt = new Date(issued.getTime() + validityDays * 24 * 60 * 60 * 1000);
    const daysRemaining = Math.ceil((expiresAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
    return {
        nocIssueDate: issued,
        validityDays,
        expiresAt,
        daysRemaining,
        expired: daysRemaining < 0,
        reminders: existing.reminders || [],
        nextAction:
            daysRemaining < 0
                ? "NOC has expired under the configured rule. Re-initiate the source NOC before continuing."
                : `Complete destination registration before ${expiresAt.toISOString().slice(0, 10)} (${daysRemaining} day(s) remaining).`,
    };
}

// Reminders are produced for the countdown UI; the crossing of each threshold is
// recorded once on the migration document by the routes that render it.
export const DEADLINE_REMINDER_THRESHOLDS = [30, 15, 7];

// ---------------------------------------------------------------------------
// Feature C: dependency-ordered two-state coordination stages.
// ---------------------------------------------------------------------------
export function buildStages(originState, destinationState) {
    const originName = STATE_RTO_CODES[originState] || originState;
    const destinationName = STATE_RTO_CODES[destinationState] || destinationState;
    return [
        {
            key: "initiated",
            title: "Migration request created",
            description: "Vehicle, origin and destination captured; unique migration id issued.",
            ownerRole: null,
            ownerState: null,
            status: "completed",
            dependsOn: [],
        },
        {
            key: "precheck",
            title: "Smart pre-check",
            description: "Challans, theft, insurance, PUC, tax, finance and identity inspected.",
            ownerRole: "owner",
            ownerState: originState,
            status: "pending",
            dependsOn: ["initiated"],
        },
        {
            key: "documents",
            title: "Document intelligence",
            description: "RC / insurance / PUC / address uploads read and compared; Form 28 & 27 drafts prepared.",
            ownerRole: "owner",
            ownerState: originState,
            status: "locked",
            dependsOn: ["precheck"],
        },
        {
            key: "source_noc",
            title: `${originName} RTO - NOC review`,
            description: "Source office reviews eligibility and issues the NOC.",
            ownerRole: "rto",
            ownerState: originState,
            status: "locked",
            dependsOn: ["documents"],
        },
        {
            key: "destination_review",
            title: `${destinationName} RTO - destination review`,
            description: "Activated only after the source NOC is recorded. Passport, tax estimate and inspection checks.",
            ownerRole: "rto",
            ownerState: destinationState,
            status: "locked",
            dependsOn: ["source_noc"],
        },
        {
            key: "reassignment",
            title: "New registration assignment",
            description: "Destination office assigns the new registration number and links records.",
            ownerRole: "rto",
            ownerState: destinationState,
            status: "locked",
            dependsOn: ["destination_review"],
        },
        {
            key: "reconciliation",
            title: "Migration reconciliation",
            description: "Source and destination records compared; any discrepancy becomes a reviewable exception.",
            ownerRole: "rto",
            ownerState: destinationState,
            status: "locked",
            dependsOn: ["reassignment"],
        },
        {
            key: "completed",
            title: "Migration completion",
            description: "Final records, passport reference and owner notifications.",
            ownerRole: null,
            ownerState: null,
            status: "locked",
            dependsOn: ["reconciliation"],
        },
    ];
}

// Recompute which stages are actionable given the ones already approved/completed.
export function resolveStageStatuses(stages) {
    const done = new Set(
        stages
            .filter((s) => s.status === "approved" || s.status === "completed" || s.status === "rejected")
            .map((s) => s.key)
    );
    return stages.map((s) => {
        if (s.status === "approved" || s.status === "completed" || s.status === "rejected" || s.status === "under_review" || s.status === "documents_required" || s.status === "submitted") {
            return s;
        }
        const depsReady = s.dependsOn.every((d) => done.has(d));
        // The first stage is created pending; its dependencies are already complete.
        if (depsReady) return { ...s, status: s.status === "locked" ? "pending" : s.status };
        return { ...s, status: "locked" };
    });
}

// ---------------------------------------------------------------------------
// Feature A: Smart Interstate Migration Pre-Check.
// Reads only records that exist. Anything unavailable is needs_review.
// ---------------------------------------------------------------------------
async function findVehicleBlockingTheft(vehicleId) {
    return TheftReport.findOne({ vehicle: vehicleId, status: { $in: ["reported", "under_investigation"] } });
}

export async function runPreCheck(vehicleId, destinationStateCode) {
    const vehicle = await Vehicle.findById(vehicleId).populate("currentOwner", "name");
    const checks = [];

    if (!vehicle) {
        return {
            verdict: "needs_review",
            summary: "The selected vehicle record could not be found.",
            recommendation: "Choose a vehicle that exists in the registry.",
            checks,
            runAt: new Date(),
        };
    }

    // 1. Theft / investigation status (blocks outright).
    const blockingTheft = await findVehicleBlockingTheft(vehicle._id);
    if (vehicle.status === "stolen" || blockingTheft) {
        checks.push({
            key: "theft",
            label: "Theft status",
            result: "blocked",
            detail: blockingTheft
                ? `An open theft report (${blockingTheft.status}) exists for this vehicle.`
                : "The vehicle is currently flagged as stolen.",
            sourceModel: "TheftReport",
            sourceId: blockingTheft ? String(blockingTheft._id) : null,
            sourceLabel: blockingTheft ? `FIR ${blockingTheft.firNumber}` : "Vehicle status: stolen",
        });
    } else if (vehicle.status === "blocked" || vehicle.status === "under_investigation") {
        checks.push({
            key: "theft",
            label: "Vehicle status",
            result: "blocked",
            detail: `The vehicle is ${vehicle.status.replace("_", " ")} and cannot be migrated until the hold is lifted.`,
            sourceModel: "Vehicle",
            sourceId: String(vehicle._id),
            sourceLabel: vehicle.regNumber,
        });
    } else {
        checks.push({ key: "theft", label: "Theft status", result: "passed", detail: "No open theft or investigation hold.", sourceModel: "Vehicle", sourceId: String(vehicle._id), sourceLabel: vehicle.regNumber });
    }

    // 2. Pending challans / dues.
    const pendingChallans = await Challan.find({
        vehicle: vehicle._id,
        status: "active",
        paymentStatus: { $in: ["pending", "partial"] },
    });
    if (pendingChallans.length) {
        const dues = pendingChallans.reduce((a, c) => a + Math.max(0, (c.fineAmount || 0) - (c.paidAmount || 0)), 0);
        checks.push({
            key: "challans",
            label: "Challans",
            result: "blocked",
            detail: `${pendingChallans.length} active challan(s) with approximately Rs ${dues} outstanding. Dues must be cleared before migration.`,
            sourceModel: "Challan",
            sourceId: String(pendingChallans[0]._id),
            sourceLabel: `${pendingChallans.length} pending challan(s)`,
        });
    } else {
        checks.push({ key: "challans", label: "Challans", result: "passed", detail: "No active challan dues recorded.", sourceModel: "Challan", sourceLabel: "0 pending" });
    }

    // 3. Insurance validity (from stored document expiry, if present).
    checks.push(expiryCheck(vehicle, "insurance", "Insurance"));
    // 4. PUC validity.
    checks.push(expiryCheck(vehicle, "puc", "PUC"));

    // 5. Hypothecation / finance status: no finance field is maintained on the
    //    vehicle, so this is honestly reported as needing manual verification.
    checks.push({
        key: "finance",
        label: "Finance status",
        result: "needs_review",
        detail: "No hypothecation/finance record is stored in BioChain for this vehicle. Obtain financier confirmation before submitting.",
        sourceLabel: "Not available in records",
    });

    // 6. Outstanding vehicle tax: no tax ledger exists, so needs_review.
    checks.push({
        key: "tax",
        label: "Outstanding tax",
        result: "needs_review",
        detail: "BioChain does not hold a source-state tax ledger for this vehicle; verify outstanding tax against the source RTO.",
        sourceLabel: "Not available in records",
    });

    // 7. Existing / duplicate transfer requests.
    const openRequests = await Request.find({
        vehicle: vehicle._id,
        type: "interStateTransfer",
        status: { $in: ["pending", "source_rto_approved", "destination_rto_approved"] },
    });
    if (openRequests.length) {
        checks.push({
            key: "duplicate",
            label: "Existing transfer requests",
            result: "warning",
            detail: `${openRequests.length} inter-state transfer request(s) already open for this vehicle. Avoid duplicate applications.`,
            sourceModel: "Request",
            sourceId: String(openRequests[0]._id),
            sourceLabel: openRequests[0].status,
        });
    } else {
        checks.push({ key: "duplicate", label: "Existing transfer requests", result: "passed", detail: "No other inter-state request is open.", sourceLabel: "none" });
    }

    // 8. Destination state supported?
    if (destinationStateCode && !STATE_MIGRATION_RULES[destinationStateCode]) {
        checks.push({
            key: "destination",
            label: "Destination rules",
            result: "needs_review",
            detail: `No configured migration rule for ${STATE_RTO_CODES[destinationStateCode] || destinationStateCode}; the tax estimate will be unavailable.`,
            sourceLabel: "Destination state",
        });
    }

    // 9. Identity fields present (chassis/engine required by the schema, but empty
    //    strings are still blocked upstream, so confirm they carry a value).
    const idConflict = !vehicle.chassisNumber || !vehicle.engineNumber || !vehicle.regNumber;
    checks.push({
        key: "identity",
        label: "Vehicle identity",
        result: idConflict ? "blocked" : "passed",
        detail: idConflict ? "Registration, chassis or engine number is missing, which blocks a trustworthy migration." : "Registration, chassis and engine numbers are all present.",
        sourceModel: "Vehicle",
        sourceId: String(vehicle._id),
        sourceLabel: vehicle.regNumber || "no reg",
    });

    const blocked = checks.some((c) => c.result === "blocked");
    const needsReview = checks.some((c) => c.result === "needs_review");
    const warnings = checks.some((c) => c.result === "warning");

    let verdict;
    if (blocked) verdict = "blocked";
    else if (needsReview || warnings) verdict = "conditional";
    else verdict = "ready";

    const blockers = checks.filter((c) => c.result === "blocked");
    const reviews = checks.filter((c) => c.result === "needs_review");
    let recommendation;
    if (blocked) {
        recommendation = `Resolve before applying: ${blockers.map((b) => b.label.toLowerCase()).join(", ")}.`;
    } else if (needsReview) {
        recommendation = `Ready to submit with care. Confirm manually: ${reviews.map((r) => r.label.toLowerCase()).join(", ")}.`;
    } else {
        recommendation = "All available checks passed. The vehicle is ready to start the migration.";
    }

    return { verdict, summary: buildSummary(checks), recommendation, checks, runAt: new Date(), vehicle };
}

function expiryCheck(vehicle, docType, label) {
    const docs = (vehicle.documents || []).filter((d) => d.type === docType);
    const stored = vehicle.ipfsDocuments?.[docType === "puc" ? "puc" : docType];
    if (!docs.length && !stored) {
        return {
            key: docType,
            label,
            result: "needs_review",
            detail: `No ${label.toLowerCase()} document with an expiry date is on file. Upload it to complete this check.`,
            sourceLabel: "Not on file",
        };
    }
    const withExpiry = docs.filter((d) => d.expiryDate);
    if (!withExpiry.length) {
        return {
            key: docType,
            label,
            result: "needs_review",
            detail: `A ${label.toLowerCase()} reference exists but carries no expiry date, so validity cannot be confirmed automatically.`,
            sourceLabel: "No expiry recorded",
        };
    }
    const soonest = withExpiry.map((d) => new Date(d.expiryDate)).sort((a, b) => a - b)[0];
    if (soonest < new Date()) {
        return { key: docType, label, result: "blocked", detail: `${label} on file expired on ${soonest.toISOString().slice(0, 10)}.`, sourceLabel: soonest.toISOString().slice(0, 10) };
    }
    const within30 = (soonest.getTime() - Date.now()) / (24 * 60 * 60 * 1000) < 30;
    return {
        key: docType,
        label,
        result: within30 ? "warning" : "passed",
        detail: within30
            ? `${label} is valid but expires soon (${soonest.toISOString().slice(0, 10)}).`
            : `${label} valid until ${soonest.toISOString().slice(0, 10)}.`,
        sourceLabel: soonest.toISOString().slice(0, 10),
    };
}

function buildSummary(checks) {
    const count = (r) => checks.filter((c) => c.result === r).length;
    return `${count("passed")} passed, ${count("warning")} warning(s), ${count("needs_review")} need review, ${count("blocked")} blocking.`;
}

// ---------------------------------------------------------------------------
// Feature B: AI document intelligence + auto-form generation.
//
// Three layers:
//   1. Category-aware extraction. Each document type (RC, insurance, PUC,
//      address proof, bill of sale) has its own field-mining profile. Every
//      mined value becomes a field card with a confidence score (regex
//      strictness x OCR confidence): label-anchored matches on readable OCR
//      are "confirmed", looser matches are "review", required-but-absent
//      fields are "missing". Nothing is silently trusted - only a human
//      verification lets a card feed the form drafts.
//   2. Cross-document audit. Identity references (chassis/VIN, reg number,
//      owner, price) are compared document-vs-BioChain-record AND
//      document-vs-document ("VIN on insurance does not match VIN on bill of
//      sale"), expiry dates are checked against today, and completeness
//      produces the live task checklist. Errors reject, warnings nudge.
//   3. Auto-form generation. Form 28/27 drafts merge VERIFIED extractions with
//      the record; every value carries its provenance (which document it came
//      from). Drafts are never signed or filed here.
// ---------------------------------------------------------------------------

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd -> Date (or null).
function parseFlexibleDate(raw) {
    if (!raw) return null;
    const m = String(raw).match(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})|(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
    if (!m) return null;
    let d, mo, y;
    if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; }
    else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    if (!d || !mo || mo > 12 || d > 31) return null;
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : dt;
}

function parseAmount(raw) {
    if (!raw) return null;
    const n = Number(String(raw).replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : null;
}

// Field-mining profiles. `anchored` means the regex requires a nearby label and
// therefore earns higher confidence; `identity` marks values the cross-document
// audit compares; `required` drives the missing-field checklist.
const DOC_PROFILES = {
    rc: {
        label: "Registration Certificate (RC)",
        fields: [
            { key: "regNumber", label: "Registration Number", re: /\b([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,2}[\s-]?\d{3,4})\b/i, identity: "regNumber" },
            { key: "chassisNumber", label: "Chassis Number", re: /chassis[\s#:\-]*([A-Z0-9\-]{8,20})/i, anchored: true, identity: "chassisNumber", required: true },
            { key: "engineNumber", label: "Engine Number", re: /engine[\s#:\-]*([A-Z0-9\-]{5,20})/i, anchored: true, identity: "engineNumber" },
            { key: "ownerName", label: "Owner Name", re: /(?:owner[\s\-]*name|name[\s\-]*of[\s\-]*owner)[\s:]*([A-Za-z][A-Za-z .&']{3,40})/i, anchored: true, identity: "ownerName" },
            { key: "registrationDate", label: "Date of Registration", re: /(?:registered on|date of registration|first registration)[\s:]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, anchored: true },
        ],
    },
    insurance: {
        label: "Insurance",
        fields: [
            { key: "policyNumber", label: "Policy Number", re: /policy[\s\-]*(?:no|number)[\s#:]*([A-Z0-9\/\-]{6,22})/i, anchored: true, required: true },
            { key: "insurerName", label: "Insurer", re: /\b(icici\s*lombard|holic|new\s*india|bajaj\s*(?:allianz)?|tata\s*(?:aig|general)?|religo|royal\s*and\s*sun|acko|universal|shriram|care[\s]*health)\b/i },
            { key: "chassisNumber", label: "VIN / Chassis on Policy", re: /(?:vehicle|chassis)[\s#:\-]*(?:no|number)?[\s:]*(MA[A-Z0-9]{6,18}|[A-HK-NPR-Z0-9]{17})/i, anchored: true, identity: "chassisNumber", required: true },
            { key: "declaredValue", label: "Declared Value / IDV", re: /(?:sum\s*insured|declared\s*value|IDV)[^0-9]{0,12}([0-9][0-9,]{4,12})/i, anchored: true, identity: "declaredValue", parser: parseAmount },
            { key: "expiryDate", label: "Policy Expiry", re: /(?:expir\w*|valid[\s\-]*till|valid[\s\-]*until|on[\s\-]*or[\s\-]*before)[\s:\-]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, anchored: true, isExpiry: true, required: true },
        ],
    },
    puc: {
        label: "PUC",
        fields: [
            { key: "certificateNumber", label: "PUC Certificate No", re: /(?:puc|certificate)[\s#:\-]*(?:no|number)?[\s:]*([A-Z0-9\/\-]{6,20})/i, anchored: true, required: true },
            { key: "regNumber", label: "Registration Number", re: /\b([A-Z]{2}[\s-]?\d{1,2}[\s-]?[A-Z]{0,2}[\s-]?\d{3,4})\b/i, identity: "regNumber" },
            { key: "fuelType", label: "Fuel Type", re: /\b(petrol|diesel|cng|lpg|electric|hybrid)\b/i },
            { key: "expiryDate", label: "PUC Expiry", re: /(?:expir\w*|valid[\s\-]*upto|valid[\s\-]*till)[\s:\-]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, anchored: true, isExpiry: true, required: true },
        ],
    },
    address: {
        label: "Address Proof",
        fields: [
            { key: "ownerName", label: "Name", re: /(?:name|resident\s*of|[a-z]+\s*name)[\s:]*([A-Za-z][A-Za-z .&']{3,40})/i, anchored: true, identity: "ownerName", required: true },
            { key: "addressLine", label: "Address", re: /(?:address|resident\s*of)[\s:]*([A-Za-z0-9, .#\/'\-]{10,90})/i, anchored: true },
            { key: "state", label: "State", re: /\b(karnataka|tamil\s*nadu|telangana|maharashtra|delhi|gujarat|kerala|uttar\s*pradesh|andhra\s*pradesh|rajasthan)\b/i },
            { key: "pincode", label: "PIN Code", re: /\b([1-9][0-9]{5})\b/ },
        ],
    },
    bill_of_sale: {
        label: "Bill of Sale / Dealer Invoice",
        fields: [
            { key: "sellerName", label: "Seller", re: /seller[\s:\-]*([A-Za-z][A-Za-z .&']{3,40})/i, anchored: true },
            { key: "ownerName", label: "Buyer", re: /(?:buyer|purchaser)[\s:\-]*([A-Za-z][A-Za-z .&']{3,40})/i, anchored: true, identity: "ownerName" },
            { key: "chassisNumber", label: "VIN / Chassis", re: /(?:vehicle|chassis)[\s#:\-]*(?:no|number)?[\s:]*(MA[A-Z0-9]{6,18}|[A-HK-NPR-Z0-9]{17})/i, anchored: true, identity: "chassisNumber", required: true },
            { key: "salePrice", label: "Sales Price", re: /(?:sale[\s\-]*price|consideration|total[\s\-]*amount)[^0-9]{0,12}([0-9][0-9,]{4,12})/i, anchored: true, identity: "salePrice", parser: parseAmount, required: true },
            { key: "saleDate", label: "Sale Date", re: /(?:date|sold\s*on)[\s:]*(?:[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, anchored: true },
        ],
    },
    financier: {
        label: "Financier NOC",
        fields: [
            { key: "financierName", label: "Financier", re: /(?:financier|bank|nbfc)[\s:\-]*([A-Za-z][A-Za-z .&']{3,40})/i, anchored: true },
            { key: "accountRef", label: "Loan / Account Ref", re: /(?:loan|account)[\s#:\-]*(?:no|number)?[\s:]*([A-Z0-9\/\-]{5,20})/i, anchored: true },
            { key: "noObjectionDate", label: "No-Dues Date", re: /(?:no[\s\-]*dues|noc[\s\-]*date|on)[\s:]*(?:[0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i, anchored: true },
        ],
    },
    other: { label: "Document", fields: [] },
};

// Turn raw OCR text into field cards + normalized identity references.
export function extractDocumentFields(category, ocrText, ocrConfidence) {
    const profile = DOC_PROFILES[category] || DOC_PROFILES.other;
    const text = ocrText || "";
    const conf = typeof ocrConfidence === "number" ? Math.min(100, Math.max(0, ocrConfidence)) : 50;
    const fieldCards = [];
    const identityRefs = {};
    let expiryDate = null;

    for (const f of profile.fields) {
        const m = text.match(f.re);
        const raw = m ? (m[1] || m[0]) : null;
        const value = f.parser ? (f.parser(raw) ?? null) : raw ? String(raw).trim() : null;
        if (value && f.identity) identityRefs[f.identity] = value;
        if (value && f.isExpiry) expiryDate = parseFlexibleDate(value);
        // Confidence: label-anchored match earns 90, bare pattern 55; scaled by
        // how readable the OCR pass was overall.
        const base = raw ? (f.anchored ? 0.9 : 0.55) : 0;
        const cardConf = Math.round(base * (0.55 + (conf / 100) * 0.45) * 100);
        fieldCards.push({
            key: f.key,
            label: f.label,
            value: value != null ? String(value) : null,
            confidence: cardConf,
            status: value != null ? (cardConf >= 68 ? "confirmed" : "review") : f.required ? "missing" : "review",
        });
    }
    return { fieldCards, identityRefs, expiryDate, profileLabel: profile.label };
}

export async function analyseDocumentIntelligence({ buffer, vehicle, uploaderUser, docCategory, docName }) {
    const integrityHash = "0x" + crypto.createHash("sha256").update(buffer).digest("hex");
    let ocr;
    try {
        ocr = await ocrImageBuffer(buffer);
    } catch (err) {
        return {
            name: docName,
            category: docCategory || "other",
            integrityHash,
            reviewStatus: "unreadable",
            discrepancies: [`The image could not be processed for text: ${err.message}`],
            extracted: null,
            fieldCards: [],
        };
    }

    const category = docCategory && docCategory !== "other" ? docCategory : guessCategoryFromText(ocr.text || "");
    const { fieldCards, identityRefs, expiryDate, profileLabel } = extractDocumentFields(category, ocr.text || "", ocr.confidence);
    const { fields, documentType } = parseIdentityText(ocr.text || "");
    const readable = (ocr.text || "").trim().length > 12 && ocr.confidence > 0;
    const discrepancies = [];
    const observations = [`Read as a ${profileLabel.toLowerCase()}.`];

    if (!readable) {
        discrepancies.push("The upload was read but too little text was recognised to be reliable. A clearer image is needed.");
    }

    // Compare identity references against the BioChain record. A value that is
    // simply absent is an observation ("could not be located"), never a pass.
    const recChassis = norm(vehicle.chassisNumber);
    if (identityRefs.chassisNumber && recChassis) {
        if (norm(identityRefs.chassisNumber).includes(recChassis) || recChassis.includes(norm(identityRefs.chassisNumber))) {
            observations.push(`Chassis/VIN on the document matches the BioChain record (${vehicle.chassisNumber}).`);
        } else {
            discrepancies.push(`Chassis/VIN on the document (${identityRefs.chassisNumber}) does not match the BioChain record (${vehicle.chassisNumber}).`);
        }
    }
    const recReg = norm(vehicle.regNumber);
    if (identityRefs.regNumber && recReg) {
        if (norm(identityRefs.regNumber) === recReg) observations.push(`Registration number on the document matches the record (${vehicle.regNumber}).`);
        else discrepancies.push(`Registration on the document (${identityRefs.regNumber}) does not match the record (${vehicle.regNumber}).`);
    }
    if (identityRefs.engineNumber && vehicle.engineNumber && norm(identityRefs.engineNumber) !== norm(vehicle.engineNumber)) {
        discrepancies.push(`Engine number on the document (${identityRefs.engineNumber}) does not match the record (${vehicle.engineNumber}).`);
    }
    if (identityRefs.ownerName && uploaderUser?.name) {
        const a = identityRefs.ownerName.toLowerCase().trim(), b = uploaderUser.name.toLowerCase().trim();
        if (a && (b.includes(a) || a.includes(b))) observations.push(`Name on the document matches the uploader (${uploaderUser.name}).`);
        else observations.push(`Name on the document ("${identityRefs.ownerName}") differs from the uploader ("${uploaderUser.name}") - officer to confirm.`);
    }
    // Fields a required document did not yield are surfaced as discrepancies so
    // verification cannot proceed on an incomplete read.
    for (const c of fieldCards) {
        if (c.status === "missing") discrepancies.push(`${c.label} could not be located on this ${profileLabel}. A clearer image or manual entry is needed.`);
    }

    return {
        name: docName,
        category,
        integrityHash,
        ocrText: (ocr.text || "").slice(0, 4000),
        ocrConfidence: ocr.confidence,
        extracted: { ...fields, documentType },
        fieldCards,
        identityRefs,
        expiryDate,
        discrepancies,
        observations,
        reviewStatus: readable ? "read" : "unreadable",
    };
}

// If the uploader did not pick a category, infer it from distinctive text.
function guessCategoryFromText(text) {
    const t = (text || "").toLowerCase();
    if (/insurance|policy number|idv|sum insured/.test(t)) return "insurance";
    if (/puc|pollution under control|emission norm/.test(t)) return "puc";
    if (/registration certificate|\brc\b|chassis number/.test(t)) return "rc";
    if (/bill of sale|sale price|consideration|invoice/.test(t)) return "bill_of_sale";
    if (/no dues|no objection|financier|loan account/.test(t)) return "financier";
    if (/address|resident of|pin code|pincode/.test(t)) return "address";
    return "other";
}

// ---------------------------------------------------------------------------
// Feature B layer 2: the cross-document audit. Compares every document's
// identity references against the BioChain record AND against each other,
// checks expiry dates, and derives the live task checklist. Findings are
// advisory: the audit never edits a document, it only reports.
// ---------------------------------------------------------------------------
export const REQUIRED_DOC_CATEGORIES = [
    { category: "rc", label: "Registration Certificate" },
    { category: "insurance", label: "Insurance" },
    { category: "puc", label: "PUC" },
    { category: "address", label: "Address Proof" },
];

export function auditMigrationDocuments({ documents = [], vehicle, ownerName }) {
    const lines = [];
    const missing = [];
    const pass = (text, docs = []) => lines.push({ severity: "pass", text, docs });
    const warn = (text, docs = []) => lines.push({ severity: "warning", text, docs });
    const fail = (text, docs = []) => lines.push({ severity: "error", text, docs });

    if (!documents.length) {
        return { status: "not_started", lines, missing: REQUIRED_DOC_CATEGORIES.map((r) => r.label), checklist: buildDocChecklist(documents, "not_started"), auditedAt: new Date() };
    }

    const byCat = {};
    for (const d of documents) (byCat[d.category] ||= []).push(d);

    // 1. Completeness of the required set. This is ADVISORY, never a hard
    //    rejection: the checklist still flags every missing document, but a
    //    missing category downgrades the audit to "warning" rather than
    //    "rejected" so an owner who has filed and verified an address proof is
    //    not blocked from submitting a migration the RTO can still complete on
    //    review. Genuine conflicts (unreadable uploads, identity mismatches)
    //    below remain hard errors that DO reject the package.
    for (const req of REQUIRED_DOC_CATEGORIES) {
        const docs = byCat[req.category] || [];
        if (!docs.length) { missing.push(req.label); warn(`${req.label} document is not on file - collect it before the RTO finalizes.`); }
        else if (!docs.some((d) => d.reviewStatus === "verified")) warn(`${req.label} is uploaded but not yet verified.`, docs.map((d) => d.name));
        else pass(`${req.label} uploaded and verified.`, docs.map((d) => d.name));
    }

    // 2. Unreadable uploads.
    for (const d of documents) if (d.reviewStatus === "unreadable") fail(`"${d.name}" could not be read - a clearer image is required.`, [d.name]);

    // 3. Identity agreement: document vs BioChain record.
    const recChassis = norm(vehicle?.chassisNumber);
    for (const d of documents) {
        const ch = d.identityRefs?.chassisNumber;
        if (ch && recChassis && !(norm(ch).includes(recChassis) || recChassis.includes(norm(ch)))) {
            fail(`Chassis/VIN on ${d.name} does not match the BioChain record.`, [d.name]);
        }
    }
    // 4. Identity agreement: document vs document (the headline audit line).
    const chassisDocs = documents.filter((d) => d.identityRefs?.chassisNumber && d.reviewStatus !== "unreadable");
    let vinMismatch = false;
    for (let i = 0; i < chassisDocs.length; i++) {
        for (let j = i + 1; j < chassisDocs.length; j++) {
            const a = norm(chassisDocs[i].identityRefs.chassisNumber), b = norm(chassisDocs[j].identityRefs.chassisNumber);
            if (a && b && a !== b && !a.includes(b) && !b.includes(a)) {
                vinMismatch = true;
                fail(`VIN number on ${chassisDocs[i].name} does not match VIN on ${chassisDocs[j].name}.`, [chassisDocs[i].name, chassisDocs[j].name]);
            }
        }
    }
    if (chassisDocs.length >= 2 && !vinMismatch) pass(`Vehicle identity (chassis/VIN) is consistent across ${chassisDocs.length} documents.`, chassisDocs.map((d) => d.name));

    // 5. Owner-name agreement across identity-bearing documents.
    const nameDocs = documents.filter((d) => d.identityRefs?.ownerName);
    for (const d of nameDocs) {
        if (ownerName) {
            const a = d.identityRefs.ownerName.toLowerCase(), b = ownerName.toLowerCase();
            if (!(b.includes(a) || a.includes(b))) warn(`Name on ${d.name} ("${d.identityRefs.ownerName}") differs from the registered owner ("${ownerName}").`, [d.name]);
        }
    }
    if (nameDocs.length >= 2) {
        const first = norm(nameDocs[0].identityRefs.ownerName);
        const differ = nameDocs.slice(1).find((d) => norm(d.identityRefs.ownerName) !== first);
        if (differ) fail(`Owner name on ${nameDocs[0].name} does not match name on ${differ.name}.`, [nameDocs[0].name, differ.name]);
        else pass(`Owner name is consistent across ${nameDocs.length} documents.`, nameDocs.map((d) => d.name));
    }

    // 6. Price consistency: bill of sale vs insurance declared value (>10% apart = flag).
    const priceDoc = documents.find((d) => d.identityRefs?.salePrice);
    const valueDoc = documents.find((d) => d.identityRefs?.declaredValue);
    if (priceDoc && valueDoc) {
        const p = priceDoc.identityRefs.salePrice, v = valueDoc.identityRefs.declaredValue;
        if (Math.abs(p - v) / Math.max(p, v) > 0.1) {
            warn(`Vehicle sales price on ${priceDoc.name} does not match declared value on ${valueDoc.name}.`, [priceDoc.name, valueDoc.name]);
        } else pass(`Sales price and declared insurance value agree.`, [priceDoc.name, valueDoc.name]);
    }

    // 7. Expiry checks on certificates that carry a date.
    for (const d of documents) {
        if (!d.expiryDate) continue;
        const exp = new Date(d.expiryDate);
        const label = DOC_PROFILES[d.category]?.label || d.name;
        if (exp < new Date()) fail(`${label} on ${d.name} expired on ${exp.toISOString().slice(0, 10)}.`, [d.name]);
        else if ((exp.getTime() - Date.now()) / 86400000 < 30) warn(`${d.name} is active but expires soon (${exp.toISOString().slice(0, 10)}).`, [d.name]);
        else pass(`${label} card is active with a future expiration date.`, [d.name]);
    }

    const hasError = lines.some((l) => l.severity === "error");
    const hasWarning = lines.some((l) => l.severity === "warning");
    const status = hasError ? "rejected" : hasWarning ? "warning" : "passed";
    return { status, lines, missing, checklist: buildDocChecklist(documents, status), auditedAt: new Date() };
}

// The task-checklist card: gather-documents sub-tasks + form generation, each
// Pending / Completed / Form Autofilled, driven by real document state.
function buildDocChecklist(documents, auditStatus) {
    const byCat = {};
    for (const d of documents) (byCat[d.category] ||= []).push(d);
    const checklist = REQUIRED_DOC_CATEGORIES.map((req) => {
        const docs = byCat[req.category] || [];
        const verified = docs.some((d) => d.reviewStatus === "verified");
        return {
            item: req.label, category: req.category,
            status: verified ? "completed" : docs.length ? "attention" : "pending",
            detail: verified ? "Verified" : docs.length ? "Uploaded - needs review" : "Pending",
        };
    });
    const optionalDocs = documents.filter((d) => !REQUIRED_DOC_CATEGORIES.some((r) => r.category === d.category));
    if (optionalDocs.length) {
        checklist.push({ item: "Additional documents", category: "other", status: "completed", detail: optionalDocs.map((d) => d.name).join(", ") });
    }
    checklist.push({
        item: "Document audit", category: "audit",
        status: auditStatus === "passed" ? "completed" : auditStatus === "not_started" ? "pending" : "attention",
        detail: auditStatus === "not_started" ? "Awaiting uploads" : `Result: ${auditStatus}`,
    });
    const anyVerified = documents.some((d) => d.reviewStatus === "verified");
    checklist.push({ item: "Form Generation: Form 28 (NOC application)", category: "form28", status: anyVerified ? "completed" : "pending", detail: anyVerified ? "Form Autofilled" : "Awaiting verified documents" });
    checklist.push({ item: "Form Generation: Form 27 (reassignment)", category: "form27", status: anyVerified ? "completed" : "pending", detail: anyVerified ? "Form Autofilled" : "Prepared at destination stage" });
    return checklist;
}

// Form 28 (NOC) and Form 27 (reassignment of registration mark) DRAFTS. Values
// are merged from VERIFIED document extractions first, falling back to the
// BioChain record; every field carries its provenance. These are drafts for a
// human to complete and sign - never a submitted or officially-issued document.
export function buildFormDrafts(migration) {
    const v = migration.origin || {};
    const d = migration.destination || {};
    const vehicle = migration.vehicle && migration.vehicle.regNumber ? migration.vehicle : {};
    const verified = (migration.documents || []).filter((x) => x.reviewStatus === "verified");

    const pick = (key, fallback, fallbackSource = "BioChain record") => {
        for (const doc of verified) {
            const fc = (doc.fieldCards || []).find((c) => c.key === key);
            const val = fc?.correctedValue || fc?.value;
            if (val) return { value: val, source: doc.name, needsReview: !fc.correctedValue && fc.status !== "confirmed" };
        }
        return { value: fallback || null, source: fallback ? fallbackSource : "Not available - complete manually", needsReview: !fallback };
    };

    const merged = {
        registrationNumber: pick("regNumber", v.regNumber),
        chassisNumber: pick("chassisNumber", vehicle.chassisNumber),
        engineNumber: pick("engineNumber", vehicle.engineNumber),
        ownerName: pick("ownerName", migration.ownerName),
        destinationAddress: { value: d.newAddress || null, source: "Migration application", needsReview: !d.newAddress },
        destinationState: { value: d.stateName || null, source: "Migration application", needsReview: !d.stateName },
        reason: { value: migration.relocationReason || null, source: "Migration application", needsReview: !migration.relocationReason },
    };
    const common = {
        note: "DRAFT - prepared by BioChain for review. Not signed, not an official filing.",
        migrationId: migration.migrationId,
    };
    return {
        form28: {
            form: "Form 28 - Application for No Objection Certificate",
            ...common,
            purpose: "NOC to move the vehicle out of the origin state",
            originState: v.stateName,
            fields: {
                registrationNumber: merged.registrationNumber,
                chassisNumber: merged.chassisNumber,
                engineNumber: merged.engineNumber,
                ownerName: merged.ownerName,
                reason: merged.reason,
            },
        },
        form27: {
            form: "Form 27 - Intimation of assignment of a new registration mark",
            ...common,
            purpose: "Re-registration in the destination state after the NOC",
            proposedNewNumber: d.newRegNumber || null,
            fields: {
                ownerName: merged.ownerName,
                destinationAddress: merged.destinationAddress,
                destinationState: merged.destinationState,
                chassisNumber: merged.chassisNumber,
            },
        },
        checklist: buildChecklist(migration),
    };
}

function buildChecklist(migration) {
    const items = [
        "Registration Certificate (RC)",
        "Valid insurance certificate",
        "Valid PUC certificate",
        "Destination address proof",
    ];
    if (migration.vehicleCategory === "commercial") items.push("Fitness / permit documents (commercial category)");
    items.push("Form 28 draft (NOC application) - to be signed by the owner");
    items.push("Form 27 draft (reassignment) - prepared at destination stage");
    items.push("Tax/financier documents where applicable - confirm with the source RTO");
    return items;
}

// ---------------------------------------------------------------------------
// Feature F: consolidated migration passport. Reuses the existing generator and
// layers the migration identity + document references onto the result.
// ---------------------------------------------------------------------------
export async function generateMigrationPassport(vehicleId, migration) {
    const base = await generateVehiclePassport(vehicleId);
    if (base.error) return base;
    const passport = {
        ...base.passport,
        migration: {
            migrationId: migration?.migrationId || null,
            origin: migration?.origin || null,
            destination: migration?.destination || null,
            nocIssueDate: migration?.deadline?.nocIssueDate || null,
            documentReferences: (migration?.documents || []).map((doc) => ({
                name: doc.name,
                category: doc.category,
                integrityHash: doc.integrityHash,
                reviewStatus: doc.reviewStatus,
            })),
        },
    };
    // Re-hash so the integrity reference covers the migration additions too.
    const hash = "0x" + crypto.createHash("sha256").update(JSON.stringify(passport)).digest("hex");
    return { passport, passportHash: hash, message: "Migration passport generated" };
}

// ---------------------------------------------------------------------------
// Feature G: automated reconciliation. Compares the pre-migration snapshot
// (origin) with the post-migration vehicle record. Produces exceptions; never
// edits the vehicle to hide a difference.
// ---------------------------------------------------------------------------
export function reconcile({ originRegNumber, originChassis, originEngine, originOwner, destinationRegNumber, destinationChassis, destinationEngine, destinationOwner, nocIssued, destinationApproved }) {
    const exceptions = [];
    const compare = (field, a, b, severity, msg) => {
        if ((a || "") !== (b || "")) {
            exceptions.push({ field, sourceValue: a || "(missing)", destinationValue: b || "(missing)", severity, message: msg });
        }
    };

    compare("Chassis", originChassis, destinationChassis, "critical", "Chassis identity differs between source and destination records.");
    compare("Engine", originEngine, destinationEngine, "critical", "Engine identity differs between source and destination records.");
    compare("Owner", originOwner, destinationOwner, "critical", "Ownership is not consistent across the migration.");

    if (!originRegNumber || !destinationRegNumber) {
        exceptions.push({ field: "Registration", sourceValue: originRegNumber || "(missing)", destinationValue: destinationRegNumber || "(missing)", severity: "warning", message: "Old or new registration number is missing from the record." });
    } else if (extractStateFromRegNumber(destinationRegNumber) === extractStateFromRegNumber(originRegNumber)) {
        exceptions.push({ field: "Registration", sourceValue: originRegNumber, destinationValue: destinationRegNumber, severity: "warning", message: "New registration is in the same state as the old one." });
    }

    if (!nocIssued) {
        exceptions.push({ field: "NOC reference", sourceValue: "not issued", destinationValue: "-", severity: "critical", message: "The destination completed without a recorded source NOC." });
    }
    if (!destinationApproved) {
        exceptions.push({ field: "Approval", sourceValue: "pending", destinationValue: "-", severity: "warning", message: "A required destination approval is still outstanding." });
    }

    const verdict = exceptions.length ? "exception" : "consistent";
    return { verdict, exceptions, comparedAt: new Date() };
}

// ---------------------------------------------------------------------------
// Notification helper: tell the owner and/or the owning state's RTO role that a
// stage became actionable. Socket/REST push is handled inside notificationService.
// ---------------------------------------------------------------------------
export async function notifyMigrationStage({ migration, title, message, ownerNotified = true, rtoState = null, priority = "medium", actionRequired = true }) {
    try {
        if (ownerNotified && migration.owner) {
            await createNotification({
                type: "migration_stage",
                title,
                message,
                recipient: migration.owner,
                recipientRole: "owner",
                relatedVehicle: migration.vehicle,
                relatedRequest: migration.request || null,
                requestModel: migration.request ? "Request" : null,
                priority,
                actionRequired,
                actionUrl: "/migration",
                metadata: { migrationId: migration.migrationId },
            });
        }
        if (rtoState) {
            // Notify the RTO officers configured for the state that owns the task.
            const officers = await User.find({ role: "rto", "rtoDetails.stateCode": rtoState }).select("_id");
            await Promise.all(
                officers.map((o) =>
                    createNotification({
                        type: "migration_stage",
                        title,
                        message,
                        recipient: o._id,
                        recipientRole: "rto",
                        relatedVehicle: migration.vehicle,
                        relatedRequest: migration.request || null,
                        requestModel: migration.request ? "Request" : null,
                        priority,
                        actionRequired,
                        actionUrl: "/migration",
                        metadata: { migrationId: migration.migrationId, state: rtoState },
                    })
                )
            );
        }
    } catch (err) {
        console.error("Migration notification failed:", err.message);
    }
}

export async function nextMigrationId() {
    const year = new Date().getFullYear();
    // Sequence from the count of existing migrations this year; unique index on
    // migrationId is the real guard against any race.
    const count = await SmartMigration.countDocuments({ migrationId: { $regex: `^BCM-${year}-` } });
    return `BCM-${year}-${String(count + 1).padStart(5, "0")}`;
}

export default {
    runPreCheck,
    estimateMigrationCost,
    computeDeadline,
    buildStages,
    resolveStageStatuses,
    analyseDocumentIntelligence,
    buildFormDrafts,
    generateMigrationPassport,
    reconcile,
    notifyMigrationStage,
    nextMigrationId,
    STATE_MIGRATION_RULES,
};
