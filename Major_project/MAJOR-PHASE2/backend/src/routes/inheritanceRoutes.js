import express from "express";
import multer from "multer";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { InheritanceTransfer } from "../models/InheritanceTransfer.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { OwnershipHistory } from "../models/OwnershipHistory.js";
import {
    registerVehicleOnChain,
    transferVehicleOnChain,
    getCurrentOwnerFromChain
} from "../services/blockchainService.js";
import {
    uploadToIPFS,
    getFromIPFS,
    isVaultReference,
    resolveVaultFile
} from "../services/ipfsService.js";
import { maskUserAadhaar } from "../utils/masking.js";

const router = express.Router();

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Submit inheritance transfer request
router.post("/request", authRequired, upload.fields([
    { name: 'deathCertificate', maxCount: 1 },
    { name: 'successionCertificate', maxCount: 1 },
    { name: 'courtOrder', maxCount: 1 },
    { name: 'relationshipProof', maxCount: 1 }
]), async (req, res) => {
    try {
        const vehicleRegNumber = req.body.vehicleRegNumber || req.body.vehicleId;
        const deceasedOwnerName = req.body.deceasedOwnerId; // This is actually the name now
        const deathCertificateNumber = req.body.deathCertificateNumber;
        const relationshipToDeceased = req.body.relationshipToDeceased;
        const successionCertificateNumber = req.body.successionCertificateNumber;
        const courtOrderNumber = req.body.courtOrderNumber;

        if (!vehicleRegNumber) {
            return res.status(400).json({ message: "Vehicle registration number is required" });
        }
        if (!deceasedOwnerName) {
            return res.status(400).json({ message: "Deceased owner name is required" });
        }
        if (!deathCertificateNumber) {
            return res.status(400).json({ message: "Death certificate number is required" });
        }
        if (!relationshipToDeceased) {
            return res.status(400).json({ message: "Relationship is required" });
        }

        // Verify the vehicle exists using registration number
        const vehicle = await Vehicle.findOne({ regNumber: vehicleRegNumber });
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found with this registration number" });
        }

        // Get the current owner details from the vehicle record
        const currentOwnerId = vehicle.currentOwner;
        if (!currentOwnerId) {
            return res.status(400).json({ message: "Vehicle has no registered owner" });
        }

        // Verify current owner exists (this is the deceased owner)
        const deceasedOwner = await User.findById(currentOwnerId);
        if (!deceasedOwner) {
            return res.status(404).json({ message: "Vehicle owner not found in system" });
        }

        // Note: We're not strictly validating the name match here since user might enter slightly different format
        // The RTO officer will verify during approval

        // Check if there's already an active inheritance request for this vehicle
        const existingRequest = await InheritanceTransfer.findOne({
            vehicle: vehicle._id,
            status: { $in: ["submitted", "documents_verified", "rto_review"] }
        });
        if (existingRequest) {
            return res.status(400).json({ message: "Inheritance transfer already in process for this vehicle" });
        }

        // Store every document the heir uploaded. Before this, the bytes were read
        // into memory and then thrown away while the record kept a made-up path,
        // so the RTO officer was "verifying documents" he could never open.
        const fileMapping = {
            deathCertificate: 'death_certificate',
            successionCertificate: 'succession_certificate',
            courtOrder: 'court_order',
            relationshipProof: 'identity_proof' // Using identity_proof for relationship proof
        };

        const documents = [];
        for (const [fieldName, documentType] of Object.entries(fileMapping)) {
            const uploaded = req.files?.[fieldName]?.[0];
            if (!uploaded) continue;
            const reference = await uploadToIPFS(uploaded.buffer, uploaded.originalname, {
                uploadedBy: req.user.id,
                mimeType: uploaded.mimetype,
                documentType,
                vehicleRegNumber,
            });
            documents.push({
                documentType,
                documentUrl: reference,
                verified: false
            });
        }

        if (!documents.some((d) => d.documentType === "death_certificate")) {
            return res.status(400).json({
                message: "A death certificate must be attached - the claim cannot be verified without it."
            });
        }

        const inheritanceRequest = new InheritanceTransfer({
            vehicle: vehicle._id,
            deceasedOwner: currentOwnerId, // Use the actual owner ID from vehicle record
            legalHeir: req.user.id,
            deathCertificateNumber,
            relationshipToDeceased,
            successionCertificateNumber,
            courtOrderNumber,
            documents: documents
        });

        await inheritanceRequest.save();

        res.status(201).json({
            message: "Inheritance transfer request submitted successfully",
            requestId: inheritanceRequest._id,
            documentsStored: documents.length,
            // The heir keeps the same receipts the officer sees.
            documents: documents.map((d, index) => ({
                documentType: d.documentType,
                storedAs: d.documentUrl,
                downloadPath: `/inheritance/requests/${inheritanceRequest._id}/documents/${index}`
            }))
        });
    } catch (err) {
        console.error("inheritance request error:", err.message);
        res.status(500).json({ message: "Server error: " + err.message });
    }
});

// Get inheritance requests (legal heir/RTO/police)
router.get("/requests", authRequired, async (req, res) => {
    try {
        let query = {};

        // Legal heirs can only see their own requests
        if (req.user.role === "owner") {
            query.legalHeir = req.user.id;
        }
        // RTO can see all requests
        else if (req.user.role === "rto") {
            // No additional filtering needed
        }
        // Police can see all requests
        else if (req.user.role === "police") {
            // No additional filtering needed
        } else {
            return res.status(403).json({ message: "Unauthorized access" });
        }

        const requests = await InheritanceTransfer.find(query)
            .populate("vehicle", "regNumber make model year chassisNumber")
            .populate("deceasedOwner", "name email aadhaarNumber dlNumber")
            .populate("legalHeir", "name email aadhaarNumber dlNumber")
            .populate("rtoOfficer", "name")
            .sort({ createdAt: -1 });

        // A deceased person's identity number is not anyone's business to read in
        // full, and the heir's own number is only shown back to the heir.
        requests.forEach((request) => {
            maskUserAadhaar(request.deceasedOwner);
            if (String(request.legalHeir?._id || request.legalHeir) !== String(req.user.id)) {
                maskUserAadhaar(request.legalHeir);
            }
        });

        res.json(requests);
    } catch (err) {
        console.error("get inheritance requests error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Open one document attached to an inheritance claim.
// GET /api/inheritance/requests/:id/documents/:index
// Only the heir who filed it, an RTO officer and the police can read it. The
// bytes come back through the same content check as every other stored
// document, so a file edited on disk is refused instead of served.
router.get("/requests/:id/documents/:index", authRequired, async (req, res) => {
    try {
        const request = await InheritanceTransfer.findById(req.params.id);
        if (!request) {
            return res.status(404).json({ message: "Inheritance request not found" });
        }

        const isHeir = String(request.legalHeir) === String(req.user.id);
        const isOfficer = req.user.role === "rto" || req.user.role === "police";
        if (!isHeir && !isOfficer) {
            return res.status(403).json({ message: "Not authorized to view this document" });
        }

        const index = Number(req.params.index);
        const doc = request.documents?.[index];
        if (!doc || !doc.documentUrl) {
            return res.status(404).json({
                message: "No document is stored at that position in this request"
            });
        }

        const meta = isVaultReference(doc.documentUrl)
            ? await resolveVaultFile(doc.documentUrl)
            : null;
        if (isVaultReference(doc.documentUrl) && !meta) {
            return res.status(404).json({
                message: "The stored file is no longer present - it was uploaded elsewhere or its bytes were removed."
            });
        }

        let buffer;
        try {
            buffer = await getFromIPFS(doc.documentUrl);
        } catch (readErr) {
            const altered = /match/i.test(readErr.message);
            return res.status(altered ? 409 : 502).json({
                message: altered
                    ? "The stored bytes no longer match their recorded hash. This document has been altered - treat it as untrusted."
                    : "The document could not be retrieved from storage."
            });
        }

        res.setHeader("Content-Type", meta?.mimeType || "application/octet-stream");
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Content-Disposition", `inline; filename="${(meta?.fileName || doc.documentType).replace(/[^\w.\- ]/g, "_")}"`);
        res.send(buffer);
    } catch (err) {
        console.error("inheritance document read error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify documents (RTO)
router.put("/requests/:id/verify-documents", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { documentVerifications, remarks } = req.body;

        const request = await InheritanceTransfer.findById(id);
        if (!request) {
            return res.status(404).json({ message: "Inheritance request not found" });
        }

        if (request.status !== "submitted") {
            return res.status(400).json({ message: "Request is not in submitted status" });
        }

        // Update document verification status. When the officer attests without
        // naming individual files, every document on the claim is marked - a
        // half-checked list must not be recorded as a completed verification.
        if (documentVerifications && documentVerifications.length) {
            request.documents = request.documents.map(doc => {
                const verification = documentVerifications.find(v => v.documentType === doc.documentType);
                if (verification) {
                    doc.verified = verification.verified;
                }
                return doc;
            });
        } else {
            request.documents.forEach(doc => { doc.verified = true; });
        }

        request.status = "documents_verified";
        request.rtoOfficer = req.user.id;
        if (remarks) request.remarks = remarks;

        await request.save();

        res.json({ message: "Documents verified successfully", request });
    } catch (err) {
        console.error("document verification error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Approve inheritance transfer (RTO)
router.put("/requests/:id/approve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { regNumber } = req.body;

        const request = await InheritanceTransfer.findById(id)
            .populate("vehicle")
            .populate("deceasedOwner")
            .populate("legalHeir");

        if (!request) {
            return res.status(404).json({ message: "Inheritance request not found" });
        }

        if (request.status !== "documents_verified") {
            return res.status(400).json({ message: "Documents must be verified first" });
        }

        // Update vehicle ownership
        const vehicle = await Vehicle.findById(request.vehicle._id);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Generate blockchain transaction
        let txHash;
        if (vehicle.regNumber) {
            // Get user's blockchain wallet addresses
            const deceasedUser = await User.findById(request.deceasedOwner._id);
            const heirUser = await User.findById(request.legalHeir._id);
            // A wallet placeholder built from an id is not a valid address and the network
            // rejects it, so an heir without one gets the database transfer only.
            const deceasedAddress = deceasedUser?.blockchainWalletAddress || null;
            const heirAddress = heirUser?.blockchainWalletAddress || null;

            if (!heirAddress) {
                console.warn(`Not anchoring the inheritance transfer of ${vehicle.regNumber}: ${heirUser?.name || "the legal heir"} has no wallet address linked to the account yet.`);
            }

            try {
                // First, try to transfer (vehicle should already be registered)
                txHash = heirAddress
                    ? await transferVehicleOnChain(vehicle.regNumber, deceasedAddress, heirAddress, "inheritance", "0x0000000000000000000000000000000000000000000000000000000000000000")
                    : null;
            } catch (transferError) {
                // If transfer fails because vehicle is not registered, register it first
                if (transferError.message.includes("Vehicle not registered")) {
                    // Register the vehicle directly in the legal heir's name for inheritance
                    txHash = await registerVehicleOnChain(
                        vehicle.regNumber,
                        vehicle.chassisNumber || "N/A",
                        vehicle.engineNumber || "N/A",
                        vehicle.make || "Unknown",
                        vehicle.model || "Unknown",
                        parseInt(vehicle.year) || new Date().getFullYear(),
                        heirAddress // Register directly to heir for inheritance
                    );
                } else if (transferError.message.includes("Only owner can transfer")) {
                    // Vehicle exists on chain but is owned by deceased
                    // For inheritance, we need RTO to have special access
                    // For now, update database and log that manual blockchain transfer needed
                    console.warn(`Chain still lists ${vehicle.regNumber} under the deceased owner; recording the inheritance in the database and leaving the on-chain signature as a manual step`);

                    // Update database ownership even though blockchain failed
                    vehicle.currentOwner = request.legalHeir._id;
                    await vehicle.save();

                    // Create ownership history record
                    await OwnershipHistory.create({
                        vehicle: vehicle._id,
                        fromOwner: request.deceasedOwner._id,
                        toOwner: request.legalHeir._id,
                        blockchainTxHash: null, // No blockchain transaction yet
                        transferType: "inheritance",
                        biometricVerification: null
                    });

                    // Update request status
                    request.status = "approved";
                    request.rtoOfficer = req.user.id;
                    await request.save();

                    return res.json({
                        message: "Inheritance transfer approved (database updated). Blockchain transfer requires deceased owner's wallet signature.",
                        warning: "Vehicle registered to deceased owner on blockchain. Manual transfer required."
                    });
                } else {
                    throw transferError; // Re-throw if it's a different error
                }
            }
        } else {
            if (!regNumber) {
                return res.status(400).json({ message: "Registration number required for new registration" });
            }
            vehicle.regNumber = regNumber;

            // Record what the printed certificate will assert about this issue.
            const issuingOfficer = await User.findById(req.user.id).select("name employeeId rtoDetails");
            vehicle.registrationDate = new Date();
            vehicle.issuedByOffice = issuingOfficer?.rtoDetails?.rtoOfficeName || null;
            vehicle.issuedByOfficer = issuingOfficer
                ? `${issuingOfficer.name}${issuingOfficer.employeeId ? ` (${issuingOfficer.employeeId})` : ""}`
                : null;

            // Get user's blockchain wallet address
            const heirUser = await User.findById(request.legalHeir._id);
            const ownerAddress = heirUser?.blockchainWalletAddress || null;

            if (!ownerAddress) {
                console.warn(`Not anchoring the inheritance registration of ${vehicle.regNumber}: ${heirUser?.name || "the legal heir"} has no wallet address linked to the account yet.`);
            } else {
                txHash = await registerVehicleOnChain(
                    vehicle.regNumber,
                    vehicle.chassisNumber,
                    vehicle.engineNumber,
                    vehicle.make,
                    vehicle.model,
                    vehicle.year,
                    ownerAddress
                );
            }
        }

        vehicle.currentOwner = request.legalHeir._id;
        // Handing the certificate to the heir is an officer decision, and the RC
        // printed afterwards should name the officer and office that took it.
        if (!vehicle.issuedByOfficer) {
            const heirOfficer = await User.findById(req.user.id).select("name employeeId rtoDetails");
            vehicle.issuedByOffice = heirOfficer?.rtoDetails?.rtoOfficeName || vehicle.issuedByOffice || null;
            vehicle.issuedByOfficer = heirOfficer
                ? `${heirOfficer.name}${heirOfficer.employeeId ? ` (${heirOfficer.employeeId})` : ""}`
                : null;
        }
        await vehicle.save();

        // Create ownership history record
        await OwnershipHistory.create({
            vehicle: vehicle._id,
            fromOwner: request.deceasedOwner._id,
            toOwner: request.legalHeir._id,
            blockchainTxHash: txHash,
            transferType: "inheritance",
            biometricVerification: req.biometricVerification || null
        });

        // Update request status
        request.status = "approved";
        request.rtoOfficer = req.user.id;
        await request.save();

        res.json({
            message: "Inheritance transfer approved successfully",
            txHash,
            newOwnerId: request.legalHeir._id
        });
    } catch (err) {
        console.error("inheritance approval error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Reject inheritance transfer (RTO)
router.put("/requests/:id/reject", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        const request = await InheritanceTransfer.findById(id);
        if (!request) {
            return res.status(404).json({ message: "Inheritance request not found" });
        }

        request.status = "rejected";
        request.rtoOfficer = req.user.id;
        if (remarks) request.remarks = remarks;

        await request.save();

        res.json({ message: "Inheritance transfer rejected", request });
    } catch (err) {
        console.error("inheritance rejection error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;