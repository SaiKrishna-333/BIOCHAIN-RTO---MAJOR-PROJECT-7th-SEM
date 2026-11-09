// TransferApprovalWorkflow.js
// Feature 8: Conditional Vehicle Transfer with Multi-Party Approval
// A configurable approval checklist attached to an existing transfer Request.
// The transfer stays pending while mandatory steps are incomplete; every
// decision is appended to an audit history (never overwritten).
// NOTE: this workflow supports the official process - it is not itself a
// legally binding RTO approval, and the on-chain VehicleRegistry contract is
// unchanged; finalized decision sets are hash-anchored in the DB.

import mongoose from "mongoose";

const stepSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            enum: ["seller-authorization", "buyer-acceptance", "document-verification", "inspection", "rto-approval"],
            required: true
        },
        label: { type: String, required: true },
        required: { type: Boolean, default: true },
        status: {
            type: String,
            enum: ["not_started", "pending", "approved", "rejected", "not_required"],
            default: "not_started"
        },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        actorName: { type: String },
        actorRole: { type: String },
        decidedAt: { type: Date },
        reason: { type: String },
        // Hash anchor of the finalized decision (DB; chain when configured)
        anchor: {
            recordHash: { type: String },
            status: { type: String },
            txHash: { type: String },
            anchoredAt: { type: Date },
            note: { type: String }
        }
    },
    { _id: false }
);

const decisionLogSchema = new mongoose.Schema(
    {
        stepKey: { type: String, required: true },
        previousStatus: { type: String, required: true },
        newStatus: { type: String, required: true },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        actorName: { type: String },
        actorRole: { type: String },
        reason: { type: String },
        at: { type: Date, default: Date.now }
    },
    { _id: false }
);

const transferApprovalWorkflowSchema = new mongoose.Schema(
    {
        request: { type: mongoose.Schema.Types.ObjectId, ref: "Request", required: true, unique: true },
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
        regNumber: { type: String },
        steps: [stepSchema],
        decisions: [decisionLogSchema], // append-only audit history
        workflowAnchor: {
            algorithm: { type: String, default: "sha256" },
            recordHash: { type: String },
            status: { type: String },
            txHash: { type: String },
            anchoredAt: { type: Date },
            note: { type: String }
        }
    },
    { timestamps: true }
);

// Derived (never stored as truth) progress state
transferApprovalWorkflowSchema.virtual("progress").get(function () {
    const steps = this.steps || [];
    const mandatory = steps.filter(s => s.required);
    const approved = mandatory.filter(s => s.status === "approved").length;
    const rejected = mandatory.filter(s => s.status === "rejected").length;
    let overall = "pending";
    if (rejected > 0) overall = "blocked";
    else if (mandatory.length > 0 && approved === mandatory.length) overall = "complete";
    return {
        overall,
        mandatoryTotal: mandatory.length,
        mandatoryApproved: approved,
        mandatoryRejected: rejected,
        percent: mandatory.length ? Math.round((approved / mandatory.length) * 100) : 0
    };
});

transferApprovalWorkflowSchema.set("toJSON", { virtuals: true });
transferApprovalWorkflowSchema.set("toObject", { virtuals: true });

export const TransferApprovalWorkflow = mongoose.model("TransferApprovalWorkflow", transferApprovalWorkflowSchema);

// Default checklist for a standard ownership transfer
export const DEFAULT_TRANSFER_STEPS = [
    { key: "seller-authorization", label: "Seller Authorization", required: true },
    { key: "buyer-acceptance", label: "Buyer Acceptance", required: true },
    { key: "document-verification", label: "Document Verification", required: true },
    { key: "inspection", label: "Inspection (authorized workshop)", required: false },
    { key: "rto-approval", label: "RTO Officer Approval", required: true }
];

// Which role may decide each step (RTO/admin can override any step)
export const STEP_ROLE_MAP = {
    "seller-authorization": ["owner"],
    "buyer-acceptance": ["owner"],
    "document-verification": ["rto", "admin"],
    "inspection": ["workshop", "rto", "admin"],
    "rto-approval": ["rto"]
};
