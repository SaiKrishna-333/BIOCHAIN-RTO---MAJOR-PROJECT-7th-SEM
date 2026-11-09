// DamageEvent.js
// Feature 6: Verified Vehicle Damage and Repair Passport
// Chronological damage/repair timeline. Entries are clearly labelled
// reported / verified / disputed - the system only records what authorized
// inspectors submit; it cannot discover unreported damage.

import mongoose from "mongoose";

const damageEventSchema = new mongoose.Schema(
    {
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle", required: true },
        regNumber: { type: String },
        eventType: {
            type: String,
            enum: ["accident-damage", "flood-exposure", "structural-repair", "safety-part-replacement", "inspection"],
            required: true
        },
        eventDate: { type: Date, required: true },
        reportDate: { type: Date, default: Date.now },
        description: { type: String, required: true, maxlength: 2000 },
        severity: { type: String, enum: ["minor", "moderate", "severe", "unknown"], default: "unknown" },
        affectedAreas: [{ type: String }],
        // reported -> verified (inspector/RTO checked evidence) or disputed
        verificationStatus: {
            type: String,
            enum: ["reported", "verified", "disputed"],
            default: "reported"
        },
        verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        verifiedAt: { type: Date },
        submittedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        submitterName: { type: String },
        organization: { type: String },
        // Two ways a damage record enters the passport:
        // - authorized-submitter: verified workshop / RTO / admin (Feature 6 path)
        // - owner-upload: the vehicle owner's own accident statement with dashcam
        //   media, which always starts as "reported" and only an officer can move it
        sourceChannel: {
            type: String,
            enum: ["authorized-submitter", "owner-upload"],
            default: "authorized-submitter"
        },
        // Accident specifics captured on the owner's submission. Kept in one
        // sub-document so the officer queue can read them without parsing text.
        accident: {
            location: { type: String },
            oppositePartyRegNumber: { type: String },
            oppositePartyName: { type: String },
            oppositePartyPhone: { type: String },
            oppositePartyInsurance: { type: String },
            policeStation: { type: String },
            firNumber: { type: String },
            injuries: {
                type: String,
                enum: ["none", "minor", "serious", "unknown"],
                default: "unknown"
            }
        },
        // The officer's finding, stored separately from the submitted statement so
        // the owner's original words are never rewritten and the record hash of the
        // submission stays verifiable after a review.
        officerReview: {
            outcome: { type: String, enum: ["pending", "verified", "disputed"] },
            remarks: { type: String },
            reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            reviewedByName: { type: String },
            reviewedByRole: { type: String },
            reviewedAt: { type: Date }
        },
        // Small evidence files keep their bytes here (same approach as profile
        // photos); dashcam media is too large for one document, so it is stored on
        // the server's media disk and referenced by storedAs. Raw evidence and
        // personal data are never placed on-chain - only their SHA-256 digests.
        evidence: [{
            fileName: { type: String },
            contentType: { type: String },
            fileSize: { type: Number },
            data: Buffer,
            sha256: { type: String },
            uploadedAt: { type: Date, default: Date.now },
            storage: { type: String, enum: ["inline", "disk"], default: "inline" },
            storedAs: { type: String }
        }],
        // Correction history (append-only, audited)
        corrections: [{
            field: { type: String },
            previousValue: { type: mongoose.Schema.Types.Mixed },
            newValue: { type: mongoose.Schema.Types.Mixed },
            reason: { type: String },
            correctedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            correctedAt: { type: Date, default: Date.now }
        }],
        anchor: {
            algorithm: { type: String, default: "sha256" },
            recordHash: { type: String }, // hash of metadata (excludes evidence bytes)
            evidenceHashes: [{ file: String, sha256: String }],
            status: { type: String, enum: ["hashed_only", "pending", "anchored", "failed"] },
            network: { type: String },
            txHash: { type: String },
            anchoredAt: { type: Date },
            note: { type: String }
        }
    },
    { timestamps: true }
);

damageEventSchema.index({ vehicle: 1, eventDate: -1 });
// Officer review queue: owner submissions in the order they arrived
damageEventSchema.index({ sourceChannel: 1, verificationStatus: 1, createdAt: -1 });

export const DamageEvent = mongoose.model("DamageEvent", damageEventSchema);
