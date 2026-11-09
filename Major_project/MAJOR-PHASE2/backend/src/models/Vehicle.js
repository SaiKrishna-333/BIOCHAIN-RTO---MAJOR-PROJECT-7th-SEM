import mongoose from "mongoose";

const vehicleSchema = new mongoose.Schema(
    {
        regNumber: { type: String, unique: true, sparse: true },
        chassisNumber: { type: String, required: true, unique: true },
        engineNumber: { type: String, required: true, unique: true },
        make: { type: String, required: true },
        model: { type: String, required: true },
        year: { type: Number, required: true },
        currentOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        blockchainAddress: { type: String }, // Blockchain address of the vehicle NFT/token
        blockchainTxHash: { type: String }, // Last transaction hash
        ownershipHistory: [{
            owner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            transferDate: { type: Date },
            blockchainTxHash: { type: String },
            transferReason: { type: String, enum: ["purchase", "inheritance", "gift", "transfer"] },
            ipfsDocumentHash: { type: String } // IPFS hash of transfer documents
        }],
        status: {
            type: String,
            enum: ["active", "blocked", "stolen", "scrapped", "registered", "transfer_pending", "under_investigation"],
            default: "active"
        },
        lastStateChange: { type: Date },
        stateChangeHistory: [{
            from: { type: String },
            to: { type: String },
            reason: { type: String },
            authorizedBy: { type: String },
            timestamp: { type: Date, default: Date.now }
        }],
        lastVerified: { type: Date },
        // What the printed registration certificate is allowed to assert. Each value
        // is captured when an officer actually issues the number, so the RC never has
        // to invent an issue date, an office or a signing officer.
        registrationDate: { type: Date },
        issuedByOffice: { type: String },
        issuedByOfficer: { type: String },
        // The account that put this vehicle into the registry (dealer or owner).
        registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        // IPFS document hashes for vehicle documents
        ipfsDocuments: {
            rcCertificate: { type: String }, // Registration Certificate
            insurance: { type: String },
            puc: { type: String }, // Pollution Under Control
            transferForms: { type: String }, // Form 29/30
            invoice: { type: String }, // Purchase invoice
            otherDocuments: [{ type: String }] // Array for additional docs
        },
        // Document metadata with verification status and expiry
        documents: [{
            type: {
                type: String,
                enum: ["rc", "insurance", "puc", "transfer", "invoice", "other"],
                required: true
            },
            name: { type: String, required: true },
            ipfsHash: { type: String },
            fileUrl: { type: String }, // For direct file storage
            mimeType: { type: String },
            fileSize: { type: Number },
            // Verification status
            verificationStatus: {
                type: String,
                enum: ["pending", "verified", "rejected"],
                default: "pending"
            },
            verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            verifiedAt: { type: Date },
            verificationRemarks: { type: String },
            // Digital signature
            digitalSignature: {
                signature: { type: String },
                signedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
                signedAt: { type: Date },
                certificateId: { type: String }
            },
            // Expiry tracking
            expiryDate: { type: Date },
            reminderSent: { type: Boolean, default: false },
            // Metadata
            uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
            uploadedAt: { type: Date, default: Date.now }
        }],
        // IPFS hash of complete vehicle record
        ipfsRecordHash: { type: String }
    },
    { timestamps: true }
);

// The owner dashboard reads by holder, and every search/filter screen reads by
// lifecycle status, so both need an index once the table grows past a demo size.
vehicleSchema.index({ currentOwner: 1 });
vehicleSchema.index({ status: 1 });

export const Vehicle = mongoose.model("Vehicle", vehicleSchema);
