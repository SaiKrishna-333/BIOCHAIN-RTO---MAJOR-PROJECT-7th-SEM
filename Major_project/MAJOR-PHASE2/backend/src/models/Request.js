import mongoose from "mongoose";

const requestSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ["newRegistration", "transfer", "interStateTransfer"],
            required: true
        },
        vehicle: { type: mongoose.Schema.Types.ObjectId, ref: "Vehicle" },
        dealer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        seller: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        buyer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        rtoOfficer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        status: {
            type: String,
            enum: [
                "pending",
                "source_rto_approved",
                "destination_rto_approved",
                "approved",
                "rejected"
            ],
            default: "pending"
        },
        remarks: { type: String },
        // Invoice Data (auto-generated for new registrations)
        invoice: {
            invoiceNumber: { type: String },
            invoiceDate: { type: Date, default: Date.now },
            // Pricing
            exShowroomPrice: { type: Number, default: 0 },
            roadTax: { type: Number, default: 0 },
            registrationFee: { type: Number, default: 0 },
            insuranceAmount: { type: Number, default: 0 },
            handlingCharges: { type: Number, default: 0 },
            otherCharges: { type: Number, default: 0 },
            gstAmount: { type: Number, default: 0 },
            grandTotal: { type: Number, default: 0 },
            // Payment
            paymentMode: { type: String, default: "Full Payment" },
            // Nothing in this app takes money for an invoice, so an invoice starts
            // and stays unpaid until a receipt is actually recorded.
            paymentStatus: { type: String, default: "Pending" },
            // Verification
            verificationStatus: {
                type: String,
                enum: ["pending", "verified", "rejected"],
                default: "pending"
            },
            verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            verifiedAt: { type: Date },
            verificationRemarks: { type: String },
            // Digital signature
            signatureHash: { type: String },
            // Blockchain reference
            blockchainTxHash: { type: String }
        },
        // Document verification status
        documentsVerified: { type: Boolean, default: false },
        // Resale offer between two owners (type === "transfer").
        // The buyer must review the attached vehicle intelligence and accept
        // before the RTO can finalize the transfer.
        offer: {
            salePrice: { type: Number },
            message: { type: String },
            attachIntel: { type: Boolean }, // set explicitly by the seller; NO default here - a leaf default would make mongoose synthesize this subdoc for every legacy transfer and break the RTO approve gate
            buyerAccepted: { type: Boolean },
            buyerAcceptedAt: { type: Date },
            buyerPaymentMode: { type: String },
            declinedAt: { type: Date },
            declineReason: { type: String }
        },
        // Multi-Authority Consensus Protocol (Feature 3)
        consensus: {
            type: Object,
            default: null
        },
        // Inter-State Transfer Details
        interStateDetails: {
            currentState: { type: String }, // Source state code
            targetState: { type: String }, // Destination state code
            newAddress: { type: String }, // New address in destination state
            currentRegNumber: { type: String },
            newRegNumber: { type: String },
            vehiclePassport: { type: Object }, // Generated vehicle passport
            passportHash: { type: String }, // Passport verification hash
            sourceRTOApproval: {
                status: { type: String, default: "pending" },
                officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                officerName: { type: String },
                rtoOffice: { type: String },
                timestamp: { type: Date },
                remarks: { type: String }
            },
            destinationRTOApproval: {
                status: { type: String, default: "pending" },
                officerId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                officerName: { type: String },
                rtoOffice: { type: String },
                timestamp: { type: Date },
                remarks: { type: String }
            },
            transferInitiatedAt: { type: Date },
            completedAt: { type: Date }
        }
    },
    { timestamps: true }
);

// RTO dashboards list requests by status, and a vehicle's pending paperwork is
// looked up by vehicle - both filters over this collection.
requestSchema.index({ status: 1, createdAt: -1 });
requestSchema.index({ vehicle: 1, status: 1 });

export const Request = mongoose.model("Request", requestSchema);
