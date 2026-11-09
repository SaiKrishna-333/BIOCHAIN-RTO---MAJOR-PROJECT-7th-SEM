// transferApprovalRoutes.js
// Feature 8: Conditional Vehicle Transfer with Multi-Party Approval
// (mounted at /api/transfer-approvals)
//
// Adds a configurable, auditable approval checklist ON TOP OF the existing
// transfer workflow. The on-chain VehicleRegistry contract is NOT modified.
// A transfer can only be finalized (see requestRoutes) once every mandatory
// step is approved. Backend validates every state transition; the frontend is
// never trusted alone.

import express from "express";
import mongoose from "mongoose";
import { authRequired } from "../middleware/authMiddleware.js";
import { User } from "../models/User.js";
import { Vehicle } from "../models/Vehicle.js";
import { Request } from "../models/Request.js";
import {
    TransferApprovalWorkflow,
    DEFAULT_TRANSFER_STEPS,
    STEP_ROLE_MAP
} from "../models/TransferApprovalWorkflow.js";
import { anchorRecord } from "../services/recordAnchorService.js";

const router = express.Router();

const normalizeManufacturer = (name) =>
    String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// A malformed id typed into the UI would otherwise raise a Mongoose CastError and
// surface as an opaque 500, so reject it as a clear 400 before querying.
const rejectBadRequestId = (req, res) => {
    if (mongoose.Types.ObjectId.isValid(req.params.requestId)) return false;
    res.status(400).json({
        message: "Invalid transfer request id. Use the id shown on your request."
    });
    return true;
};

// Initialize a workflow for an existing transfer request (RTO/admin)
router.post("/:requestId/init", authRequired, async (req, res) => {
    try {
        if (!["rto", "admin"].includes(req.user.role)) {
            return res.status(403).json({ message: "Only RTO/admin can initialize an approval workflow." });
        }
        if (rejectBadRequestId(req, res)) return;
        const request = await Request.findById(req.params.requestId).populate("vehicle", "regNumber make model");
        if (!request) return res.status(404).json({ message: "Transfer request not found." });
        if (request.type !== "transfer") return res.status(400).json({ message: "Approval workflow applies to ownership transfers." });

        const existing = await TransferApprovalWorkflow.findOne({ request: request._id });
        if (existing) return res.status(409).json({ message: "A workflow already exists for this transfer.", workflow: existing });

        // Optional custom step config: [{ key, required }]
        const custom = Array.isArray(req.body?.steps) ? req.body.steps : null;
        const steps = (custom && custom.length ? DEFAULT_TRANSFER_STEPS.filter(s => custom.some(c => c.key === s.key)) : DEFAULT_TRANSFER_STEPS)
            .map(s => ({
                ...s,
                required: custom ? !!custom.find(c => c.key === s.key)?.required : s.required,
                status: "not_started"
            }));
        if (!steps.length) return res.status(400).json({ message: "No valid steps supplied." });

        const workflow = await TransferApprovalWorkflow.create({
            request: request._id, vehicle: request.vehicle?._id, regNumber: request.vehicle?.regNumber,
            steps,
            decisions: [{ stepKey: "workflow", previousStatus: "-", newStatus: "initialized", actor: req.user.id, actorName: req.user.name, actorRole: req.user.role, reason: "Approval checklist created" }]
        });
        res.status(201).json({ success: true, workflow });
    } catch (err) {
        console.error("workflow init error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// View a workflow (participants + officers)
router.get("/:requestId", authRequired, async (req, res) => {
    try {
        if (rejectBadRequestId(req, res)) return;
        const workflow = await TransferApprovalWorkflow.findOne({ request: req.params.requestId })
            .populate("vehicle", "regNumber make model");
        if (!workflow) return res.json({ success: true, exists: false });
        const request = await Request.findById(req.params.requestId).select("seller buyer status");
        res.json({
            success: true, exists: true, workflow,
            canDecide: computeAllowedSteps(workflow, req.user, request),
            requestStatus: request?.status
        });
    } catch (err) {
        console.error("workflow get error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Which steps this user may act on right now (for UI + is advisory; server re-checks)
function computeAllowedSteps(workflow, user, request) {
    if (!request) return [];
    const allowed = [];
    for (const step of workflow.steps) {
        if (step.status === "approved" || step.status === "not_required") continue;
        if (canActOnStep(step.key, user, request, null)) allowed.push(step.key);
    }
    return allowed;
}

// Authoritative per-step permission check
function canActOnStep(stepKey, user, request, vehicle) {
    const roles = STEP_ROLE_MAP[stepKey] || [];
    if (["rto", "admin"].includes(user.role) && stepKey !== "rto-approval") {
        // RTO/admin are not allowed to forge the private seller/buyer consents either,
        // except document-verification and inspection which they may perform.
        if (!["document-verification", "inspection"].includes(stepKey) && !roles.includes(user.role)) return false;
    }
    if (!roles.includes(user.role) && user.role !== "admin") return false;
    if (stepKey === "seller-authorization") return String(request.seller) === String(user.id);
    if (stepKey === "buyer-acceptance") return String(request.buyer) === String(user.id);
    if (stepKey === "inspection" && user.role === "workshop") {
        // workshop must be affiliated with the vehicle brand (checked by caller)
        return vehicle ? true : "brand";
    }
    return true;
}

// Record a decision on one step
router.post("/:requestId/steps/:stepKey/decision", authRequired, async (req, res) => {
    try {
        const { decision, reason } = req.body; // approve | reject | not-required
        if (rejectBadRequestId(req, res)) return;
        const workflow = await TransferApprovalWorkflow.findOne({ request: req.params.requestId });
        if (!workflow) return res.status(404).json({ message: "Workflow not found. Initialize it first." });

        const request = await Request.findById(workflow.request);
        if (!request) return res.status(404).json({ message: "Linked request not found." });
        if (request.status === "approved" || request.status === "rejected") {
            return res.status(400).json({ message: "The transfer has already been finalized; the checklist is read-only." });
        }

        const step = workflow.steps.find(s => s.key === req.params.stepKey);
        if (!step) return res.status(404).json({ message: "Unknown step." });

        // Load vehicle for brand-gated inspection step
        let vehicle = null;
        if (workflow.vehicle) vehicle = await Vehicle.findById(workflow.vehicle);

        // Reject an out-of-order / unauthorized action on the server
        const perm = canActOnStep(step.key, req.user, request, vehicle);
        if (perm === "brand") {
            const dbUser = await User.findById(req.user.id);
            const affiliated = dbUser?.workshopDetails?.affiliatedManufacturer;
            if (!affiliated || normalizeManufacturer(vehicle?.make) !== normalizeManufacturer(affiliated)) {
                return res.status(403).json({ message: `Inspection is only allowed by a workshop affiliated with ${vehicle?.make}.` });
            }
        } else if (perm === false) {
            return res.status(403).json({ message: `Your role (${req.user.role}) is not authorized to decide '${step.key}', or you are not a party to this transfer.` });
        }

        if (!["approve", "reject", "not-required"].includes(decision)) {
            return res.status(400).json({ message: "Decision must be approve, reject or not-required." });
        }
        if (decision === "reject" && (!reason || !String(reason).trim())) {
            return res.status(400).json({ message: "A rejection reason is required for the audit trail." });
        }
        if (step.status === "approved") {
            return res.status(409).json({ message: "This step is already approved and cannot be changed (append-only audit)." });
        }

        const previousStatus = step.status;
        const newStatus = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "not_required";
        step.status = newStatus;
        step.actor = req.user.id;
        step.actorName = req.user.name;
        step.actorRole = req.user.role;
        step.decidedAt = new Date();
        step.reason = reason ? String(reason).trim() : null;
        step.anchor = await anchorRecord({ stepKey: step.key, newStatus, actor: req.user.id, decidedAt: step.decidedAt }, `transfer-decision ${step.key}`);

        workflow.decisions.push({ stepKey: step.key, previousStatus, newStatus, actor: req.user.id, actorName: req.user.name, actorRole: req.user.role, reason: reason || null });

        // Refresh the whole-checklist anchor whenever it advances
        const mandatory = workflow.steps.filter(s => s.required);
        const approved = mandatory.filter(s => s.status === "approved").length;
        const rejected = mandatory.filter(s => s.status === "rejected").length;
        const overall = rejected > 0 ? "blocked" : (mandatory.length && approved === mandatory.length) ? "complete" : "pending";
        workflow.workflowAnchor = await anchorRecord({ request: String(workflow.request), steps: workflow.steps.map(s => ({ key: s.key, status: s.status })), overall }, "transfer-workflow");

        await workflow.save();

        res.json({
            success: true,
            message: `Step '${step.key}' marked ${newStatus}.`,
            progress: workflow.progress,
            canFinalize: overall === "complete",
            workflow
        });
    } catch (err) {
        console.error("workflow decision error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
