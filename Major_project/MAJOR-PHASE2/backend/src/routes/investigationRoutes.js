// investigationRoutes.js
// Officer-facing feature family (mounted at /api/investigations):
// Feature 3 - Blockchain-Verified Vehicle Fraud Investigation Casebook
// Feature 4 - AI-Based Vehicle Transaction Anomaly Detection
// Feature 5 - Cross-Record Vehicle Identity Cloning Detector
// Access is restricted to police / rto / admin. Nothing here auto-declares
// guilt, auto-blocks transfers, or edits existing records.

import express from "express";
import multer from "multer";
import mongoose from "mongoose";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { User } from "../models/User.js";
import { Vehicle } from "../models/Vehicle.js";
import { InvestigationCase, nextCaseRef } from "../models/InvestigationCase.js";
import { IdentityConflict } from "../models/IdentityConflict.js";
import { anchorRecord, verifyFileHash, hashFileBuffer } from "../services/recordAnchorService.js";
import { runAnomalyScan, listAnomalyAlerts, analyzeResaleIntervals, analyzeOwnershipChurn, analyzeFlaggedRepeats } from "../services/transactionAnomalyService.js";
import { AnomalyAlert } from "../models/AnomalyAlert.js";
import { scanForCloningConflicts, listConflicts } from "../services/identityCloningService.js";

const router = express.Router();
const OFFICER = ["police", "rto", "admin"];
const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const ALLOWED = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

const officerLabel = async (userId) => {
    const u = await User.findById(userId).select("name role badgeNumber").lean();
    return u ? `${u.name}${u.badgeNumber ? ` (${u.badgeNumber})` : ""} [${u.role.toUpperCase()}]` : "Unknown";
};

const logAction = (caseDoc, action, detail, user) => {
    caseDoc.actions.push({ action, detail, performedBy: user.id, performerName: user.name, performerRole: user.role, performedAt: new Date() });
};

const isValidId = (id) => mongoose.Types.ObjectId.isValid(id);

// ===========================================================================
// DASHBOARD STATS - every number below is aggregated live from the three
// investigative collections. Nothing is hardcoded; the console KPI strip and
// charts read only from here.
// ===========================================================================
router.get("/stats", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const [cases, alerts, conflicts] = await Promise.all([
            InvestigationCase.find({}).select("status priority createdAt").lean(),
            AnomalyAlert.find({}).select("alertType severity reviewStatus riskIndicator createdAt").lean(),
            IdentityConflict.find({}).select("conflictType reviewStatus createdAt").lean(),
        ]);

        const tally = (rows, key) => {
            const m = new Map();
            for (const r of rows) {
                const v = r[key] || "unknown";
                m.set(v, (m.get(v) || 0) + 1);
            }
            return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
        };

        const OPEN_CASE = ["open", "under-review", "under_review", "action-required", "action_required"];
        const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short" });
        const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const lastMonths = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            lastMonths.push({ key: monthKey(d), label: MONTH.format(d), count: 0 });
        }
        const monthIndex = new Map(lastMonths.map((m) => [m.key, m]));
        for (const c of cases) {
            const d = c.createdAt ? new Date(c.createdAt) : null;
            if (d) { const b = monthIndex.get(monthKey(d)); if (b) b.count++; }
        }

        const riskVals = alerts.map((a) => Number(a.riskIndicator)).filter((n) => Number.isFinite(n));
        const avgRisk = riskVals.length ? Math.round(riskVals.reduce((s, n) => s + n, 0) / riskVals.length) : null;

        res.json({
            success: true,
            cases: {
                total: cases.length,
                open: cases.filter((c) => OPEN_CASE.includes(c.status)).length,
                resolved: cases.filter((c) => c.status === "resolved").length,
                closed: cases.filter((c) => c.status === "closed").length,
                highPriority: cases.filter((c) => ["high", "critical"].includes(c.priority)).length,
                byStatus: tally(cases, "status"),
                byMonth: lastMonths,
            },
            anomalies: {
                total: alerts.length,
                pendingReview: alerts.filter((a) => a.reviewStatus !== "reviewed" && a.reviewStatus !== "dismissed").length,
                bySeverity: tally(alerts, "severity"),
                byType: tally(alerts, "alertType"),
                avgRisk,
            },
            conflicts: {
                total: conflicts.length,
                pendingReview: conflicts.filter((c) => c.reviewStatus !== "reviewed" && c.reviewStatus !== "dismissed").length,
                byType: tally(conflicts, "conflictType"),
            },
            note: "Indicators for human review only - none of these counts assert fraud or modify a record.",
        });
    } catch (err) {
        console.error("investigation stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// FEATURE 3: Fraud Investigation Casebook
// ===========================================================================

// List / filter cases
router.get("/cases", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const { status, priority, from, to, ref } = req.query;
        const q = {};
        if (status) q.status = status;
        if (priority) q.priority = priority;
        if (ref) q.caseRef = new RegExp(ref, "i");
        if (from || to) {
            q.createdAt = {};
            if (from) q.createdAt.$gte = new Date(from);
            if (to) q.createdAt.$lte = new Date(to);
        }
        const cases = await InvestigationCase.find(q)
            .sort({ createdAt: -1 }).limit(200)
            .select("-evidence.data")
            .populate("vehicle", "regNumber make model status")
            .populate("assignedOfficer", "name role")
            .lean();
        res.json({ success: true, count: cases.length, cases });
    } catch (err) {
        console.error("cases list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Create a case
router.post("/cases", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const { title, reason, priority, vehicleId, assignedOfficerId } = req.body;
        const errors = [];
        if (!title || !String(title).trim()) errors.push("Title is required.");
        if (!reason || !String(reason).trim()) errors.push("A reason for review is required.");
        if (!["low", "medium", "high", "critical"].includes(priority)) errors.push("Invalid priority.");
        let vehicle = null;
        if (vehicleId) {
            if (!isValidId(vehicleId)) return res.status(400).json({ message: "Invalid vehicle id.", errors: ["Invalid vehicle id."] });
            vehicle = await Vehicle.findById(vehicleId).lean();
            if (!vehicle) errors.push("Vehicle not found.");
        }
        if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

        const caseRef = await nextCaseRef();
        const c = new InvestigationCase({
            caseRef, title: String(title).trim(), reason: String(reason).trim(), priority,
            vehicle: vehicle?._id || null, regNumber: vehicle?.regNumber || null,
            assignedOfficer: assignedOfficerId || req.user.id, createdBy: req.user.id
        });
        // Include a link to the vehicle's existing on-chain tx hash if present
        if (vehicle?.blockchainTxHash) c.blockchainTxRefs.push({ txHash: vehicle.blockchainTxHash, label: "Vehicle registration/last transfer" });
        logAction(c, "created", `Case opened: ${c.reason}`, req.user);
        c.anchor = await anchorRecord({ ...c.toObject(), actions: undefined, evidence: undefined }, `case ${caseRef}`);
        await c.save();
        res.status(201).json({ success: true, message: `Case ${caseRef} created.`, case: { ...c.toObject(), evidence: [] } });
    } catch (err) {
        console.error("case create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Case detail
router.get("/cases/:id", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id)
            .select("-evidence.data")
            .populate("vehicle", "regNumber make model chassisNumber engineNumber status ownershipHistory")
            .populate("assignedOfficer", "name role")
            .lean();
        if (!c) return res.status(404).json({ message: "Case not found" });
        c.evidence = (c.evidence || []).map(e => ({ fileName: e.fileName, sha256: e.sha256, fileSize: e.fileSize, description: e.description, addedAt: e.addedAt }));
        res.json({ success: true, case: c });
    } catch (err) {
        console.error("case detail error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Change status (records who/when)
router.patch("/cases/:id/status", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id);
        if (!c) return res.status(404).json({ message: "Case not found" });
        const { status, remarks } = req.body;
        const allowed = ["open", "under-review", "action-required", "resolved", "closed"];
        if (!allowed.includes(status)) return res.status(400).json({ message: "Invalid status." });
        const prev = c.status;
        c.status = status;
        if (status === "resolved" || status === "closed") { c.resolution = remarks || c.resolution; c.resolvedAt = new Date(); }
        logAction(c, "status-change", `Status ${prev} -> ${status}${remarks ? `: ${remarks}` : ""}`, req.user);
        await c.save();
        res.json({ success: true, case: { ...c.toObject(), evidence: [] } });
    } catch (err) {
        console.error("case status error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Add officer note
router.post("/cases/:id/notes", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id);
        if (!c) return res.status(404).json({ message: "Case not found" });
        if (!req.body.text || !String(req.body.text).trim()) return res.status(400).json({ message: "Note text required." });
        c.notes.push({ text: String(req.body.text).trim(), author: req.user.id, authorName: await officerLabel(req.user.id) });
        logAction(c, "note", "Investigator note added", req.user);
        await c.save();
        res.json({ success: true, notes: c.notes });
    } catch (err) {
        console.error("case note error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Upload evidence (hashed; bytes stored in Mongo, never on-chain)
router.post("/cases/:id/evidence", authRequired, requireRole(...OFFICER), evidenceUpload.single("file"), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id);
        if (!c) return res.status(404).json({ message: "Case not found" });
        if (!req.file) return res.status(400).json({ message: "No file uploaded." });
        if (!ALLOWED.includes(req.file.mimetype)) return res.status(400).json({ message: `Unsupported file type: ${req.file.mimetype}` });
        const sha256 = hashFileBuffer(req.file.buffer);
        c.evidence.push({
            fileName: req.file.originalname, contentType: req.file.mimetype, fileSize: req.file.size,
            data: req.file.buffer, sha256, description: req.body.description || null, addedBy: req.user.id
        });
        logAction(c, "evidence-added", `Evidence '${req.file.originalname}' added (sha256 ${sha256.slice(0, 12)}…)`, req.user);
        await c.save();
        res.status(201).json({ success: true, message: "Evidence added and hashed.", evidenceIndex: c.evidence.length - 1, sha256 });
    } catch (err) {
        console.error("case evidence error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify an evidence file still matches its recorded hash
router.post("/cases/:id/evidence/:idx/verify", authRequired, requireRole(...OFFICER), evidenceUpload.single("file"), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id);
        if (!c) return res.status(404).json({ message: "Case not found" });
        const idx = parseInt(req.params.idx, 10);
        const ev = c.evidence[idx];
        if (!ev) return res.status(404).json({ message: "Evidence entry not found" });
        if (!req.file) return res.status(400).json({ message: "Upload the file to verify against the recorded hash." });
        const result = verifyFileHash(req.file.buffer, ev.sha256);
        logAction(c, "evidence-verified", `Evidence '${ev.fileName}' integrity ${result.verified ? "MATCHED" : "MISMATCHED"}`, req.user);
        await c.save();
        res.json({
            success: true, ...result,
            limitation: "A match shows the file has not changed since hashing; it does not prove the content was truthful when submitted."
        });
    } catch (err) {
        console.error("case evidence verify error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Download evidence file
router.get("/cases/:id/evidence/:idx", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id);
        if (!c) return res.status(404).json({ message: "Case not found" });
        const ev = c.evidence[parseInt(req.params.idx, 10)];
        if (!ev || !ev.data) return res.status(404).json({ message: "Evidence not found" });
        res.set("Content-Type", ev.contentType);
        res.set("Content-Disposition", `inline; filename="${ev.fileName}"`);
        res.send(ev.data);
    } catch (err) {
        console.error("case evidence fetch error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Link a blockchain transaction hash to the case
router.post("/cases/:id/link-tx", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const c = await InvestigationCase.findById(req.params.id);
        if (!c) return res.status(404).json({ message: "Case not found" });
        const { txHash, label } = req.body;
        if (!txHash || !/^0x[0-9a-fA-F]{8,}$/.test(txHash)) return res.status(400).json({ message: "Provide a valid transaction hash." });
        c.blockchainTxRefs.push({ txHash, label: label || null });
        logAction(c, "linked", `Linked blockchain tx ${txHash.slice(0, 12)}…`, req.user);
        await c.save();
        res.json({ success: true, blockchainTxRefs: c.blockchainTxRefs });
    } catch (err) {
        console.error("case link-tx error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// FEATURE 4: Transaction Anomaly Detection (officer dashboard)
// ===========================================================================

// Trigger a scan and persist new alerts
router.post("/anomaly/scan", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const result = await runAnomalyScan();
        res.json({ success: true, ...result, note: "Explainable baseline anomaly model - indicative only, not a proof of wrongdoing. No transfer was auto-rejected." });
    } catch (err) {
        console.error("anomaly scan error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Preview statistics without persisting alerts (useful for small/demo data)
router.get("/anomaly/preview", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const [resale, churn, repeats] = await Promise.all([analyzeResaleIntervals(), analyzeOwnershipChurn(), analyzeFlaggedRepeats()]);
        res.json({ success: true, resale, churn, repeats, modelVersion: "anomaly-baseline-v1" });
    } catch (err) {
        console.error("anomaly preview error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// List alerts
router.get("/anomaly/alerts", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const alerts = await listAnomalyAlerts({ status: req.query.status });
        res.json({ success: true, count: alerts.length, alerts });
    } catch (err) {
        console.error("anomaly list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Review an alert; "investigate" optionally opens a casebook entry
router.patch("/anomaly/alerts/:id/review", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const alert = await AnomalyAlert.findById(req.params.id);
        if (!alert) return res.status(404).json({ message: "Alert not found" });
        const { reviewStatus, remarks, openCase } = req.body;
        if (!["pending", "reviewed", "false-positive", "investigate"].includes(reviewStatus)) return res.status(400).json({ message: "Invalid review status." });
        alert.reviewStatus = reviewStatus;
        alert.reviewedBy = req.user.id;
        alert.reviewedAt = new Date();
        alert.reviewRemarks = remarks || alert.reviewRemarks;

        if (reviewStatus === "investigate" && openCase) {
            const caseRef = await nextCaseRef();
            const c = new InvestigationCase({
                caseRef, title: `Anomaly review: ${alert.alertType}`, reason: alert.explanation,
                priority: alert.severity === "high" ? "high" : "medium", status: "open",
                vehicle: alert.subjectType === "vehicle" && isValidId(alert.subject) ? alert.subject : null,
                assignedOfficer: req.user.id, createdBy: req.user.id,
                relatedAlerts: [alert._id]
            });
            c.actions.push({ action: "created", detail: `Opened from anomaly alert (${caseRef})`, performedBy: req.user.id, performerName: req.user.name, performerRole: req.user.role, performedAt: new Date() });
            await c.save();
            alert.linkedCase = c._id;
            res.locals.createdCase = { caseRef, caseId: c._id };
        }
        await alert.save();
        res.json({ success: true, alert, createdCase: res.locals.createdCase || null });
    } catch (err) {
        console.error("anomaly review error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// FEATURE 5: Identity Cloning Detector (restricted dashboard)
// ===========================================================================

router.post("/cloning/scan", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const result = await scanForCloningConflicts();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("cloning scan error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

router.get("/cloning/conflicts", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const conflicts = await listConflicts({ reviewStatus: req.query.reviewStatus });
        res.json({ success: true, count: conflicts.length, conflicts, note: "Exact-match conflicts only. Review before acting; nothing here is an automatic fraud verdict." });
    } catch (err) {
        console.error("cloning list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Review a conflict; can open a casebook entry linked back to the conflict
router.patch("/cloning/conflicts/:id/review", authRequired, requireRole(...OFFICER), async (req, res) => {
    try {
        const conflict = await IdentityConflict.findById(req.params.id);
        if (!conflict) return res.status(404).json({ message: "Conflict not found" });
        const { reviewStatus, remarks, openCase } = req.body;
        const allowed = ["unreviewed", "under-investigation", "legitimate-correction", "false-positive", "resolved"];
        if (!allowed.includes(reviewStatus)) return res.status(400).json({ message: "Invalid review status." });
        conflict.reviewStatus = reviewStatus;
        conflict.reviewedBy = req.user.id;
        conflict.reviewedAt = new Date();
        conflict.reviewRemarks = remarks || conflict.reviewRemarks;

        if (openCase && ["under-investigation"].includes(reviewStatus)) {
            const caseRef = await nextCaseRef();
            const c = new InvestigationCase({
                caseRef, title: `Identity conflict: ${conflict.conflictType}`,
                reason: `${conflict.conflictType} on identifier ${conflict.identifierValue} across ${conflict.regNumbers.join(", ") || "multiple records"}.`,
                priority: "high", status: "open",
                vehicle: conflict.vehicles[0] || null,
                regNumber: conflict.regNumbers[0] || null,
                assignedOfficer: req.user.id, createdBy: req.user.id
            });
            c.actions.push({ action: "created", detail: `Opened from cloning conflict ${conflict._id}`, performedBy: req.user.id, performerName: req.user.name, performerRole: req.user.role, performedAt: new Date() });
            await c.save();
            conflict.linkedCase = c._id;
            res.locals.createdCase = { caseRef, caseId: c._id };
        }
        await conflict.save();
        res.json({ success: true, conflict, createdCase: res.locals.createdCase || null });
    } catch (err) {
        console.error("cloning review error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
