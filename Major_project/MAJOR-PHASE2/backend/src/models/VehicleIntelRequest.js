// VehicleIntelRequest.js
// Owner-initiated request for a Vehicle Intelligence report.
// Flow: owner asks the authorized (brand-matched) workshop for a vehicle's
// verified records -> workshop responds by creating the records and marking
// this request answered -> the data now lives on the VEHICLE itself, so it
// automatically follows any future ownership transfer.

import mongoose from "mongoose";

const anchorSchema = new mongoose.Schema(
    {
        algorithm: { type: String },
        recordHash: { type: String },
        status: { type: String, enum: ["hashed_only", "pending", "anchored", "failed"] },
        network: { type: String },
        txHash: { type: String },
        anchoredAt: { type: Date },
        note: { type: String }
    },
    { _id: false }
);

const vehicleIntelRequestSchema = new mongoose.Schema(
    {
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
        requester: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // the owner
        workshop: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // brand-matched workshop

        status: {
            type: String,
            enum: ["pending", "responded", "cancelled"],
            default: "pending",
            index: true
        },
        // Which record families the owner needs, e.g. ["service", "battery"]
        requestedItems: {
            type: [{ type: String, enum: ["service", "odometer", "parts", "battery", "damage"] }],
            validate: (v) => Array.isArray(v) && v.length > 0
        },
        note: { type: String, maxlength: 500 }, // owner's message to the workshop

        response: {
            submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            submittedAt: { type: Date },
            note: { type: String, maxlength: 1000 },
            // Links back to the actual intelligence records created at response time
            recordsCreated: [
                {
                    _id: false,
                    type: { type: String, enum: ["service", "parts", "battery", "damage"] },
                    id: { type: mongoose.Schema.Types.ObjectId }
                }
            ]
        },

        // Completion proof: the fulfilled request hashed and anchored on-chain
        anchor: { type: anchorSchema }
    },
    { timestamps: true }
);

vehicleIntelRequestSchema.index({ vehicle: 1, requester: 1, status: 1 });

export const VehicleIntelRequest = mongoose.model("VehicleIntelRequest", vehicleIntelRequestSchema);
