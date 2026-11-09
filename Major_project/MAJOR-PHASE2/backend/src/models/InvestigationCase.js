// InvestigationCase.js
// Feature 3: Blockchain-Verified Vehicle Fraud Investigation Casebook
// Structured cases for police/RTO officers with an append-only action history.
// Evidence files keep a SHA-256 so later tampering can be detected; a hash
// does NOT prove the evidence was truthful when submitted (shown in the UI).

import mongoose from "mongoose";

const actionSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true
        }, // created / status-change / note / evidence-added / linked / resolved / closed / reopened
        detail: { type: String, required: true },
        performedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        performerName: { type: String },
        performerRole: { type: String },
        performedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const investigationCaseSchema = new mongoose.Schema(
    {
        caseRef: { type: String, required: true, unique: true }, // CASE-2026-0001
        title: { type: String, required: true, maxlength: 200 },
        reason: { type: String, required: true }, // reason for review
        priority: { type: String, enum: ["low", "medium", "high", "critical"], default: "medium" },
        status: {
            type: String,
            enum: ["open", "under-review", "action-required", "resolved", "closed"],
            default: "open"
        },
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
        regNumber: { type: String },
        relatedRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Request" }],
        relatedAlerts: [{ type: mongoose.Schema.Types.ObjectId }], // anomaly / cloning alerts
        assignedOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        actions: [actionSchema], // chronological timeline
        notes: [{
            text: { type: String, required: true },
            author: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            authorName: { type: String },
            createdAt: { type: Date, default: Date.now }
        }],
        // Evidence metadata + file bytes in MongoDB; only hashes are anchored
        evidence: [{
            fileName: { type: String },
            contentType: { type: String },
            fileSize: { type: Number },
            data: Buffer,
            sha256: { type: String },
            description: { type: String },
            addedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            addedAt: { type: Date, default: Date.now }
        }],
        // Relevant blockchain transaction hashes (vehicles/ownership records)
        blockchainTxRefs: [{
            txHash: { type: String },
            label: { type: String }
        }],
        resolution: { type: String },
        resolvedAt: { type: Date },
        anchor: {
            algorithm: { type: String, default: "sha256" },
            recordHash: { type: String },
            status: { type: String, enum: ["hashed_only", "pending", "anchored", "failed"] },
            network: { type: String },
            txHash: { type: String },
            anchoredAt: { type: Date },
            note: { type: String }
        }
    },
    { timestamps: true }
);

investigationCaseSchema.index({ status: 1, priority: -1, createdAt: -1 });
investigationCaseSchema.index({ vehicle: 1 });
investigationCaseSchema.index({ regNumber: 1 });

export const InvestigationCase = mongoose.model("InvestigationCase", investigationCaseSchema);

// Next sequential case reference, e.g. CASE-2026-0007
export const nextCaseRef = async () => {
    const year = new Date().getFullYear();
    const count = await InvestigationCase.countDocuments({ caseRef: new RegExp(`^CASE-${year}-`) });
    return `CASE-${year}-${String(count + 1).padStart(4, "0")}`;
};
