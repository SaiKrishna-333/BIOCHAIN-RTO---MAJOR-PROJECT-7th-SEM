// DamageAssessment.js + RepairCostCatalogue
// Feature 9: 3D Vehicle Damage & Repair Intelligence.
//
// This is the operational record behind the standalone 3D damage module. It is
// deliberately LINKED to an existing DamageEvent (the one accident record) rather
// than being a second accident report: the assessment extends the incident with
// photographs, component-level findings, a repair-vs-replace plan, an itemized
// estimate and reviewed completion evidence.
//
// Honesty rules encoded in the schema:
// - every finding carries a `source` proving whether it came from a configured
//   computer-vision endpoint or from a human assessor. Nothing is labelled
//   "detected" unless a real analysis produced it.
// - `modelOutput` preserves the original analysis text so an inspector's
//   correction is auditable instead of silently overwriting the first result.
// - estimate prices come only from the RepairCostCatalogue; a component with no
//   catalogue entry is flagged, never given an invented price.
// - a completed repair is not "verified" until completion evidence + a final
//   inspection step exist. Approval of an estimate is a different state.

import mongoose from "mongoose";

// The component keys the 3D viewer and the cost catalogue both understand. The
// frontend maps each key to a real mesh; a finding whose component is not in this
// list is still recorded but shown as "not mapped to the 3D model".
export const DAMAGE_COMPONENTS = [
    "front-bumper", "rear-bumper", "bonnet", "roof",
    "door-front-left", "door-front-right", "door-rear-left", "door-rear-right",
    "fender-front-left", "fender-front-right", "fender-rear-left", "fender-rear-right",
    "headlight-left", "headlight-right", "taillight-left", "taillight-right",
    "windshield", "rear-window", "mirror-left", "mirror-right",
    "wheel-front-left", "wheel-front-right", "wheel-rear-left", "wheel-rear-right",
    "radiator", "other",
];

const photoSchema = new mongoose.Schema(
    {
        fileName: { type: String },
        contentType: { type: String },
        fileSize: { type: Number },
        // Small photographs keep their bytes inline; anything large is filed on
        // the media disk and referenced by storedAs (same approach as accident
        // evidence). Raw pixels never enter the record hash.
        data: Buffer,
        sha256: { type: String },
        storage: { type: String, enum: ["inline", "disk"], default: "inline" },
        storedAs: { type: String },
        // The angle the assessor captured, so the report can pair a finding with
        // the view it was read from.
        view: {
            type: String,
            enum: ["front", "rear", "left", "right", "close-up", "interior", "other"],
            default: "other",
        },
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false },
);

const findingSchema = new mongoose.Schema(
    {
        component: { type: String, enum: DAMAGE_COMPONENTS, required: true },
        label: { type: String, required: true }, // e.g. "Front bumper - crack"
        // What the analysis step concluded, kept separate from the assessor's
        // final severity so a correction never erases the original result.
        detectionState: {
            type: String,
            enum: ["detected", "needs-review", "not-assessed"],
            default: "needs-review",
        },
        // Honest provenance of the finding.
        source: {
            type: String,
            enum: ["computer-vision", "manual-inspection", "owner-reported"],
            required: true,
        },
        sourceDetail: { type: String }, // e.g. "assessor viewed photo #2" or model name
        confidence: { type: Number, min: 0, max: 1 }, // present only when a real model produced it
        modelOutput: { type: String }, // original analysis text, retained for audit
        severity: {
            type: String,
            enum: ["no-visible-damage", "minor", "moderate", "severe", "requires-inspection", "inconclusive"],
            default: "inconclusive",
        },
        recommendation: {
            type: String,
            enum: ["repair", "replace", "inspect-physically", "specialist-assessment", "no-action"],
            default: "inspect-physically",
        },
        linkedPhotoIndex: { type: Number }, // index into assessment.photos
        inspectorNotes: { type: String },
        // Whether this component maps onto a real 3D mesh. Set by the backend from
        // the shared component list; the UI must not highlight an unmapped finding.
        mappedTo3D: { type: Boolean, default: false },
        assessedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        assessedByName: { type: String },
        assessedAt: { type: Date, default: Date.now },
        // Corrections are append-only so the first result stays visible.
        corrections: [{
            field: { type: String },
            previousValue: { type: mongoose.Schema.Types.Mixed },
            newValue: { type: mongoose.Schema.Types.Mixed },
            reason: { type: String },
            correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            correctedByName: { type: String },
            correctedAt: { type: Date, default: Date.now },
        }],
    },
    { _id: true },
);

const estimateItemSchema = new mongoose.Schema(
    {
        component: { type: String, enum: DAMAGE_COMPONENTS, required: true },
        findingLabel: { type: String },
        proposedAction: {
            type: String,
            enum: ["repair", "replace", "inspect-physically", "specialist-assessment"],
            required: true,
        },
        partsCost: { type: Number, min: 0, default: 0 },
        labourCost: { type: Number, min: 0, default: 0 },
        additionalCost: { type: Number, min: 0, default: 0 },
        total: { type: Number, min: 0, default: 0 },
        // Traceability: where each number came from, or why it is absent.
        catalogueRef: { type: String }, // RepairCostCatalogue key
        priceBasis: { type: String, enum: ["configured-catalogue", "workshop-quotation", "none"], default: "none" },
        note: { type: String },
    },
    { _id: false },
);

const estimateSchema = new mongoose.Schema(
    {
        version: { type: Number, default: 1 },
        currency: { type: String, default: "INR" },
        items: [estimateItemSchema],
        partsTotal: { type: Number, default: 0 },
        labourTotal: { type: Number, default: 0 },
        additionalTotal: { type: Number, default: 0 },
        grandTotal: { type: Number, default: 0 },
        status: {
            type: String,
            enum: ["draft", "submitted", "approved", "rejected"],
            default: "draft",
        },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdByName: { type: String },
        createdAt: { type: Date, default: Date.now },
        note: { type: String },
    },
    { _id: false },
);

const decisionSchema = new mongoose.Schema(
    {
        stage: {
            type: String,
            enum: ["assessment-reviewed", "estimate-approved", "estimate-rejected", "evidence-requested", "repair-completed", "final-inspection", "fed-to-passport"],
            required: true,
        },
        decision: { type: String, enum: ["approved", "rejected", "recorded", "requested"], required: true },
        reason: { type: String },
        by: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        byName: { type: String },
        byRole: { type: String },
        at: { type: Date, default: Date.now },
    },
    { _id: false },
);

const damageAssessmentSchema = new mongoose.Schema(
    {
        assessmentRef: { type: String, required: true, unique: true }, // DMR-2026-0001
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
        regNumber: { type: String },
        // The single accident record this assessment extends. Never a duplicate.
        linkedDamageEvent: { type: mongoose.Schema.Types.ObjectId, ref: "DamageEvent" },
        status: {
            type: String,
            enum: ["draft", "assessed", "estimate-raised", "submitted", "under-review", "approved", "rejected", "repair-completed", "verified", "closed"],
            default: "draft",
        },
        incidentNotes: { type: String, maxlength: 2000 },
        suspectedArea: { type: String },
        photos: [photoSchema],
        findings: [findingSchema],
        // Whether a real computer-vision model ran. In manual mode this is false
        // and the UI must present findings as assessor-recorded, not AI-detected.
        analysis: {
            mode: { type: String, enum: ["none", "computer-vision", "manual"], default: "none" },
            ranAt: { type: Date },
            engineName: { type: String },
            note: { type: String },
            // Honest statement that photographs cannot reveal hidden damage.
            limitation: { type: String },
        },
        estimate: estimateSchema,
        // Every prior estimate version is retained so an adjustment is auditable.
        estimateHistory: [estimateSchema],
        decisions: [decisionSchema],
        repairCompletion: {
            workshop: { type: String },
            technician: { type: String },
            completedAt: { type: Date },
            workSummary: { type: String },
            evidence: [photoSchema],
            finalInspection: { type: String, enum: ["not-recorded", "pending", "passed", "failed"], default: "not-recorded" },
            inspectedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            verified: { type: Boolean, default: false },
            note: { type: String },
        },
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        submitterName: { type: String },
        // Optional generated repaired-appearance preview. Shown ONLY when a real
        // image was produced, and always labelled as an AI preview, never evidence.
        appearancePreview: {
            available: { type: Boolean, default: false },
            url: { type: String },
            label: { type: String, default: "AI-generated preview - not photographic evidence of a completed repair" },
        },
        anchor: {
            algorithm: { type: String, default: "sha256" },
            recordHash: { type: String },
            status: { type: String, enum: ["hashed_only", "pending", "anchored", "failed"] },
            network: { type: String },
            txHash: { type: String },
            anchoredAt: { type: Date },
            note: { type: String },
        },
    },
    { timestamps: true },
);

damageAssessmentSchema.index({ vehicle: 1, createdAt: -1 });
damageAssessmentSchema.index({ linkedDamageEvent: 1 });
damageAssessmentSchema.index({ status: 1 });

export const DamageAssessment = mongoose.model("DamageAssessment", damageAssessmentSchema);

// Next sequential assessment reference, e.g. DMR-2026-0004
export const nextAssessmentRef = async () => {
    const year = new Date().getFullYear();
    const count = await DamageAssessment.countDocuments({ assessmentRef: new RegExp(`^DMR-${year}-`) });
    return `DMR-${year}-${String(count + 1).padStart(4, "0")}`;
};

// ---------------------------------------------------------------------------
// Configurable parts + labour catalogue. Estimates read prices ONLY from here.
// One document per component; seeded with clearly-labelled demo base prices so
// an estimate is traceable to a configured amount rather than an invented one.
// ---------------------------------------------------------------------------
const repairCostCatalogueSchema = new mongoose.Schema(
    {
        component: { type: String, enum: DAMAGE_COMPONENTS, required: true, unique: true },
        displayName: { type: String, required: true },
        category: { type: String, enum: ["panel", "glass", "electrical", "structural", "wheel", "cooling", "other"], default: "other" },
        // Base prices for the two actions the module can recommend.
        repairLabour: { type: Number, min: 0, default: 0 },
        replacePart: { type: Number, min: 0, default: 0 },
        replaceLabour: { type: Number, min: 0, default: 0 },
        currency: { type: String, default: "INR" },
        // Where the price came from. Never presented as a live market quote.
        source: { type: String, default: "configured-catalogue" },
        updatedAt: { type: Date, default: Date.now },
    },
    { timestamps: true },
);

export const RepairCostCatalogue = mongoose.model("RepairCostCatalogue", repairCostCatalogueSchema);
