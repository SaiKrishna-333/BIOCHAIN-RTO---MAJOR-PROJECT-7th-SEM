// SmartMigration.js
// BioChain Smart Migration Orchestrator.
//
// This collection does not replace the conventional inter-state Request: it wraps
// it. Every orchestrated migration keeps its linked Request (type interStateTransfer)
// so the existing two-state NOC/registration flow, the RTO dashboard and the
// on-chain anchoring all keep working unchanged. What this document adds is the
// intelligence around that flow: a readiness pre-check snapshot, an OCR document
// intelligence record, a dependency-ordered task/stage tracker, a state-wise cost
// estimate, NOC/deadline tracking, the consolidated migration passport reference,
// post-transfer reconciliation with exceptions, and an append-only event history
// describing every status transition.
//
// Honesty rules baked into the schema: a check that could not be made is recorded
// as "needs_review", never as "passed"; estimates are labelled as estimates; and
// discrepancies are stored for an officer to review - nothing here auto-corrects a
// source record.

import mongoose from "mongoose";

// A single orchestration check in the readiness report. "available" is deliberately
// not the same as "passed": a check only passes when the underlying record proves it.
const checkSchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        label: { type: String, required: true },
        // passed | warning | blocked | needs_review
        result: {
            type: String,
            enum: ["passed", "warning", "blocked", "needs_review"],
            default: "needs_review",
        },
        detail: { type: String, default: "" },
        // Where the finding came from, so the UI can link the operator to it.
        sourceModel: { type: String },
        sourceId: { type: String },
        sourceLabel: { type: String },
    },
    { _id: false }
);

// One dependency-ordered stage in the two-state coordination engine.
const stageSchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        title: { type: String, required: true },
        description: { type: String, default: "" },
        // Which authorized role can act on this stage (null = system-owned).
        ownerRole: { type: String },
        ownerState: { type: String }, // state code whose RTO office owns it
        // pending | submitted | under_review | documents_required | approved | rejected | completed | locked
        status: {
            type: String,
            enum: [
                "pending", "submitted", "under_review", "documents_required",
                "approved", "rejected", "completed", "locked",
            ],
            default: "pending",
        },
        // A stage may only be worked once every stage it depends on is approved/completed.
        dependsOn: [{ type: String }],
        actorName: { type: String },
        actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        remarks: { type: String },
        startedAt: { type: Date },
        completedAt: { type: Date },
    },
    { _id: false }
);

// One extracted field on a document card: the value OCR mined, how confident we
// are in it, and whether a human has accepted it. `status` drives the green/amber
// colouring of the extraction cards in the UI (confirmed | review | missing).
const fieldCardSchema = new mongoose.Schema(
    {
        key: { type: String, required: true },
        label: { type: String, required: true },
        value: { type: String },
        confidence: { type: Number, default: 0 }, // 0-100, OCR x regex strictness
        status: {
            type: String,
            enum: ["confirmed", "review", "missing"],
            default: "review",
        },
        // A human correction overrides the OCR value; we keep both for the audit trail.
        correctedValue: { type: String },
        correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    },
    { _id: false }
);

// Normalized identity references pulled from a document, used by the
// cross-document audit engine to answer questions like "does the VIN on the
// insurance certificate match the VIN on the bill of sale?" without re-parsing
// OCR text on every request.
const identityRefSchema = new mongoose.Schema(
    {
        regNumber: { type: String },
        chassisNumber: { type: String },
        engineNumber: { type: String },
        ownerName: { type: String },
        salePrice: { type: Number },
        declaredValue: { type: Number },
    },
    { _id: false }
);

// One line of the cross-document audit report (mirrors the "Audit Results" card).
const auditLineSchema = new mongoose.Schema(
    {
        severity: { type: String, enum: ["pass", "warning", "error"], required: true },
        text: { type: String, required: true },
        // Which documents produced this finding, so the UI can name them.
        docs: [{ type: String }],
    },
    { _id: false }
);

const documentSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        // rc | insurance | puc | address | bill_of_sale | tax | financier | other
        category: {
            type: String,
            enum: ["rc", "insurance", "puc", "address", "bill_of_sale", "tax", "financier", "other"],
            default: "other",
        },
        fileUrl: { type: String },
        mimeType: { type: String },
        sizeBytes: { type: Number },
        integrityHash: { type: String }, // sha256 of the uploaded bytes
        // OCR output, kept verbatim so a human can review what was actually read.
        ocrText: { type: String },
        ocrConfidence: { type: Number },
        extracted: { type: mongoose.Schema.Types.Mixed }, // fields the parser mined
        // Per-field extraction cards (value + confidence + review status) that
        // power the side-by-side "document image / extracted fields" panel.
        fieldCards: [fieldCardSchema],
        identityRefs: { type: identityRefSchema },
        // Parsed expiry date for insurance / PUC certificates (audit checks it).
        expiryDate: { type: Date },
        // Compare of extracted values against the vehicle/owner record.
        discrepancies: [{ type: String }],
        // Things worth showing an officer that are not conflicts - a name read from
        // an address proof, or the state an ID implies. Observations never block a
        // verification, because an Aadhaar is not expected to carry a reg number.
        observations: [{ type: String }],
        // uploaded | read | verified | rejected | unreadable
        reviewStatus: {
            type: String,
            enum: ["uploaded", "read", "verified", "rejected", "unreadable"],
            default: "uploaded",
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        uploadedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const exceptionSchema = new mongoose.Schema(
    {
        field: { type: String, required: true },
        sourceValue: { type: String },
        destinationValue: { type: String },
        severity: {
            type: String,
            enum: ["info", "warning", "critical"],
            default: "warning",
        },
        message: { type: String, default: "" },
        // Exceptions are only ever closed by an authorized officer, never auto-fixed.
        resolved: { type: Boolean, default: false },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        resolutionNote: { type: String },
        raisedAt: { type: Date, default: Date.now },
    },
    { _id: false }
);

const smartMigrationSchema = new mongoose.Schema(
    {
        // Human-unique orchestration id, e.g. BCM-2026-000123.
        migrationId: { type: String, required: true, unique: true },
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
        owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        // The conventional inter-state request this migration orchestrates, when one
        // has been filed. Nullable so a pre-check can exist before any application.
        request: { type: mongoose.Schema.Types.ObjectId, ref: "Request" },

        origin: {
            stateCode: { type: String },
            stateName: { type: String },
            rtoOffice: { type: String },
            regNumber: { type: String },
        },
        destination: {
            stateCode: { type: String },
            stateName: { type: String },
            rtoOffice: { type: String },
            newRegNumber: { type: String },
            newAddress: { type: String },
        },
        vehicleCategory: { type: String, default: "private" }, // private | commercial
        relocationReason: { type: String, default: "" },

        // overall orchestration status
        status: {
            type: String,
            enum: [
                "draft", "precheck_blocked", "ready_to_apply", "submitted",
                "source_under_review", "noc_issued", "destination_under_review",
                "reconciling", "completed", "rejected", "expired",
            ],
            default: "draft",
        },
        readiness: {
            // blocked | conditional | ready | needs_review
            verdict: {
                type: String,
                enum: ["ready", "conditional", "blocked", "needs_review"],
                default: "needs_review",
            },
            summary: { type: String, default: "" },
            recommendation: { type: String, default: "" },
            checks: [checkSchema],
            runAt: { type: Date },
        },

        costEstimate: {
            // Every figure here is an estimate derived from a configured rule table,
            // never an official demand notice.
            label: { type: String, default: "Estimate only - not an official tax demand" },
            destinationRoadTax: { type: Number },
            registrationFee: { type: Number },
            reassignmentFee: { type: Number },
            otherCharges: { type: Number },
            estimatedTotal: { type: Number },
            refundNote: { type: String, default: "" },
            ruleSource: { type: String, default: "" },
            ruleEffectiveDate: { type: String, default: "" },
            unsupported: [{ type: String }],
            computedAt: { type: Date },
        },

        // NOC / migration deadline tracking (Feature E).
        deadline: {
            nocIssueDate: { type: Date },
            validityDays: { type: Number }, // from the destination-state rule, not a global constant
            expiresAt: { type: Date },
            daysRemaining: { type: Number },
            expired: { type: Boolean, default: false },
            reminders: [
                {
                    dayThreshold: { type: Number },
                    firedAt: { type: Date },
                    note: { type: String },
                },
            ],
            nextAction: { type: String, default: "" },
        },

        // The consolidated migration passport reference (Feature F). The full payload
        // is produced on demand by the existing passport generator; only the reference
        // and its integrity hash are persisted here.
        passport: {
            passportId: { type: String },
            hash: { type: String },
            generatedAt: { type: Date },
            validUntil: { type: Date },
        },

        stages: [stageSchema],
        documents: [documentSchema],

        // Cross-document audit (Feature B): identity agreement between documents and
        // the BioChain record, expiry checks, missing/verified completeness. Rerun
        // on every upload / correction / verify; never auto-fixes anything.
        documentAudit: {
            // passed | warning | rejected | not_started
            status: { type: String, default: "not_started" },
            lines: [auditLineSchema],
            missing: [{ type: String }],
            checklist: [
                {
                    item: { type: String },
                    category: { type: String },
                    // pending | completed | attention
                    status: { type: String, default: "pending" },
                    detail: { type: String, default: "" },
                },
            ],
            auditedAt: { type: Date },
        },

        // Form drafts produced by the document intelligence layer - drafts only,
        // never signed or submitted on the owner's behalf. Each field carries the
        // document it was autofilled from so a reviewer can trace provenance.
        formDrafts: {
            form28: { type: mongoose.Schema.Types.Mixed },
            form27: { type: mongoose.Schema.Types.Mixed },
            checklist: [{ type: String }],
        },

        // Post-transfer reconciliation (Feature G).
        reconciliation: {
            verdict: {
                type: String,
                enum: ["pending", "consistent", "exception"],
                default: "pending",
            },
            comparedAt: { type: Date },
            notes: { type: String, default: "" },
        },
        exceptions: [exceptionSchema],

        // Append-only audit trail: one entry per status transition.
        eventHistory: [
            {
                at: { type: Date, default: Date.now },
                actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                actorRole: { type: String },
                action: { type: String, required: true },
                fromStatus: { type: String },
                toStatus: { type: String },
                note: { type: String, default: "" },
            },
        ],
    },
    { timestamps: true }
);

smartMigrationSchema.index({ vehicle: 1, createdAt: -1 });
smartMigrationSchema.index({ owner: 1, status: 1 });
smartMigrationSchema.index({ "origin.stateCode": 1, "destination.stateCode": 1 });
smartMigrationSchema.index({ status: 1, createdAt: -1 });

export const SmartMigration = mongoose.model("SmartMigration", smartMigrationSchema);
