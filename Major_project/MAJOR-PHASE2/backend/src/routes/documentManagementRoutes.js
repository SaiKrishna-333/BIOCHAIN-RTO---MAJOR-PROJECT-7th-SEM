import express from "express";
import crypto from "crypto";
import fs from "fs";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import {
    resolveVaultFile,
    getFromIPFS,
    isVaultReference,
    VAULT_PREFIX,
} from "../services/ipfsService.js";

const router = express.Router();

// The same people may see a document's metadata and its bytes: the vehicle's
// owner, RTO/police, and whoever uploaded that particular document.
const mayViewVehicleDocuments = (vehicle, user, document) =>
    String(vehicle.currentOwner) === String(user.id) ||
    (document ? String(document.uploadedBy) === String(user.id) : false) ||
    user.role === "rto" ||
    user.role === "police";

// Get all documents for a vehicle with full metadata
router.get("/vehicle/:vehicleId", authRequired, async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const vehicle = await Vehicle.findById(vehicleId)
            .populate("documents.verifiedBy", "name email")
            .populate("documents.digitalSignature.signedBy", "name email")
            .populate("documents.uploadedBy", "name email")
            .populate("currentOwner", "name email");

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Check permissions
        const isOwner = String(vehicle.currentOwner?._id || vehicle.currentOwner) === String(req.user.id);
        const isAdmin = req.user.role === "rto" || req.user.role === "police";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: "Not authorized to view these documents" });
        }

        // Process documents and add expiry status
        const documents = vehicle.documents.map(doc => {
            const docObj = doc.toObject();

            // Calculate expiry status
            if (doc.expiryDate) {
                const now = new Date();
                const expiry = new Date(doc.expiryDate);
                const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                docObj.expiryStatus = daysUntilExpiry < 0 ? "expired" :
                    daysUntilExpiry <= 30 ? "expiring-soon" :
                        "valid";
                docObj.daysUntilExpiry = daysUntilExpiry;
            }

            return docObj;
        });

        res.json({
            vehicleId: vehicle._id,
            regNumber: vehicle.regNumber,
            owner: vehicle.currentOwner,
            documents
        });
    } catch (err) {
        console.error("Get vehicle documents error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Upload a new document
router.post("/upload/:vehicleId", authRequired, async (req, res) => {
    try {
        const { vehicleId } = req.params;
        const { type, name, ipfsHash, fileUrl, mimeType, fileSize, expiryDate } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Check permissions
        const isOwner = String(vehicle.currentOwner) === String(req.user.id);
        const isDealer = req.user.role === "dealer";
        const isAdmin = req.user.role === "rto";

        if (!isOwner && !isDealer && !isAdmin) {
            return res.status(403).json({ message: "Not authorized to upload documents" });
        }

        // Create new document entry
        const newDocument = {
            type,
            name,
            ipfsHash,
            fileUrl,
            mimeType,
            fileSize,
            expiryDate: expiryDate ? new Date(expiryDate) : null,
            verificationStatus: isAdmin ? "verified" : "pending",
            uploadedBy: req.user.id,
            uploadedAt: new Date()
        };

        vehicle.documents.push(newDocument);
        await vehicle.save();

        res.json({
            message: "Document uploaded successfully",
            // Return the stored subdocument: it carries the id Mongoose generated,
            // which the caller needs to verify, sign or preview this exact record.
            document: vehicle.documents[vehicle.documents.length - 1],
        });
    } catch (err) {
        console.error("Upload document error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify a document (RTO only)
router.put("/verify/:vehicleId/:documentId", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { vehicleId, documentId } = req.params;
        const { status, remarks } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const document = vehicle.documents.id(documentId);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        document.verificationStatus = status;
        document.verifiedBy = req.user.id;
        document.verifiedAt = new Date();
        document.verificationRemarks = remarks || "";

        await vehicle.save();

        res.json({
            message: `Document ${status} successfully`,
            document
        });
    } catch (err) {
        console.error("Verify document error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Add digital signature to a document
router.post("/sign/:vehicleId/:documentId", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { vehicleId, documentId } = req.params;
        const { certificateId } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const document = vehicle.documents.id(documentId);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        // Verification seal: a SHA-256 over the officer, the vehicle and the
        // document's own content reference. It is deterministic, so the same seal
        // can be recomputed and a changed document produces a different value. It
        // is not an asymmetric signature - the app holds no signing key.
        const signatureData = [
            vehicleId,
            documentId,
            req.user.id,
            document.ipfsHash || document.fileUrl || ""
        ].join(":");
        const signature = crypto.createHash("sha256").update(signatureData).digest("hex");

        document.digitalSignature = {
            signature,
            signedBy: req.user.id,
            signedAt: new Date(),
            certificateId: certificateId || `SEAL-${documentId}`
        };

        // Auto-verify when signed
        document.verificationStatus = "verified";
        document.verifiedBy = req.user.id;
        document.verifiedAt = new Date();

        await vehicle.save();

        res.json({
            message: "Document signed successfully",
            signature,
            document
        });
    } catch (err) {
        console.error("Sign document error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Delete a document
router.delete("/:vehicleId/:documentId", authRequired, async (req, res) => {
    try {
        const { vehicleId, documentId } = req.params;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const document = vehicle.documents.id(documentId);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        // Check permissions
        const isOwner = String(vehicle.currentOwner) === String(req.user.id);
        const isUploader = String(document.uploadedBy) === String(req.user.id);
        const isAdmin = req.user.role === "rto";

        if (!isOwner && !isUploader && !isAdmin) {
            return res.status(403).json({ message: "Not authorized to delete this document" });
        }

        vehicle.documents.pull(documentId);
        await vehicle.save();

        res.json({ message: "Document deleted successfully" });
    } catch (err) {
        console.error("Delete document error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get documents with expiry alerts for a user
router.get("/expiry-alerts", authRequired, async (req, res) => {
    try {
        const vehicles = await Vehicle.find({ currentOwner: req.user.id });
        const vehicleIds = vehicles.map(v => v._id);

        const alerts = [];
        const now = new Date();
        const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

        for (const vehicle of vehicles) {
            for (const doc of vehicle.documents) {
                if (doc.expiryDate && !doc.reminderSent) {
                    const expiry = new Date(doc.expiryDate);

                    if (expiry <= thirtyDaysFromNow) {
                        const daysUntilExpiry = Math.ceil((expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

                        alerts.push({
                            vehicleId: vehicle._id,
                            regNumber: vehicle.regNumber,
                            documentId: doc._id,
                            documentType: doc.type,
                            documentName: doc.name,
                            expiryDate: doc.expiryDate,
                            daysUntilExpiry,
                            status: daysUntilExpiry < 0 ? "expired" : "expiring-soon"
                        });
                    }
                }
            }
        }

        // Sort by days until expiry (most urgent first)
        alerts.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);

        res.json(alerts);
    } catch (err) {
        console.error("Get expiry alerts error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Mark reminder as sent
router.put("/mark-reminder/:vehicleId/:documentId", authRequired, async (req, res) => {
    try {
        const { vehicleId, documentId } = req.params;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const document = vehicle.documents.id(documentId);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        document.reminderSent = true;
        await vehicle.save();

        res.json({ message: "Reminder marked as sent" });
    } catch (err) {
        console.error("Mark reminder error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get document preview URL
router.get("/preview/:vehicleId/:documentId", authRequired, async (req, res) => {
    try {
        const { vehicleId, documentId } = req.params;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const document = vehicle.documents.id(documentId);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }

        // Check permissions
        const isOwner = String(vehicle.currentOwner) === String(req.user.id);
        const isAdmin = req.user.role === "rto" || req.user.role === "police";

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: "Not authorized to view this document" });
        }

        // Return document metadata for preview
        res.json({
            documentId: document._id,
            name: document.name,
            type: document.type,
            mimeType: document.mimeType,
            fileUrl: document.fileUrl,
            ipfsHash: document.ipfsHash,
            // Which medium holds the bytes: a sha256: reference is this server's
            // verified store, anything else is a real IPFS CID.
            storage: isVaultReference(document.ipfsHash) ? "local-verified-store" : (document.ipfsHash ? "ipfs" : null),
            contentAvailable: !!document.ipfsHash || !!document.fileUrl,
            verificationStatus: document.verificationStatus,
            hasSignature: !!document.digitalSignature?.signature,
            uploadedAt: document.uploadedAt
        });
    } catch (err) {
        console.error("Get document preview error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Serve the document's own bytes, so the preview never depends on a public
// gateway that cannot know this server's access rules.
// GET /api/documents-mgmt/content/:vehicleId/:documentId
router.get("/content/:vehicleId/:documentId", authRequired, async (req, res) => {
    try {
        const { vehicleId, documentId } = req.params;

        const vehicle = await Vehicle.findById(vehicleId).select("currentOwner documents");
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }
        const document = vehicle.documents.id(documentId);
        if (!document) {
            return res.status(404).json({ message: "Document not found" });
        }
        if (!mayViewVehicleDocuments(vehicle, req.user, document)) {
            return res.status(403).json({ message: "Not authorized to view this document" });
        }
        if (!document.ipfsHash) {
            return res.status(404).json({ message: "No stored content for this document - only its metadata was recorded." });
        }

        let buffer;
        if (isVaultReference(document.ipfsHash)) {
            const entry = await resolveVaultFile(document.ipfsHash);
            if (!entry) {
                return res.status(410).json({ message: "The stored bytes are no longer on this server." });
            }
            buffer = await fs.promises.readFile(entry.filePath);
            const digest = document.ipfsHash.slice(VAULT_PREFIX.length);
            if (crypto.createHash("sha256").update(buffer).digest("hex") !== digest) {
                return res.status(409).json({
                    message: "The stored bytes no longer match their recorded hash. This document has been altered - treat it as untrusted.",
                });
            }
            res.setHeader("X-Content-Sha256", digest);
        } else {
            // A genuine CID: fetch it through the service, which knows the gateway.
            buffer = await getFromIPFS(document.ipfsHash);
        }

        res.setHeader("Content-Type", document.mimeType || "application/octet-stream");
        res.setHeader("Content-Length", buffer.length);
        res.setHeader("Content-Disposition", `inline; filename="${String(document.name || documentId).replace(/[^\w.\- ]/g, "_")}"`);
        res.send(buffer);
    } catch (err) {
        console.error("Get document content error:", err.message);
        res.status(502).json({ message: `The stored content could not be retrieved: ${err.message}` });
    }
});

export default router;
