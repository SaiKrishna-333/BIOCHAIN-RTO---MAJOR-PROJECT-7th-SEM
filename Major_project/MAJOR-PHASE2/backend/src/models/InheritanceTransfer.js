import mongoose from "mongoose";

const inheritanceTransferSchema = new mongoose.Schema(
    {
        vehicle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Vehicle",
            required: true
        },
        deceasedOwner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        legalHeir: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        deathCertificateNumber: {
            type: String,
            required: true
        },
        relationshipToDeceased: {
            type: String,
            enum: ["spouse", "child", "parent", "sibling", "legal_heir"],
            required: true
        },
        successionCertificateNumber: {
            type: String
        },
        courtOrderNumber: {
            type: String
        },
        documents: [{
            documentType: {
                type: String,
                enum: ["death_certificate", "succession_certificate", "court_order", "identity_proof", "address_proof"]
            },
            documentUrl: String,
            verified: {
                type: Boolean,
                default: false
            }
        }],
        status: {
            type: String,
            enum: ["submitted", "documents_verified", "rto_review", "approved", "rejected"],
            default: "submitted"
        },
        rtoOfficer: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User"
        },
        remarks: {
            type: String
        }
    },
    { timestamps: true }
);

// Succession requests are queued by status and read per vehicle by the RTO.
inheritanceTransferSchema.index({ vehicle: 1, status: 1 });
inheritanceTransferSchema.index({ status: 1, createdAt: -1 });

export const InheritanceTransfer = mongoose.model("InheritanceTransfer", inheritanceTransferSchema);