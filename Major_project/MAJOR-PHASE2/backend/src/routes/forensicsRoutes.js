// forensicsRoutes.js
// Vehicle Lifecycle Forensics & Event Replay Engine API (mounted at /api/forensics).
// Read-only investigative endpoints for oversight roles (RTO, Police, Admin).
// None of these mutate a production record; reconstruction aggregates the append-only
// event history the application already keeps.
import express from "express";
import mongoose from "mongoose";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import {
    resolveVehicle,
    reconstruct,
    verifyVehicleIntegrity,
    buildInvestigationReport,
    compareStates,
    stateAtEvent,
    linkFindingToCase,
} from "../services/forensicsService.js";

const router = express.Router();
const INVESTIGATORS = ["rto", "police", "admin"];

router.use(authRequired, requireRole(...INVESTIGATORS));

// Registration lookup box: find the vehicle the investigator wants to replay.
router.get("/search", async (req, res) => {
    try {
        const reg = String(req.query.reg || "").trim().toUpperCase();
        if (!reg) return res.status(400).json({ message: "A registration number is required." });
        const compact = reg.replace(/[\s-]/g, "");
        const vehicles = await Vehicle.find({
            $or: [{ regNumber: reg }, { regNumber: compact }],
        })
            .select("regNumber make model year engineNumber chassisNumber status")
            .lean();
        res.json({ success: true, count: vehicles.length, vehicles });
    } catch (err) {
        console.error("forensics search error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Full reconstruction: ordered replay + conflict tracing + integrity summary.
router.get("/replay/:vehicleId", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId))
            return res.status(400).json({ message: "Invalid vehicle id." });
        const recon = await reconstruct(req.params.vehicleId);
        if (recon.error) return res.status(404).json({ message: recon.error });
        res.json({ success: true, ...recon });
    } catch (err) {
        console.error("forensics replay error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Same reconstruction addressed by registration number, for the search box flow.
router.get("/replay-by-reg/:regNumber", async (req, res) => {
    try {
        const vehicle = await resolveVehicle({ regNumber: req.params.regNumber });
        if (!vehicle) return res.status(404).json({ message: "No vehicle matches that registration number." });
        const recon = await reconstruct(vehicle._id);
        if (recon.error) return res.status(404).json({ message: recon.error });
        res.json({ success: true, ...recon });
    } catch (err) {
        console.error("forensics replay-by-reg error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Structured, printable investigation report.
router.get("/report/:vehicleId", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId))
            return res.status(400).json({ message: "Invalid vehicle id." });
        const recon = await reconstruct(req.params.vehicleId);
        if (recon.error) return res.status(404).json({ message: recon.error });
        res.json({ success: true, report: buildInvestigationReport(recon) });
    } catch (err) {
        console.error("forensics report error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Recompute tamper-evident hashes for the replayable records that support it.
router.post("/verify-integrity/:vehicleId", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId))
            return res.status(400).json({ message: "Invalid vehicle id." });
        const result = await verifyVehicleIntegrity(req.params.vehicleId);
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("forensics verify error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Replay the reconstructed vehicle state up to a single timeline event.
router.get("/state-at/:vehicleId", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId))
            return res.status(400).json({ message: "Invalid vehicle id." });
        const eventId = String(req.query.eventId || "");
        if (!eventId) return res.status(400).json({ message: "An eventId query parameter is required." });
        const result = await stateAtEvent(req.params.vehicleId, eventId);
        if (result.error) return res.status(404).json({ message: result.error });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("forensics state-at error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Compare the reconstructed state between two timeline events.
router.get("/compare/:vehicleId", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId))
            return res.status(400).json({ message: "Invalid vehicle id." });
        const fromEventId = String(req.query.from || "");
        const toEventId = String(req.query.to || "");
        if (!fromEventId || !toEventId) return res.status(400).json({ message: "Both 'from' and 'to' event ids are required." });
        const result = await compareStates(req.params.vehicleId, fromEventId, toEventId);
        if (result.error) return res.status(404).json({ message: result.error });
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("forensics compare error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// The one permitted write: link a forensics finding to the Fraud Investigation
// Casebook. It creates/attaches a case and never edits the source records.
router.post("/link-case/:vehicleId", async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId))
            return res.status(400).json({ message: "Invalid vehicle id." });
        const { conflict, caseId, note } = req.body || {};
        if (!conflict || !conflict.title) return res.status(400).json({ message: "A finding (conflict) is required." });
        const actor = { id: req.user.id, name: req.user.name, role: req.user.role };
        const result = await linkFindingToCase({ vehicleId: req.params.vehicleId, conflict, actor, caseId, note });
        if (result.error) return res.status(400).json({ message: result.error });
        res.status(result.created ? 201 : 200).json({ success: true, ...result });
    } catch (err) {
        console.error("forensics link-case error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
