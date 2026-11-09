import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { User } from "../models/User.js";
import {
    resolveDID,
    isValidDID,
    getRoleFromDID,
    verifyCredential,
    generateDeceasedOwnerDID
} from "../services/didService.js";

const router = express.Router();

// Resolve a DID to its document
router.get("/resolve/:did", async (req, res) => {
    try {
        const { did } = req.params;

        if (!isValidDID(did)) {
            return res.status(400).json({ message: "Invalid DID format" });
        }

        const didDocument = resolveDID(did);

        res.json({
            did,
            didDocument,
            resolvedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("DID resolution error:", err.message);
        res.status(404).json({ message: "DID not found or could not be resolved" });
    }
});

// Get current user's DID
router.get("/my-did", authRequired, async (req, res) => {
    try {
        const user = await User.findById(req.user.id);

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (!user.did || !user.did.identifier) {
            return res.status(404).json({ message: "DID not found for this user" });
        }

        res.json({
            did: user.did.identifier,
            biochainDid: user.did.biochainDid,
            document: user.did.document,
            createdAt: user.did.createdAt,
            blockchainAddress: user.blockchainWalletAddress
        });
    } catch (err) {
        console.error("Get DID error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify a credential
router.post("/verify-credential", authRequired, async (req, res) => {
    try {
        const { credential } = req.body;

        if (!credential || !credential.proof) {
            return res.status(400).json({ message: "Invalid credential format" });
        }

        const isValid = await verifyCredential(credential);

        res.json({
            valid: isValid,
            credentialId: credential.id,
            issuer: credential.issuer,
            verifiedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("Credential verification error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get user by DID (for RTO/Police)
router.get("/user/:did", authRequired, requireRole("rto", "police"), async (req, res) => {
    try {
        const { did } = req.params;

        if (!isValidDID(did)) {
            return res.status(400).json({ message: "Invalid DID format" });
        }

        const user = await User.findOne({ "did.identifier": did });

        if (!user) {
            return res.status(404).json({ message: "User not found for this DID" });
        }

        res.json({
            id: user._id,
            name: user.name,
            email: user.email,
            role: user.role,
            did: user.did?.identifier,
            biochainDid: user.did?.biochainDid,
            aadhaarNumber: user.aadhaarNumber,
            dlNumber: user.dlNumber,
            verificationStatus: user.verificationStatus
        });
    } catch (err) {
        console.error("Get user by DID error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Generate deceased owner DID (for inheritance transfers)
router.post("/deceased", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { originalOwnerId, deathCertificateNumber } = req.body;

        if (!originalOwnerId || !deathCertificateNumber) {
            return res.status(400).json({
                message: "Original owner ID and death certificate number required"
            });
        }

        const deceasedDID = generateDeceasedOwnerDID(originalOwnerId, deathCertificateNumber);

        res.json({
            deceasedDID,
            generatedAt: new Date().toISOString()
        });
    } catch (err) {
        console.error("Generate deceased DID error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Validate DID format
router.post("/validate", async (req, res) => {
    try {
        const { did } = req.body;

        const isValid = isValidDID(did);
        const role = getRoleFromDID(did);

        res.json({
            did,
            valid: isValid,
            role,
            method: did?.split(":")[1] || null
        });
    } catch (err) {
        console.error("DID validation error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
