// ComponentRecord.js + ComponentEvent
// Feature 2: Critical Vehicle Parts Provenance Tracker
// Serialized parts (engine, battery pack, gearbox...) get an append-only
// lifecycle history. A serial that is "active" on two vehicles at once is
// flagged as a CONFLICT for investigation - never an automatic fraud verdict.

import mongoose from "mongoose";

const componentRecordSchema = new mongoose.Schema(
    {
        componentType: {
            type: String,
            enum: ["engine", "battery-pack", "gearbox", "transmission", "motor", "chassis-panel", "other"],
            required: true
        },
        serialNumber: { type: String, required: true }, // normalized uppercase
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
        regNumber: { type: String },
        status: {
            type: String,
            enum: ["active", "removed", "replaced", "inspected-passed", "inspected-failed", "retired"],
            default: "active"
        },
        conflict: {
            flagged: { type: Boolean, default: false },
            reason: { type: String },
            flaggedAt: { type: Date },
            reviewStatus: { type: String, enum: ["unreviewed", "under-investigation", "cleared"], default: "unreviewed" }
        },
        evidenceReference: { type: String },
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

componentRecordSchema.index({ serialNumber: 1, vehicle: 1 }, { unique: true });
componentRecordSchema.index({ serialNumber: 1, status: 1 });
componentRecordSchema.index({ vehicle: 1 });

export const ComponentRecord = mongoose.model("ComponentRecord", componentRecordSchema);

const componentEventSchema = new mongoose.Schema(
    {
        component: { type: mongoose.Schema.Types.ObjectId, ref: "ComponentRecord", required: true },
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
        eventType: {
            type: String,
            enum: ["installed", "removed", "replaced", "inspected"],
            required: true
        },
        eventDate: { type: Date, required: true },
        reason: { type: String },
        workshopName: { type: String },
        inspectionResult: { type: String, enum: ["pass", "fail", "not-applicable"], default: "not-applicable" },
        evidenceReference: { type: String },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        anchor: {
            recordHash: { type: String },
            status: { type: String },
            txHash: { type: String },
            anchoredAt: { type: Date },
            note: { type: String }
        }
    },
    { timestamps: true }
);

componentEventSchema.index({ component: 1, eventDate: -1 });

export const ComponentEvent = mongoose.model("ComponentEvent", componentEventSchema);
