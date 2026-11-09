// IdentityConflict.js
// Feature 5: Cross-Record Vehicle Identity Cloning Detector
// Exact-match conflicts found by normalizing (case/hyphen/whitespace only)
// chassis & engine identifiers across registration records. Uncertain matches
// are NEVER auto-accused - they are stored for human review.

import mongoose from "mongoose";

const identityConflictSchema = new mongoose.Schema(
    {
        conflictType: {
            type: String,
            enum: ["duplicate-chassis", "duplicate-engine", "conflicting-registration-association"],
            required: true
        },
        // The normalized identifier value that collided
        identifierValue: { type: String, required: true },
        rawValues: [{ type: String }],
        vehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" }],
        regNumbers: [{ type: String }],
        detectedAt: { type: Date, default: Date.now },
        lastCheckedAt: { type: Date },
        reviewStatus: {
            type: String,
            enum: ["unreviewed", "under-investigation", "legitimate-correction", "false-positive", "resolved"],
            default: "unreviewed"
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reviewedAt: { type: Date },
        reviewRemarks: { type: String },
        // Set when a new conflicting record was refused at save time
        blockedNewRecord: { type: Boolean, default: false },
        linkedCase: { type: mongoose.Schema.Types.ObjectId, ref: "InvestigationCase" }
    },
    { timestamps: true }
);

identityConflictSchema.index({ conflictType: 1, identifierValue: 1 }, { unique: true });
identityConflictSchema.index({ reviewStatus: 1, detectedAt: -1 });

export const IdentityConflict = mongoose.model("IdentityConflict", identityConflictSchema);
