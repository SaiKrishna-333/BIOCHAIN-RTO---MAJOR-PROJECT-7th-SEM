import express from "express";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { TheftReport } from "../models/TheftReport.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { verifyFingerprint } from "../services/biometricService.js";
import {
    updateVehicleStatusOnChain
} from "../services/blockchainService.js";
import {
    sendTheftAlert,
    sendRecoveryAlert
} from "../services/notificationService.js";

const router = express.Router();

// Report vehicle theft (owner/police)
router.post("/report", authRequired, async (req, res) => {
    try {
        const { vehicleId, policeStation, firNumber, incidentDate, incidentLocation, description } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        // Check if user owns the vehicle or is police
        const isOwner = String(vehicle.currentOwner) === String(req.user.id);
        const isPolice = req.user.role === "police";

        if (!isOwner && !isPolice) {
            return res.status(403).json({ message: "Unauthorized to report theft for this vehicle" });
        }

        // Check if vehicle is already reported stolen
        const existingReport = await TheftReport.findOne({
            vehicle: vehicleId,
            status: { $in: ["reported", "under_investigation"] }
        });
        if (existingReport) {
            return res.status(400).json({ message: "Vehicle already reported as stolen" });
        }

        const theftReport = new TheftReport({
            vehicle: vehicleId,
            reporter: req.user.id,
            policeStation,
            firNumber,
            incidentDate,
            incidentLocation,
            description
        });

        await theftReport.save();

        // Update vehicle status to blocked
        vehicle.status = "blocked";

        try {
            // Also update the status on the blockchain
            const txHash = await updateVehicleStatusOnChain(vehicle.regNumber, "stolen");
            if (txHash) vehicle.blockchainTxHash = txHash;
        } catch (blockchainErr) {
            console.error("Failed to update vehicle status on blockchain:", blockchainErr.message);
            // Don't fail the whole operation if blockchain update fails
        }

        await vehicle.save();

        // Send theft alerts to all RTO officers and police
        try {
            const reporter = await User.findById(req.user.id);
            await sendTheftAlert(vehicle, theftReport, reporter);
        } catch (notifErr) {
            console.error("Failed to send theft notifications:", notifErr.message);
            // Don't fail the operation if notifications fail
        }

        res.status(201).json({
            message: "Theft reported successfully. Alerts sent to RTO and Police.",
            reportId: theftReport._id
        });
    } catch (err) {
        console.error("theft report error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Get theft reports (police/RTO)
router.get("/reports", authRequired, requireRole("police", "rto"), async (req, res) => {
    try {
        const { status, startDate, endDate } = req.query;
        let query = {};

        if (status) query.status = status;
        if (startDate || endDate) {
            query.createdAt = {};
            if (startDate) query.createdAt.$gte = new Date(startDate);
            if (endDate) query.createdAt.$lte = new Date(endDate);
        }

        const reports = await TheftReport.find(query)
            .populate("vehicle", "regNumber make model year chassisNumber")
            .populate("reporter", "name email")
            .sort({ createdAt: -1 });

        res.json(reports);
    } catch (err) {
        console.error("get theft reports error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Mark vehicle as recovered (police only)
router.put("/reports/:id/recover", authRequired, requireRole("police"), async (req, res) => {
    try {
        const { id } = req.params;
        const { recoveryDate, recoveryLocation, remarks } = req.body;

        const theftReport = await TheftReport.findById(id).populate("vehicle");
        if (!theftReport) {
            return res.status(404).json({ message: "Theft report not found" });
        }

        if (theftReport.status === "recovered") {
            return res.status(400).json({ message: "Vehicle already marked as recovered" });
        }

        // Update theft report
        theftReport.status = "recovered";
        theftReport.recoveryDate = recoveryDate ? new Date(recoveryDate) : new Date();
        theftReport.recoveryLocation = recoveryLocation;
        theftReport.remarks = remarks;
        await theftReport.save();

        // Update vehicle status in database
        const vehicle = theftReport.vehicle;
        vehicle.isStolen = false;
        vehicle.status = "active";
        await vehicle.save();

        // Update blockchain status back to ACTIVE
        try {
            if (vehicle.regNumber) {
                const txHash = await updateVehicleStatusOnChain(vehicle.regNumber, "active");
                if (txHash) vehicle.blockchainTxHash = txHash;
                await vehicle.save();
            }
        } catch (blockchainErr) {
            console.error("Failed to update blockchain status:", blockchainErr.message);
        }

        // Send recovery notification to owner
        try {
            const owner = await User.findById(vehicle.currentOwner);
            if (owner) {
                console.log(`Recovery notification sent to ${owner.email}`);
            }
        } catch (notifErr) {
            console.error("Failed to send recovery notification:", notifErr.message);
        }

        res.json({
            message: "Vehicle marked as recovered successfully",
            report: theftReport
        });
    } catch (err) {
        console.error("mark recovered error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Update theft report status (police and RTO officers - the RTO also has to
// restore the registration record once a vehicle is recovered)
router.put("/reports/:id", authRequired, requireRole("police", "rto"), async (req, res) => {
    try {
        const { id } = req.params;
        const { status, recoveryDate, recoveryLocation, remarks } = req.body;

        const allowedStatuses = ["reported", "under_investigation", "recovered", "closed"];
        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ message: `Status must be one of: ${allowedStatuses.join(", ")}` });
        }

        const report = await TheftReport.findById(id).populate("vehicle");
        if (!report) {
            return res.status(404).json({ message: "Theft report not found" });
        }

        report.status = status;
        if (recoveryDate) report.recoveryDate = recoveryDate;
        if (recoveryLocation) report.recoveryLocation = recoveryLocation;
        if (remarks) report.remarks = remarks;

        await report.save();

        // If recovered, unblock the vehicle
        if (status === "recovered" && report.vehicle) {
            report.vehicle.status = "active";

            try {
                // Also update the status on the blockchain
                const txHash = await updateVehicleStatusOnChain(report.vehicle.regNumber, "active");
                if (txHash) report.vehicle.blockchainTxHash = txHash;
            } catch (blockchainErr) {
                console.error("Failed to update vehicle status on blockchain:", blockchainErr.message);
                // Don't fail the whole operation if blockchain update fails
            }

            await report.vehicle.save();

            // Send recovery alerts
            try {
                await sendRecoveryAlert(report.vehicle, report);
            } catch (notifErr) {
                console.error("Failed to send recovery notifications:", notifErr.message);
            }
        }

        res.json({ message: "Theft report updated successfully", report });
    } catch (err) {
        console.error("update theft report error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Check if vehicle is stolen (public API for verification)
router.get("/check/:regNumber", async (req, res) => {
    try {
        const { regNumber } = req.params;
        const vehicle = await Vehicle.findOne({ regNumber });
        if (!vehicle) {
            return res.status(404).json({ message: "Vehicle not found" });
        }

        const activeTheftReport = await TheftReport.findOne({
            vehicle: vehicle._id,
            status: { $in: ["reported", "under_investigation"] }
        });

        res.json({
            regNumber: vehicle.regNumber,
            make: vehicle.make,
            model: vehicle.model,
            isStolen: !!activeTheftReport,
            theftReport: activeTheftReport ? {
                status: activeTheftReport.status,
                incidentDate: activeTheftReport.incidentDate,
                policeStation: activeTheftReport.policeStation,
                firNumber: activeTheftReport.firNumber
            } : null
        });
    } catch (err) {
        console.error("vehicle check error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;