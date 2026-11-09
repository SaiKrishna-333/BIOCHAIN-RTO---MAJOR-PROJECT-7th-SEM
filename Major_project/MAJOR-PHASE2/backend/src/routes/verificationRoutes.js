import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import { TheftReport } from "../models/TheftReport.js";
import { OwnershipHistory } from "../models/OwnershipHistory.js";
import { User } from "../models/User.js";
import { getCurrentOwnerFromChain } from "../services/blockchainService.js";
import { maskAadhaar } from "../utils/masking.js";

const router = express.Router();

// Real-time vehicle verification for law enforcement, RTO officers and dealers
router.get("/vehicle/:regNumber", authRequired, requireRole("police", "rto", "dealer"), async (req, res) => {
    try {
        const { regNumber } = req.params;

        // Find the vehicle in our database
        const vehicle = await Vehicle.findOne({ regNumber })
            .populate("currentOwner", "name aadhaarNumber dlNumber");

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found in database" });
        }

        // Check for active theft reports
        const activeTheftReport = await TheftReport.findOne({
            vehicle: vehicle._id,
            status: { $in: ["reported", "under_investigation"] }
        });

        // Get ownership history
        const ownershipHistory = await OwnershipHistory.find({ vehicle: vehicle._id })
            .populate("fromOwner", "name")
            .populate("toOwner", "name")
            .sort({ createdAt: 1 });

        // Get current owner from blockchain (if available)
        let blockchainOwner = null;
        if (vehicle.regNumber) {
            try {
                blockchainOwner = await getCurrentOwnerFromChain(vehicle.regNumber);
            } catch (blockchainErr) {
                console.error("Error fetching from blockchain:", blockchainErr.message);
                // Continue without blockchain data
            }
        }

        // Prepare verification response
        const verificationResponse = {
            regNumber: vehicle.regNumber,
            chassisNumber: vehicle.chassisNumber,
            engineNumber: vehicle.engineNumber,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            status: vehicle.status,
            isStolen: !!activeTheftReport,
            theftReport: activeTheftReport ? {
                status: activeTheftReport.status,
                incidentDate: activeTheftReport.incidentDate,
                policeStation: activeTheftReport.policeStation,
                firNumber: activeTheftReport.firNumber,
                incidentLocation: activeTheftReport.incidentLocation,
                description: activeTheftReport.description
            } : null,
            currentOwner: vehicle.currentOwner ? {
                name: vehicle.currentOwner.name,
                // A verification screen needs to identify the holder, not disclose
                // a twelve-digit identity number to every searcher.
                aadhaarNumber: maskAadhaar(vehicle.currentOwner.aadhaarNumber),
                dlNumber: vehicle.currentOwner.dlNumber
            } : null,
            ownershipHistory: ownershipHistory.map(record => ({
                from: record.fromOwner?.name || "Unknown",
                to: record.toOwner?.name || "Unknown",
                date: record.timestamp,
                transferType: record.transferType,
                blockchainTxHash: record.blockchainTxHash
            })),
            blockchainOwner,
            lastVerified: vehicle.lastVerified,
            blockchainTxHash: vehicle.blockchainTxHash
        };

        // Dealers may confirm that a vehicle is clean and on-chain verified, but they
        // are not entitled to the registered owner's identity - disclosure for them
        // stays minimal (privacy-preserving verification principle).
        if (req.user.role === "dealer") {
            verificationResponse.currentOwner = null;
            verificationResponse.ownershipHistory = verificationResponse.ownershipHistory.map(
                ({ from, to, ...rest }) => rest
            );
        }

        res.json(verificationResponse);
    } catch (err) {
        console.error("vehicle verification error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Real-time owner verification by Aadhaar or DL number
router.get("/person/:identifier", authRequired, requireRole("police", "rto"), async (req, res) => {
    try {
        const { identifier } = req.params; // Could be aadhaar or DL number

        // Find user by either aadhaar or DL number
        const user = await User.findOne({
            $or: [
                { aadhaarNumber: identifier },
                { dlNumber: identifier }
            ]
        });

        if (!user) {
            return res.status(404).json({ message: "Person not found" });
        }

        // Get all vehicles owned by this person
        const vehicles = await Vehicle.find({ currentOwner: user._id });

        // Get ownership history for these vehicles
        const ownershipHistories = [];
        for (const vehicle of vehicles) {
            const history = await OwnershipHistory.find({ vehicle: vehicle._id })
                .populate("fromOwner", "name")
                .populate("toOwner", "name")
                .sort({ createdAt: 1 });

            ownershipHistories.push({
                vehicleId: vehicle._id,
                regNumber: vehicle.regNumber,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                history: history.map(record => ({
                    from: record.fromOwner?.name || "Unknown",
                    to: record.toOwner?.name || "Unknown",
                    date: record.timestamp,
                    transferType: record.transferType
                }))
            });
        }

        res.json({
            person: {
                name: user.name,
                email: user.email,
                aadhaarNumber: maskAadhaar(user.aadhaarNumber),
                dlNumber: user.dlNumber,
                role: user.role,
                verificationStatus: user.verificationStatus
            },
            vehicles,
            ownershipHistories
        });
    } catch (err) {
        console.error("person verification error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Quick verification endpoint that takes a vehicle ID or registration number
router.post("/quick-verify", authRequired, requireRole("police", "rto"), async (req, res) => {
    try {
        const { identifier } = req.body; // Can be reg number or vehicle ID

        // Determine if it's a registration number or vehicle ID
        let vehicle;
        if (identifier.match(/^[A-Z0-9]+$/)) { // Likely a registration number
            vehicle = await Vehicle.findOne({ regNumber: identifier });
        } else { // Likely a vehicle ID
            vehicle = await Vehicle.findById(identifier);
        }

        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Check for active theft reports
        const activeTheftReport = await TheftReport.findOne({
            vehicle: vehicle._id,
            status: { $in: ["reported", "under_investigation"] }
        });

        res.json({
            regNumber: vehicle.regNumber,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            status: vehicle.status,
            isStolen: !!activeTheftReport,
            currentOwner: vehicle.currentOwner ? {
                name: (await User.findById(vehicle.currentOwner))?.name
            } : null
        });
    } catch (err) {
        console.error("quick verification error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;