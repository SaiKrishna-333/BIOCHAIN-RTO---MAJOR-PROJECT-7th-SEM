// AnomalyAlert.js
// Feature 4: AI-Based Vehicle Transaction Anomaly Detection
// Explainable indicators from a transparent statistical model, stored beside
// (never replacing) the existing rule-based weighted risk score.
// Officers mark alerts as reviewed / false-positive / investigate.

import mongoose from "mongoose";

const anomalyAlertSchema = new mongoose.Schema(
    {
        alertType: {
            type: String,
            enum: ["rapid-resale", "frequent-ownership-change", "flagged-account-repeat", "inconsistent-sequence"],
            required: true
        },
        // What the alert points at
        subjectType: { type: String, enum: ["vehicle", "user"], required: true },
        subject: { type: mongoose.Schema.Types.Mixed }, // vehicle/user _id
        subjectLabel: { type: String }, // reg number or name for display
        relatedVehicles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" }],
        relatedRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: "Request" }],

        // Explainable output
        riskIndicator: { type: Number, min: 0, max: 100, required: true },
        severity: { type: String, enum: ["low", "medium", "high"], required: true },
        contributingFactors: [{
            factor: { type: String },
            detail: { type: String },
            weight: { type: Number }
        }],
        explanation: { type: String, required: true },
        // Distinguish model output from the rule-based score
        method: { type: String, enum: ["statistical-anomaly", "baseline-rules"], default: "statistical-anomaly" },
        ruleBasedScore: { type: Number }, // the existing weighted score, shown side by side
        modelVersion: { type: String, required: true },

        reviewStatus: {
            type: String,
            enum: ["pending", "reviewed", "false-positive", "investigate"],
            default: "pending"
        },
        reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        reviewedAt: { type: Date },
        reviewRemarks: { type: String },
        linkedCase: { type: mongoose.Schema.Types.ObjectId, ref: "InvestigationCase" },
        recommendedAction: { type: String }
    },
    { timestamps: true }
);

anomalyAlertSchema.index({ reviewStatus: 1, riskIndicator: -1, createdAt: -1 });
anomalyAlertSchema.index({ subjectType: 1, subject: 1 });

export const AnomalyAlert = mongoose.model("AnomalyAlert", anomalyAlertSchema);
