// ServiceRecord.js
// Feature 1: Verified Vehicle Service and Odometer History
// Append-only service/odometer timeline. A reading lower than the previous
// recorded reading is FLAGGED FOR REVIEW - it is a warning, never proof of
// fraud. Authorized corrections keep an audit trail in `corrections`.

import mongoose from "mongoose";

const correctionSchema = new mongoose.Schema(
    {
        field: { type: String, required: true }, // e.g. "odometerKm"
        previousValue: { type: mongoose.Schema.Types.Mixed },
        newValue: { type: mongoose.Schema.Types.Mixed },
        reason: { type: String, required: true },
        correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        correctedAt: { type: Date, default: Date.now }
    },
    { _id: false }
);

const serviceRecordSchema = new mongoose.Schema(
    {
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
        regNumber: { type: String }, // denormalized for timeline queries
        serviceDate: { type: Date, required: true },
        odometerKm: { type: Number, required: true, min: 0 },
        serviceType: {
            type: String,
            enum: ["periodic-service", "repair", "part-replacement", "inspection", "recall", "other"],
            required: true
        },
        description: { type: String, required: true, maxlength: 2000 },
        partsReplaced: [{
            partName: { type: String, required: true },
            partSerial: { type: String } // optional; links to provenance tracker later
        }],
        cost: { type: Number, min: 0 },
        // Submitter identity (authorized service centre / admin / RTO)
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        submitterName: { type: String }, // denormalized workshop display name
        manufacturer: { type: String }, // vehicle company the centre is affiliated with (captured at submission)
        // Evidence reference (file id / URL) - never personal data on the record itself
        evidenceReference: { type: String },
        // Review workflow
        status: {
            type: String,
            enum: ["verified", "flagged_for_review", "corrected"],
            default: "verified"
        },
        flagReason: { type: String }, // why an odometer reading was flagged
        corrections: [correctionSchema],
        // Tamper-evident anchor metadata written by recordAnchorService
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

serviceRecordSchema.index({ vehicle: 1, serviceDate: -1 });
// The anchoring worker picks up records by their commit status.
serviceRecordSchema.index({ status: 1 });
serviceRecordSchema.index({ regNumber: 1 });

export const ServiceRecord = mongoose.model("ServiceRecord", serviceRecordSchema);
