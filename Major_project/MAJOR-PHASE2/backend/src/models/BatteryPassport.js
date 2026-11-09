// BatteryPassport.js
// Feature 7: Electric Vehicle Battery Passport
// One passport per EV. Every state-of-health / replacement / warranty update
// is appended as a new history event - the audit history is never overwritten.
// Values are clearly labelled by source. The system does NOT read a real EV
// battery: without a genuine integration, only submitted (or clearly marked
// simulated demo) values exist.

import mongoose from "mongoose";

const batteryEventSchema = new mongoose.Schema(
    {
        eventType: {
            type: String,
            enum: ["initial-report", "soh-report", "replacement", "warranty-update", "charging-data", "inspection"],
            required: true
        },
        eventDate: { type: Date, required: true },
        // Measurements (only those supplied by the source are stored)
        stateOfHealthPercent: { type: Number, min: 0, max: 100 },
        capacityKwh: { type: Number, min: 0 },
        cycleCount: { type: Number, min: 0 },
        rangeKmEstimate: { type: Number, min: 0 },
        replacementDetails: { type: String },
        warrantyDetails: {
            provider: { type: String },
            coveredUntil: { type: Date },
            terms: { type: String }
        },
        // Honest source labelling
        sourceType: {
            type: String,
            enum: ["unverified", "owner-reported", "workshop-verified", "diagnostic-device", "simulated-demo"],
            required: true
        },
        sourceDescription: { type: String }, // e.g. "OBD scan at XYZ centre"
        notes: { type: String, maxlength: 1000 },
        recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        recordedAt: { type: Date, default: Date.now },
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

const batteryPassportSchema = new mongoose.Schema(
    {
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true, unique: true },
        regNumber: { type: String },
        isElectric: { type: Boolean, default: true },
        batteryIdentifier: { type: String, required: true },
        manufacturer: { type: String },
        chemistry: { type: String, enum: ["lithium-ion", "lfp", "nickel-metal-hydride", "solid-state", "other", "unknown"], default: "unknown" },
        nominalCapacityKwh: { type: Number, min: 0 },
        installationDate: { type: Date },
        // Latest values are derived from (never replace) the event history
        currentSoH: { type: Number, min: 0, max: 100 },
        lastTestedAt: { type: Date },
        lastSource: { type: String },
        events: [batteryEventSchema],
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

export const BatteryPassport = mongoose.model("BatteryPassport", batteryPassportSchema);
