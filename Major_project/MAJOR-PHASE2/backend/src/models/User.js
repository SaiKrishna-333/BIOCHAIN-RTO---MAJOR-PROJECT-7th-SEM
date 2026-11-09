import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
    {
        name: { type: String, required: true },
        email: { type: String, unique: true, required: true },
        passwordHash: { type: String, required: true },
        role: {
            type: String,
            enum: ["dealer", "owner", "rto", "police", "admin", "workshop"],
            required: true
        },
        phone: { type: String },
        address: { type: String },
        state: { type: String }, // User's state (KA, TN, AP, etc.) - for RTO routing
        district: { type: String }, // User's district
        aadhaarNumber: { type: String, unique: true, sparse: true },
        dlNumber: { type: String, unique: true, sparse: true },
        fingerprintTemplateId: { type: String },
        biometricData: { // Store additional biometric information
            fingerprint: { type: String }, // Encrypted fingerprint template
            iris: { type: String }, // Iris scan data
            face: { type: String }, // Face recognition template
            lastEnrolled: { type: Date }
        },
        blockchainWalletAddress: { type: String }, // User's blockchain wallet address
        // KYC provenance: which government document backed this signup, and
        // whether its fields were auto-extracted via OCR at registration time
        kyc: {
            documentType: { type: String }, // aadhaar | driving-licence | voter-id | pan | id-document
            extractedViaOcr: { type: Boolean, default: false },
            verifiedAt: { type: Date }
        },
        verificationStatus: {
            type: String,
            enum: ["unverified", "pending", "verified", "rejected"],
            default: "unverified"
        },
        profilePhoto: {
            data: Buffer, // Store image as binary data
            contentType: String // Store MIME type (image/jpeg, image/png, etc.)
        },
        // Police-specific fields
        badgeNumber: { type: String }, // Police badge/ID number
        // Dealer-specific fields
        dealerDetails: {
            businessName: { type: String },
            gstin: { type: String },
            tin: { type: String },
            showroomAddress: { type: String },
            invoicePrefix: { type: String, default: "INV" },
            phone: { type: String },
            licenseNumber: { type: String }
        },
        // Workshop-specific fields (authorized service centres tied to a vehicle company)
        workshopDetails: {
            companyName: { type: String }, // Operating shop/company name, e.g. "Sai Automobiles"
            affiliatedManufacturer: { type: String }, // Vehicle company they belong to, e.g. "Maruti Suzuki"
            gstin: { type: String },
            licenseNumber: { type: String }, // Service centre authorization number
            address: { type: String },
            phone: { type: String },
            verified: { type: Boolean, default: false } // Set by admin/RTO once credentials checked
        },
        // RTO-specific fields
        rtoDetails: {
            stateCode: { type: String }, // e.g., "KA", "TS", "AP"
            stateName: { type: String }, // e.g., "Karnataka"
            district: { type: String },
            rtoOfficeCode: { type: String }, // e.g., "KA-01", "TS-07"
            rtoOfficeName: { type: String }, // e.g., "Bangalore Central RTO"
            designation: { type: String }, // e.g., "RTO Officer", "Assistant RTO"
            employeeId: { type: String, unique: true, sparse: true },
            officeAddress: { type: String },
            jurisdiction: { type: String }
        },
        // Decentralized Identifier (DID)
        did: {
            identifier: { type: String, unique: true, sparse: true },
            biochainDid: { type: String, unique: true, sparse: true },
            document: { type: Object }, // Full DID document
            createdAt: { type: Date }
        },
        // DID credentials
        credentials: [{
            type: { type: String, enum: ["ownership", "transfer_auth", "rto_auth", "police_auth"] },
            credentialId: { type: String },
            issuedAt: { type: Date },
            expiresAt: { type: Date },
            data: { type: Object }
        }]
    },
    { timestamps: true }
);

// Indexes for efficient queries
userSchema.index({ role: 1 });
userSchema.index({ badgeNumber: 1 }); // For police badge lookups

// aadhaarNumber, dlNumber, rtoDetails.employeeId and did.identifier all carry a
// unique sparse index. To MongoDB an empty string is a value, so two accounts that
// left an optional field blank would collide on "" and the second save would fail
// with a duplicate-key error. Blank therefore means "not supplied" and is stored
// as an absent field, which the sparse index ignores.
const blankToUnset = (value) => {
    const text = String(value ?? "").trim();
    return text === "" || value === undefined || value === null ? undefined : text;
};

userSchema.pre("save", function unsetBlankUniqueFields() {
    for (const field of ["aadhaarNumber", "dlNumber"]) {
        this[field] = blankToUnset(this[field]);
    }
    if (this.rtoDetails) {
        this.rtoDetails.employeeId = blankToUnset(this.rtoDetails.employeeId);
    }
    if (this.did) {
        this.did.identifier = blankToUnset(this.did.identifier);
        this.did.biochainDid = blankToUnset(this.did.biochainDid);
    }
});

export const User = mongoose.model("User", userSchema);
