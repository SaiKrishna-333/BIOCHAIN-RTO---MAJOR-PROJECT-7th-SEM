import mongoose from "mongoose";

const challanSchema = new mongoose.Schema(
    {
        // Vehicle Information
        vehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            required: true
        },
        regNumber: {
            type: String,
            required: true
        },

        // Violation Details
        violationType: {
            type: String,
            required: true,
            enum: [
                "speeding",
                "red_light",
                "no_helmet",
                "no_seatbelt",
                "drunk_driving",
                "overloading",
                "no_insurance",
                "no_puc",
                "illegal_parking",
                "wrong_lane",
                "other"
            ]
        },
        violationDescription: {
            type: String,
            required: true
        },

        // Location & Time
        location: {
            type: String,
            required: true
        },
        violationDate: {
            type: Date,
            required: true,
            default: Date.now
        },

        // Fine Details
        fineAmount: {
            type: Number,
            required: true,
            min: 0
        },
        penaltyPoints: {
            type: Number,
            default: 0
        },

        // Payment Status
        paymentStatus: {
            type: String,
            enum: ["pending", "paid", "partial"],
            default: "pending"
        },
        paidAmount: {
            type: Number,
            default: 0
        },
        paymentDate: {
            type: Date
        },
        paymentMethod: {
            type: String,
            enum: ["cash", "card", "upi", "online", null]
        },

        // Officer Details
        issuingOfficer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        officerName: {
            type: String,
            required: true
        },
        officerBadgeNumber: {
            type: String
        },

        // Evidence
        evidencePhotos: [{
            imageUrl: String,
            ipfsHash: String
        }],

        // Status
        status: {
            type: String,
            enum: ["active", "cancelled", "disputed"],
            default: "active"
        },
        disputeReason: {
            type: String
        },
        disputeDate: {
            type: Date
        },

        // Metadata
        remarks: {
            type: String
        }
    },
    { timestamps: true }
);

// Index for efficient queries
challanSchema.index({ vehicle: 1, paymentStatus: 1 });
// Officer queues and dispute screens filter on challan status.
challanSchema.index({ status: 1, violationDate: -1 });
challanSchema.index({ regNumber: 1 });
challanSchema.index({ issuingOfficer: 1 });

export const Challan = mongoose.model("Challan", challanSchema);
