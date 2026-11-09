import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Request } from "../models/Request.js";
import {
    createInterStateTransfer,
    approveInterStateTransfer,
    generateVehiclePassport,
    extractStateFromRegNumber,
    STATE_RTO_CODES
} from "../services/crossStateInteroperability.js";
import { registerVehicleTransferOnChain } from "../services/blockchainService.js";

const router = express.Router();

// Create inter-state transfer request (by vehicle owner)
router.post("/create", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const { vehicleId, targetState, newAddress } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Verify user owns the vehicle
        if (String(vehicle.currentOwner) !== req.user.id) {
            return res.status(403).json({ message: "Not authorized to transfer this vehicle" });
        }

        // Check for pending challans or dues
        if (vehicle.status === "blocked" || vehicle.status === "stolen") {
            return res.status(400).json({
                message: "Vehicle cannot be transferred - Status: " + vehicle.status
            });
        }

        const currentState = extractStateFromRegNumber(vehicle.regNumber);
        if (currentState === targetState) {
            return res.status(400).json({
                message: "Vehicle is already registered in this state"
            });
        }

        // Generate vehicle passport
        const passportResult = await generateVehiclePassport(vehicleId);
        if (passportResult.error) {
            return res.status(500).json({ message: passportResult.error });
        }

        // Create transfer request
        const transferRequest = new Request({
            type: "interStateTransfer",
            vehicle: vehicleId,
            seller: req.user.id,
            status: "pending",
            interStateDetails: {
                currentState,
                targetState,
                newAddress,
                currentRegNumber: vehicle.regNumber,
                vehiclePassport: passportResult.passport,
                passportHash: passportResult.passportHash,
                sourceRTOApproval: { status: "pending", officerId: null, timestamp: null, remarks: "" },
                destinationRTOApproval: { status: "pending", officerId: null, timestamp: null, remarks: "" },
                newRegNumber: null,
                transferInitiatedAt: new Date()
            }
        });

        await transferRequest.save();

        res.status(201).json({
            message: "Inter-state transfer request created successfully",
            transferRequest
        });
    } catch (err) {
        console.error("Create inter-state transfer error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Generate vehicle passport for inter-state transfer (owner initiated)
router.post("/generate-passport", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const { vehicleId, fromState, toState, newAddress } = req.body;

        if (!vehicleId || !fromState || !toState || !newAddress) {
            return res.status(400).json({ message: "All fields are required" });
        }

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Verify ownership
        if (String(vehicle.currentOwner) !== req.user.id) {
            return res.status(403).json({ message: "You don't own this vehicle" });
        }

        // Check for pending challans
        if (vehicle.status === "blocked") {
            return res.status(400).json({ message: "Vehicle has pending challans. Clear them first." });
        }

        // Generate vehicle passport using crossStateInteroperability service
        const passportResult = await generateVehiclePassport(vehicleId);

        if (passportResult.error) {
            return res.status(500).json({ message: passportResult.error });
        }

        // Add transfer details to passport
        const passportWithTransfer = {
            ...passportResult.passport,
            interStateTransfer: {
                fromState,
                toState,
                newAddress,
                requestedAt: new Date().toISOString(),
                validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days
                status: "pending_approval"
            }
        };

        res.json({
            passportId: passportResult.passport.passportId,
            passport: passportWithTransfer,
            passportHash: passportResult.passportHash,
            message: "Vehicle passport generated successfully"
        });
    } catch (err) {
        console.error("Generate passport error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get all inter-state transfer requests (for RTO dashboard)
router.get("/requests", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const stateCode = user.rtoDetails?.stateCode;

        if (!stateCode) {
            return res.status(400).json({ message: "RTO state not configured. Please update your RTO details first." });
        }

        // Find requests where this state is either source or destination
        const requests = await Request.find({
            type: "interStateTransfer",
            $or: [
                { "interStateDetails.currentState": stateCode },
                { "interStateDetails.targetState": stateCode }
            ]
        })
            .populate("vehicle", "regNumber make model year chassisNumber engineNumber status blockchainTxHash")
            .populate("seller", "name email phone address")
            .sort({ createdAt: -1 });

        res.json(requests);
    } catch (err) {
        console.error("Get inter-state requests error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get owner's inter-state transfer requests
router.get("/my-requests", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const requests = await Request.find({
            type: "interStateTransfer",
            seller: req.user.id
        })
            .populate("vehicle", "regNumber make model year status")
            .sort({ createdAt: -1 });

        res.json(requests);
    } catch (err) {
        console.error("Get owner inter-state requests error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Source RTO approves NOC (No Objection Certificate)
router.post("/:id/source-rto-approve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        const user = await User.findById(req.user.id);
        const request = await Request.findById(id).populate("vehicle");

        if (!request || request.type !== "interStateTransfer") {
            return res.status(404).json({ message: "Transfer request not found" });
        }

        // Verify this RTO belongs to the source state
        if (user.rtoDetails?.stateCode !== request.interStateDetails.currentState) {
            return res.status(403).json({ message: "Only source state RTO can approve NOC" });
        }

        // Update approval
        request.interStateDetails.sourceRTOApproval = {
            status: "approved",
            officerId: req.user.id,
            officerName: user.name,
            rtoOffice: user.rtoDetails.rtoOfficeName,
            timestamp: new Date(),
            remarks: remarks || "NOC approved"
        };

        request.status = "source_rto_approved";
        await request.save();

        res.json({
            message: "NOC approved successfully",
            request
        });
    } catch (err) {
        console.error("Source RTO approval error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Source RTO rejects NOC
router.post("/:id/source-rto-reject", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        const user = await User.findById(req.user.id);
        const request = await Request.findById(id);

        if (!request || request.type !== "interStateTransfer") {
            return res.status(404).json({ message: "Transfer request not found" });
        }

        if (user.rtoDetails?.stateCode !== request.interStateDetails.currentState) {
            return res.status(403).json({ message: "Only source state RTO can reject NOC" });
        }

        request.interStateDetails.sourceRTOApproval = {
            status: "rejected",
            officerId: req.user.id,
            officerName: user.name,
            timestamp: new Date(),
            remarks: remarks || "NOC rejected"
        };

        request.status = "rejected";
        await request.save();

        res.json({
            message: "NOC rejected",
            request
        });
    } catch (err) {
        console.error("Source RTO rejection error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Destination RTO approves and assigns new registration number
router.post("/:id/destination-rto-approve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { newRegNumber, remarks } = req.body;

        if (!newRegNumber) {
            return res.status(400).json({ message: "New registration number is required" });
        }

        const user = await User.findById(req.user.id);
        const request = await Request.findById(id).populate("vehicle");

        if (!request || request.type !== "interStateTransfer") {
            return res.status(404).json({ message: "Transfer request not found" });
        }

        // Verify this RTO belongs to the destination state
        if (user.rtoDetails?.stateCode !== request.interStateDetails.targetState) {
            return res.status(403).json({ message: "Only destination state RTO can approve" });
        }

        // Verify source RTO has already approved
        if (request.interStateDetails.sourceRTOApproval.status !== "approved") {
            return res.status(400).json({ message: "Source RTO NOC is required before destination approval" });
        }

        // Prevent duplicate destination registration numbers
        const existingVehicle = await Vehicle.findOne({
            regNumber: newRegNumber,
            _id: { $ne: request.vehicle._id }
        });

        if (existingVehicle) {
            return res.status(400).json({
                message: "The new registration number already exists in the system"
            });
        }

        // Update destination RTO approval
        request.interStateDetails.destinationRTOApproval = {
            status: "approved",
            officerId: req.user.id,
            officerName: user.name,
            rtoOffice: user.rtoDetails.rtoOfficeName,
            timestamp: new Date(),
            remarks: remarks || "Registration approved"
        };

        request.interStateDetails.newRegNumber = newRegNumber;
        request.status = "destination_rto_approved";

        // Update vehicle with new registration number in DB
        const vehicle = request.vehicle;
        const oldRegNumber = vehicle.regNumber;

        vehicle.regNumber = newRegNumber;
        vehicle.status = "active";
        vehicle.lastStateChange = new Date();

        // A fresh number from this office is a fresh certificate, so the office
        // and the officer behind it are recorded for the RC to print.
        vehicle.issuedByOffice = user.rtoDetails?.rtoOfficeName || vehicle.issuedByOffice;
        vehicle.issuedByOfficer = `${user.name}${user.employeeId ? ` (${user.employeeId})` : ""}`;
        if (!vehicle.registrationDate) vehicle.registrationDate = new Date();

        vehicle.stateChangeHistory.push({
            from: oldRegNumber,
            to: newRegNumber,
            reason: "Inter-state transfer",
            authorizedBy: `${user.name} (${user.rtoDetails.rtoOfficeName})`,
            timestamp: new Date()
        });

        vehicle.ownershipHistory.push({
            owner: vehicle.currentOwner,
            transferDate: new Date(),
            blockchainTxHash: null,
            transferReason: "transfer",
            ipfsDocumentHash: request.interStateDetails.passportHash || null
        });

        request.interStateDetails.completedAt = new Date();
        request.status = "approved";

        await vehicle.save();
        await request.save();

        // Record on blockchain using the original registration number because the smart contract
        // tracks registration by the existing regNumber key and does not support renaming it.
        let blockchainTxHash = null;
        try {
            // The registry has to be told whose ownership changed, so it needs the
            // owner's own wallet. Substituting the anchoring wallet here would put
            // this system's address on the ledger as the vehicle's owner - instead
            // the transfer is simply not anchored and the reason is stated once.
            const ownerUser = await User.findById(vehicle.currentOwner).select("name blockchainWalletAddress");
            if (!ownerUser?.blockchainWalletAddress) {
                console.warn(`Not recording the inter-state transfer of ${oldRegNumber} on-chain: ${ownerUser?.name || "the owner"} has no wallet address linked to the account yet.`);
            } else {
                blockchainTxHash = await registerVehicleTransferOnChain(
                    oldRegNumber,
                    newRegNumber,
                    ownerUser.blockchainWalletAddress,
                    "inter_state_transfer"
                );
            }
            if (blockchainTxHash) {
                vehicle.blockchainTxHash = blockchainTxHash;
                const ownershipHistoryEntry = vehicle.ownershipHistory[vehicle.ownershipHistory.length - 1];
                if (ownershipHistoryEntry) {
                    ownershipHistoryEntry.blockchainTxHash = blockchainTxHash;
                }
                await vehicle.save();
            }
        } catch (blockchainErr) {
            console.error("Blockchain registration error:", blockchainErr.message);
        }

        res.json({
            message: "Inter-state transfer approved successfully",
            request,
            blockchainTxHash
        });
    } catch (err) {
        console.error("Destination RTO approval error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Destination RTO rejects transfer
router.post("/:id/destination-rto-reject", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { remarks } = req.body;

        const user = await User.findById(req.user.id);
        const request = await Request.findById(id);

        if (!request || request.type !== "interStateTransfer") {
            return res.status(404).json({ message: "Transfer request not found" });
        }

        if (user.rtoDetails?.stateCode !== request.interStateDetails.targetState) {
            return res.status(403).json({ message: "Only destination state RTO can reject" });
        }

        request.interStateDetails.destinationRTOApproval = {
            status: "rejected",
            officerId: req.user.id,
            officerName: user.name,
            timestamp: new Date(),
            remarks: remarks || "Transfer rejected"
        };

        request.status = "rejected";
        await request.save();

        res.json({
            message: "Transfer rejected",
            request
        });
    } catch (err) {
        console.error("Destination RTO rejection error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get available states for transfer
router.get("/states", authRequired, async (req, res) => {
    try {
        const states = Object.entries(STATE_RTO_CODES).map(([code, name]) => ({
            code,
            name
        }));
        res.json(states);
    } catch (err) {
        console.error("Get states error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
