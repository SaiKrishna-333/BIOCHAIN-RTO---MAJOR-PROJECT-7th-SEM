// UserIdCard.js
// The citizen's Digital Identity Card (mParivahan style) - one per user.
// Holds a snapshot of everything the profile card displays: identity,
// identifiers, DID/wallet, the simulated biometric enrollment, and the
// tamper-evident anchor (record hash committed on Polygon Amoy).

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

const userIdCardSchema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true, required: true },
        cardNumber: { type: String, unique: true, required: true }, // e.g. BCH-ID-A1B2C3D4
        version: { type: Number, default: 1 },
        issuedAt: { type: Date, default: Date.now },

        holder: {
            name: { type: String },
            role: { type: String },
            email: { type: String },
            phone: { type: String },
            address: { type: String },
            state: { type: String },
            district: { type: String },
            hasPhoto: { type: Boolean, default: false }
        },
        identifiers: {
            aadhaarMasked: { type: String }, // XXXX XXXX 1234 - never full number on a card
            dlNumber: { type: String },
            badgeNumber: { type: String }, // police
            employeeId: { type: String }, // rto
            gstin: { type: String }, // dealer / workshop
            organization: { type: String }, // business / shop / RTO office name
            did: { type: String },
            biochainDid: { type: String },
            walletAddress: { type: String }
        },
        biometric: {
            enrolled: { type: Boolean, default: false },
            templateId: { type: String },
            // Stable numeric seed (derived server-side from the template hash)
            // the UI uses to draw this user's unique fingerprint ridge pattern.
            fingerprintSeed: { type: String },
            algorithm: { type: String, default: "simulated-fingerprint-v1" },
            enrolledAt: { type: Date }
        },
        kyc: {
            documentType: { type: String }, // aadhaar | driving-licence | ...
            extractedViaOcr: { type: Boolean, default: false },
            verifiedAt: { type: Date }
        },

        anchor: { type: anchorSchema }
    },
    { timestamps: true }
);

export const UserIdCard = mongoose.model("UserIdCard", userIdCardSchema);
