// damageRoutes.js
// Feature 9: 3D Vehicle Damage & Repair Intelligence API (mounted at /api/damage).
//
// This module creates and advances a DamageAssessment that EXTENDS one existing
// accident (DamageEvent). It never duplicates the accident. Every response keeps
// the honesty boundaries the specification demands: findings show their source,
// unmapped components are not pretended to be highlighted, estimate prices come
// only from the configured catalogue, and a repair is only "verified" once real
// completion evidence and a final inspection exist.

import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import { DamageEvent } from "../models/DamageEvent.js";
import {
    DamageAssessment,
    RepairCostCatalogue,
    DAMAGE_COMPONENTS,
    nextAssessmentRef,
} from "../models/DamageAssessment.js";
import { User } from "../models/User.js";
import {
    anchorRecord,
    verifyRecordIntegrity,
    hashFileBuffer,
} from "../services/recordAnchorService.js";
import { runDamageAnalysis, ANALYSIS_LIMITATION, digestPhotoSet } from "../services/damageAnalysisService.js";
import { createNotification, createRoleNotification } from "../services/notificationService.js";
import { streamMediaFile } from "../services/accidentMediaService.js";

const router = express.Router();

// Damage photographs: images only, capped so an assessment document stays well
// inside MongoDB's 16MB limit (6 files x 1.5MB).
const photoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 1_500_000, files: 6 } });
const ALLOWED_PHOTO = ["image/jpeg", "image/png", "image/webp"];

const VIEW_ENUM = ["front", "rear", "left", "right", "close-up", "interior", "other"];

const VALID_COMPONENT = new Set(DAMAGE_COMPONENTS);

// Whoever may open the module: the owning citizen, the authorised workshop, and
// the oversight roles that review damage for resale / investigation.
const MEMBER_ROLES = ["owner", "workshop", "rto", "police", "admin"];
// Whoever may record component findings and build the estimate.
const ASSESSOR_ROLES = ["workshop", "rto", "admin"];
// Whoever may approve/reject an estimate or feed an accepted repair to the passport.
const REVIEWER_ROLES = ["rto", "admin"];

async function loadVehicle(identifier) {
    if (mongoose.isValidObjectId(identifier)) {
        const v = await Vehicle.findById(identifier).lean();
        if (v) return v;
    }
    const reg = String(identifier || "").trim().toUpperCase();
    if (!reg) return null;
    const compact = reg.replace(/[\s-]/g, "");
    return Vehicle.findOne({ $or: [{ regNumber: reg }, { regNumber: compact }] }).lean();
}

// The owner may act only on their own vehicle; officers and workshops on any.
async function canAccessVehicle(user, vehicleId) {
    if (user.role === "owner") {
        const v = await Vehicle.findById(vehicleId).select("currentOwner").lean();
        return !!v && String(v.currentOwner) === String(user.id);
    }
    return MEMBER_ROLES.includes(user.role);
}

function photoView(value) {
    const v = String(value || "").toLowerCase();
    return VIEW_ENUM.includes(v) ? v : "other";
}

// ---------------------------------------------------------------------------
// Vehicle lookup for the module (role-gated, owner-scoped for citizens)
// ---------------------------------------------------------------------------

// Resolve a registration number to the vehicle plus any accidents already on record,
// so the page opens/links an existing accident instead of creating a duplicate.
router.get("/vehicle-lookup", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        const vehicle = await loadVehicle(req.query.reg);
        if (!vehicle) return res.status(404).json({ message: "No vehicle matches that registration number." });
        if (!(await canAccessVehicle(req.user, vehicle._id))) return res.status(403).json({ message: "You may not open a damage assessment for this vehicle." });
        const [damageEvents, assessments] = await Promise.all([
            DamageEvent.find({ vehicle }).sort({ eventDate: -1 }).select("eventType eventDate description severity verificationStatus").lean(),
            DamageAssessment.find({ vehicle }).sort({ createdAt: -1 }).select("assessmentRef status createdAt").lean(),
        ]);
        res.json({
            success: true,
            vehicle: {
                id: String(vehicle._id),
                regNumber: vehicle.regNumber,
                make: vehicle.make,
                model: vehicle.model,
                year: vehicle.year,
                status: vehicle.status,
                ownerName: vehicle.ownerName || null,
            },
            damageEvents: damageEvents.map((d) => ({
                id: String(d._id),
                eventType: d.eventType,
                eventDate: d.eventDate,
                description: d.description,
                severity: d.severity,
                verificationStatus: d.verificationStatus,
            })),
            existingAssessments: assessments.map((a) => ({
                id: String(a._id), assessmentRef: a.assessmentRef, status: a.status, createdAt: a.createdAt,
            })),
        });
    } catch (err) {
        console.error("damage vehicle-lookup error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

// The configured parts + labour prices the estimate is built from.
router.get("/catalogue", authRequired, async (_req, res) => {
    try {
        const items = await RepairCostCatalogue.find({}).sort("displayName").lean();
        res.json({
            success: true,
            note: "These are the configured catalogue prices this deployment uses for estimates. They are not live market quotes.",
            items,
        });
    } catch (err) {
        console.error("damage catalogue error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ---------------------------------------------------------------------------
// Assessment lifecycle
// ---------------------------------------------------------------------------

// List a vehicle's assessments. The client uses this to open an existing one
// instead of creating a duplicate.
router.get("/assessments/vehicle/:vehicleId", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.vehicleId)) return res.status(400).json({ message: "Invalid vehicle id." });
        if (!(await canAccessVehicle(req.user, req.params.vehicleId))) return res.status(403).json({ message: "You may not view this vehicle's assessments." });
        const assessments = await DamageAssessment.find({ vehicle: req.params.vehicleId })
            .select("assessmentRef status incidentNotes suspectedArea createdAt analysis.mode photos.fileName findings.component findings.severity")
            .sort({ createdAt: -1 })
            .lean();
        const count = (field) => assessments.reduce((n, a) => n + ((a[field] || []).length), 0);
        res.json({
            success: true,
            assessments: assessments.map((a) => ({
                id: String(a._id),
                assessmentRef: a.assessmentRef,
                status: a.status,
                incidentNotes: a.incidentNotes,
                suspectedArea: a.suspectedArea,
                analysisMode: a.analysis?.mode || "none",
                photoCount: (a.photos || []).length,
                findingCount: (a.findings || []).length,
                createdAt: a.createdAt,
            })),
            totals: { photoCount: count("photos"), findingCount: count("findings") },
        });
    } catch (err) {
        console.error("damage list assessments error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Open (or create) the assessment for a vehicle. Body:
//   { vehicleId | regNumber, linkedDamageEventId?, startNewAccident?, incidentNotes?, suspectedArea? }
// Honesty: it links to an existing accident when given one; only when the caller
// explicitly asks (startNewAccident) and none is linked does it create the single
// accident record this assessment extends.
router.post("/assessments", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        const vehicle = await loadVehicle(req.body.vehicleId || req.body.regNumber);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found." });
        if (!(await canAccessVehicle(req.user, vehicle._id))) return res.status(403).json({ message: "You may not create an assessment for this vehicle." });

        let linkedEvent = null;
        if (req.body.linkedDamageEventId && mongoose.isValidObjectId(req.body.linkedDamageEventId)) {
            linkedEvent = await DamageEvent.findOne({ _id: req.body.linkedDamageEventId, vehicle: vehicle._id });
            if (!linkedEvent) return res.status(400).json({ message: "That accident record does not belong to this vehicle." });
        }

        // No accident exists and the user chose to start the case here: create the
        // one shared accident record so the passport and the assessment stay aligned.
        if (!linkedEvent && req.body.startNewAccident) {
            const submitter = await User.findById(req.user.id).select("name").lean();
            linkedEvent = new DamageEvent({
                vehicle: vehicle._id,
                regNumber: vehicle.regNumber,
                eventType: "accident-damage",
                eventDate: new Date(),
                reportDate: new Date(),
                description: String(req.body.incidentNotes || "Damage reported through the 3D assessment module.").slice(0, 2000),
                severity: "unknown",
                affectedAreas: req.body.suspectedArea ? [String(req.body.suspectedArea).slice(0, 60)] : [],
                verificationStatus: "reported",
                submittedBy: req.user.id,
                submitterName: submitter?.name || req.user.name,
                sourceChannel: req.user.role === "owner" ? "owner-upload" : "authorized-submitter",
                evidence: [],
            });
            linkedEvent.anchor = await anchorRecord(linkedEvent, "linked accident");
            await linkedEvent.save();
        }

        const assessment = new DamageAssessment({
            assessmentRef: await nextAssessmentRef(),
            vehicle: vehicle._id,
            regNumber: vehicle.regNumber,
            linkedDamageEvent: linkedEvent?._id || null,
            incidentNotes: String(req.body.incidentNotes || "").slice(0, 2000),
            suspectedArea: String(req.body.suspectedArea || "").slice(0, 120),
            submittedBy: req.user.id,
            submitterName: req.user.name,
            analysis: { mode: "none", note: "No analysis has been run yet.", limitation: ANALYSIS_LIMITATION },
        });
        await assessment.save();

        res.status(201).json({
            success: true,
            assessment: await hydrateAssessment(assessment),
            message: linkedEvent
                ? "Assessment opened and linked to the existing accident record."
                : "Assessment created. Attach photographs, then record findings.",
        });
    } catch (err) {
        console.error("damage create assessment error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Full assessment for the viewer: metadata, findings, estimate, decisions, and
// photo references (bytes are streamed separately).
router.get("/assessments/:id", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid assessment id." });
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        if (!(await canAccessVehicle(req.user, assessment.vehicle))) return res.status(403).json({ message: "You may not view this assessment." });
        res.json({ success: true, assessment: await hydrateAssessment(assessment) });
    } catch (err) {
        console.error("damage get assessment error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Stream one attached photograph (integrity is checked against its sha256).
router.get("/assessments/:id/photo/:idx", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        if (!(await canAccessVehicle(req.user, assessment.vehicle))) return res.status(403).json({ message: "Forbidden." });
        const file = assessment.photos?.[Number(req.params.idx)];
        if (!file) return res.status(404).json({ message: "Photo not found." });
        if (file.storage === "disk") {
            const streamed = await streamMediaFile(file.toObject ? file.toObject() : file, req, res);
            if (streamed) return;
            return res.status(410).json({ message: "The stored photo is no longer on this server." });
        }
        if (!file.data) return res.status(404).json({ message: "Photo bytes not found." });
        res.set("Content-Type", file.contentType || "image/jpeg");
        res.set("Cache-Control", "private, no-store");
        res.send(file.data);
    } catch (err) {
        console.error("damage photo error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Stream one completion-evidence photograph, enabling an honest before/after
// comparison against the original damage photographs in the UI.
router.get("/assessments/:id/evidence/:idx", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        if (!(await canAccessVehicle(req.user, assessment.vehicle))) return res.status(403).json({ message: "Forbidden." });
        const file = assessment.repairCompletion?.evidence?.[Number(req.params.idx)];
        if (!file) return res.status(404).json({ message: "Evidence photo not found." });
        if (file.storage === "disk") {
            const streamed = await streamMediaFile(file.toObject ? file.toObject() : file, req, res);
            if (streamed) return;
            return res.status(410).json({ message: "The stored evidence photo is no longer on this server." });
        }
        if (!file.data) return res.status(404).json({ message: "Evidence bytes not found." });
        res.set("Content-Type", file.contentType || "image/jpeg");
        res.set("Cache-Control", "private, no-store");
        res.send(file.data);
    } catch (err) {
        console.error("damage evidence error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Upload multiple damage photographs, each with a view label.
router.post("/assessments/:id/photos", authRequired, requireRole(...MEMBER_ROLES), photoUpload.array("photos", 6), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        if (!(await canAccessVehicle(req.user, assessment.vehicle))) return res.status(403).json({ message: "Forbidden." });
        if (!req.files?.length) return res.status(400).json({ message: "No photographs were received." });

        const views = [].concat(req.body.view || []);
        for (const file of req.files) {
            if (!ALLOWED_PHOTO.includes(file.mimetype)) {
                return res.status(400).json({ message: `Unsupported photo type: ${file.mimetype}. Use JPEG, PNG or WebP.` });
            }
            assessment.photos.push({
                fileName: file.originalname,
                contentType: file.mimetype,
                fileSize: file.size,
                data: file.buffer,
                sha256: hashFileBuffer(file.buffer),
                storage: "inline",
                view: photoView(views[assessment.photos.length] || views[0]),
            });
        }
        await assessment.save();
        await reAnchor(assessment);

        res.json({
            success: true,
            photoCount: assessment.photos.length,
            assessment: await hydrateAssessment(assessment),
            message: `${req.files.length} photograph(s) attached. Each is hashed so a later change can be detected.`,
        });
    } catch (err) {
        console.error("damage photos error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Run the (pluggable) damage analysis. In this deployment with no CV endpoint it
// honestly reports manual mode; a configured endpoint returns real detections.
router.post("/assessments/:id/analyze", authRequired, requireRole(...ASSESSOR_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        const result = await runDamageAnalysis(assessment);
        assessment.analysis = {
            mode: result.mode,
            ranAt: new Date(),
            engineName: result.engineName || null,
            note: result.note,
            limitation: ANALYSIS_LIMITATION,
        };
        // Only genuine model output becomes findings; manual mode adds none.
        for (const f of result.findings) {
            assessment.findings.push({
                component: VALID_COMPONENT.has(f.component) ? f.component : "other",
                label: f.label,
                detectionState: f.detectionState,
                source: "computer-vision",
                sourceDetail: assessment.analysis.engineName,
                confidence: f.confidence ?? null,
                modelOutput: f.modelOutput,
                severity: f.severity || "requires-inspection",
                recommendation: "inspect-physically",
                linkedPhotoIndex: f.linkedPhotoIndex ?? null,
                mappedTo3D: VALID_COMPONENT.has(f.component),
                assessedBy: req.user.id,
                assessedByName: req.user.name,
            });
        }
        if (assessment.status === "draft") assessment.status = "assessed";
        await assessment.save();
        await reAnchor(assessment);
        res.json({ success: true, analysis: assessment.analysis, assessment: await hydrateAssessment(assessment) });
    } catch (err) {
        console.error("damage analyze error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Record or correct one component finding (the assessor's decision). A correction
// keeps the original value in the finding's audit trail.
router.post("/assessments/:id/findings", authRequired, requireRole(...ASSESSOR_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        const component = String(req.body.component || "");
        if (!VALID_COMPONENT.has(component)) return res.status(400).json({ message: "Unknown component." });

        const SEVERITIES = ["no-visible-damage", "minor", "moderate", "severe", "requires-inspection", "inconclusive"];
        const ACTIONS = ["repair", "replace", "inspect-physically", "specialist-assessment", "no-action"];
        const severity = SEVERITIES.includes(req.body.severity) ? req.body.severity : "inconclusive";
        const recommendation = ACTIONS.includes(req.body.recommendation) ? req.body.recommendation : "inspect-physically";

        const existing = req.body.findingId
            ? assessment.findings.id(req.body.findingId)
            : assessment.findings.find((f) => f.component === component);

        if (existing && req.body.correct) {
            // Append the prior values, then apply the correction. The first result
            // stays visible; nothing is silently erased.
            const recordCorrection = (field, prev, next) => {
                if (String(prev) !== String(next)) {
                    existing.corrections.push({ field, previousValue: prev, newValue: next, reason: req.body.reason || "Assessor correction", correctedBy: req.user.id, correctedByName: req.user.name });
                }
            };
            recordCorrection("severity", existing.severity, severity);
            recordCorrection("recommendation", existing.recommendation, recommendation);
            recordCorrection("detectionState", existing.detectionState, req.body.detectionState || existing.detectionState);
            existing.severity = severity;
            existing.recommendation = recommendation;
            if (req.body.detectionState) existing.detectionState = req.body.detectionState;
            if (Number.isInteger(req.body.linkedPhotoIndex)) existing.linkedPhotoIndex = req.body.linkedPhotoIndex;
            if (typeof req.body.inspectorNotes === "string") existing.inspectorNotes = req.body.inspectorNotes.slice(0, 1000);
        } else if (existing) {
            existing.severity = severity;
            existing.recommendation = recommendation;
            if (typeof req.body.inspectorNotes === "string") existing.inspectorNotes = req.body.inspectorNotes.slice(0, 1000);
        } else {
            assessment.findings.push({
                component,
                label: String(req.body.label || `${component} assessment`).slice(0, 160),
                detectionState: ["detected", "needs-review", "not-assessed"].includes(req.body.detectionState) ? req.body.detectionState : "needs-review",
                source: "manual-inspection",
                sourceDetail: `${req.user.name} (${req.user.role}) reviewed the photographs`,
                severity,
                recommendation,
                linkedPhotoIndex: Number.isInteger(req.body.linkedPhotoIndex) ? req.body.linkedPhotoIndex : null,
                inspectorNotes: String(req.body.inspectorNotes || "").slice(0, 1000),
                mappedTo3D: component !== "other",
                assessedBy: req.user.id,
                assessedByName: req.user.name,
            });
        }

        if (assessment.status === "draft" || assessment.status === "assessed") assessment.status = "assessed";
        await assessment.save();
        await reAnchor(assessment);
        res.json({ success: true, assessment: await hydrateAssessment(assessment), message: "Component assessment recorded." });
    } catch (err) {
        console.error("damage findings error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Generate an itemized estimate from the findings and the configured catalogue.
// Any component without a catalogue price is flagged, never given an invented cost.
router.post("/assessments/:id/estimate", authRequired, requireRole(...ASSESSOR_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        if (!assessment.findings.length) return res.status(400).json({ message: "Record at least one component finding before generating an estimate." });

        const catalogue = await RepairCostCatalogue.find({}).lean();
        const byComponent = Object.fromEntries(catalogue.map((c) => [c.component, c]));

        const actionable = assessment.findings.filter((f) => f.recommendation === "repair" || f.recommendation === "replace");
        const items = [];
        for (const f of actionable) {
            const cat = byComponent[f.component];
            if (!cat) {
                items.push({ component: f.component, findingLabel: f.label, proposedAction: f.recommendation, partsCost: 0, labourCost: 0, additionalCost: 0, total: 0, priceBasis: "none", note: "No configured catalogue price for this component - obtain a workshop quotation before pricing." });
                continue;
            }
            const isReplace = f.recommendation === "replace";
            const partsCost = isReplace ? cat.replacePart : 0;
            const labourCost = isReplace ? cat.replaceLabour : cat.repairLabour;
            items.push({
                component: f.component,
                findingLabel: f.label,
                proposedAction: f.recommendation,
                partsCost,
                labourCost,
                additionalCost: 0,
                total: partsCost + labourCost,
                catalogueRef: cat.component,
                priceBasis: "configured-catalogue",
                note: `Catalogue base price for ${cat.displayName}. Estimate only - not a guaranteed final bill.`,
            });
        }

        const sum = (k) => items.reduce((n, it) => n + (it[k] || 0), 0);
        const nextVersion = assessment.estimate?.version ? assessment.estimate.version + 1 : 1;
        // Preserve the previous estimate before replacing it.
        if (assessment.estimate && assessment.estimate.items) {
            assessment.estimateHistory.push(JSON.parse(JSON.stringify(assessment.estimate)));
        }
        assessment.estimate = {
            version: nextVersion,
            currency: "INR",
            items,
            partsTotal: sum("partsCost"),
            labourTotal: sum("labourCost"),
            additionalTotal: sum("additionalCost"),
            grandTotal: sum("total"),
            status: "submitted",
            createdBy: req.user.id,
            createdByName: req.user.name,
            createdAt: new Date(),
            note: "An estimate, not a guaranteed final bill. Prices come only from the configured catalogue.",
        };
        assessment.status = "submitted";
        assessment.decisions.push({ stage: "estimate-approved", decision: "recorded", reason: `Estimate v${nextVersion} submitted for review`, by: req.user.id, byName: req.user.name, byRole: req.user.role });
        await assessment.save();
        await reAnchor(assessment);

        await createRoleNotification({ type: "damage_estimate", title: "Repair estimate ready for review", message: `Assessment ${assessment.assessmentRef} has an estimate awaiting an authorised reviewer.`, role: "rto", relatedVehicle: assessment.vehicle });
        res.json({ success: true, assessment: await hydrateAssessment(assessment), message: `Estimate v${nextVersion} generated from the configured catalogue.` });
    } catch (err) {
        console.error("damage estimate error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Reviewer decision on the estimate: approve, reject, or request more evidence.
router.post("/assessments/:id/review", authRequired, requireRole(...REVIEWER_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        const decision = String(req.body.decision || "");
        if (!["approve", "reject", "request-evidence"].includes(decision)) return res.status(400).json({ message: "Choose approve, reject or request-evidence." });

        const stage = decision === "approve" ? "estimate-approved" : decision === "reject" ? "estimate-rejected" : "evidence-requested";
        if (assessment.estimate) assessment.estimate.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : assessment.estimate.status;
        assessment.status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "under-review";
        assessment.decisions.push({ stage, decision: decision === "request-evidence" ? "requested" : decision === "approve" ? "approved" : "rejected", reason: String(req.body.reason || "").slice(0, 500), by: req.user.id, byName: req.user.name, byRole: req.user.role });
        await assessment.save();
        await reAnchor(assessment);

        await createNotification({ type: "damage_review", title: `Assessment ${assessment.assessmentRef} ${assessment.status}`, message: String(req.body.reason || "An authorised reviewer updated the assessment."), recipient: assessment.submittedBy, recipientRole: await submitterRole(assessment), relatedVehicle: assessment.vehicle, actionUrl: "/damage" });
        res.json({ success: true, assessment: await hydrateAssessment(assessment), message: "Review decision recorded." });
    } catch (err) {
        console.error("damage review error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Workshop records the actual completed work with evidence photographs. A final
// inspection is separate; only a passed inspection with evidence marks verification.
router.post("/assessments/:id/repair-completion", authRequired, requireRole(...ASSESSOR_ROLES), photoUpload.array("evidence", 6), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        if (assessment.status !== "approved") return res.status(400).json({ message: "The estimate must be approved before completion evidence is recorded." });

        const evidence = [];
        for (const file of req.files || []) {
            if (!ALLOWED_PHOTO.includes(file.mimetype)) return res.status(400).json({ message: `Unsupported evidence type: ${file.mimetype}.` });
            evidence.push({ fileName: file.originalname, contentType: file.mimetype, fileSize: file.size, data: file.buffer, sha256: hashFileBuffer(file.buffer), storage: "inline", view: photoView(req.body.view) });
        }
        if (!evidence.length) return res.status(400).json({ message: "Attach at least one completion photograph; a proposed estimate is not proof of finished work." });

        assessment.repairCompletion = assessment.repairCompletion || {};
        assessment.repairCompletion.workshop = String(req.body.workshop || req.user.name).slice(0, 160);
        assessment.repairCompletion.technician = String(req.body.technician || "").slice(0, 120);
        assessment.repairCompletion.completedAt = req.body.completedAt ? new Date(req.body.completedAt) : new Date();
        assessment.repairCompletion.workSummary = String(req.body.workSummary || "").slice(0, 1500);
        assessment.repairCompletion.evidence = evidence;
        assessment.repairCompletion.finalInspection = "pending";
        assessment.repairCompletion.verified = false;
        assessment.repairCompletion.note = "Completion evidence recorded. Verification requires a passed final inspection.";
        assessment.status = "repair-completed";
        assessment.decisions.push({ stage: "repair-completed", decision: "recorded", reason: "Workshop submitted completion evidence", by: req.user.id, byName: req.user.name, byRole: req.user.role });
        await assessment.save();
        await reAnchor(assessment);
        res.json({ success: true, assessment: await hydrateAssessment(assessment), message: "Completion evidence recorded; awaiting final inspection." });
    } catch (err) {
        console.error("damage completion error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Final inspection decision. A passed inspection with completion evidence is the
// only path to "verified", and it then feeds the Damage and Repair Passport.
router.post("/assessments/:id/final-inspection", authRequired, requireRole(...REVIEWER_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        const outcome = String(req.body.outcome || "");
        if (!["passed", "failed"].includes(outcome)) return res.status(400).json({ message: "Record the inspection as passed or failed." });

        assessment.repairCompletion.finalInspection = outcome;
        assessment.repairCompletion.inspectedBy = req.user.id;
        assessment.decisions.push({ stage: "final-inspection", decision: outcome === "passed" ? "approved" : "rejected", reason: String(req.body.reason || "Final inspection " + outcome), by: req.user.id, byName: req.user.name, byRole: req.user.role });

        const hasEvidence = (assessment.repairCompletion.evidence || []).length > 0;
        if (outcome === "passed" && hasEvidence) {
            assessment.repairCompletion.verified = true;
            assessment.status = "verified";
            // Feed the accepted repair into the Damage and Repair Passport - the
            // single place accident/repair history is preserved.
            if (assessment.linkedDamageEvent) {
                const ev = await DamageEvent.findById(assessment.linkedDamageEvent);
                if (ev) {
                    ev.verificationStatus = "verified";
                    ev.verifiedBy = req.user.id;
                    ev.verifiedAt = new Date();
                    ev.officerReview = { outcome: "verified", remarks: `Repair verified via assessment ${assessment.assessmentRef}.`, reviewedBy: req.user.id, reviewedByName: req.user.name, reviewedByRole: req.user.role, reviewedAt: new Date() };
                    await ev.save();
                }
            }
            assessment.decisions.push({ stage: "fed-to-passport", decision: "recorded", reason: "Accepted repair reflected in the Damage and Repair Passport", by: req.user.id, byName: req.user.name, byRole: req.user.role });
        } else {
            assessment.status = outcome === "failed" ? "under-review" : "repair-completed";
            assessment.repairCompletion.note = outcome === "passed" ? "Inspection passed but no completion evidence is attached, so the repair is not verified." : "Final inspection failed; the repair is not verified.";
        }

        await assessment.save();
        await reAnchor(assessment);
        await createNotification({ type: "damage_verified", title: `Assessment ${assessment.assessmentRef} inspection ${outcome}`, message: String(req.body.reason || "A final inspection was recorded."), recipient: assessment.submittedBy, recipientRole: await submitterRole(assessment), relatedVehicle: assessment.vehicle, actionUrl: "/damage" });
        res.json({ success: true, assessment: await hydrateAssessment(assessment), message: outcome === "passed" && hasEvidence ? "Repair verified and reflected in the damage passport." : "Inspection recorded." });
    } catch (err) {
        console.error("damage final inspection error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Integrity re-check of an assessment and its photographs.
router.get("/assessments/:id/verify-integrity", authRequired, requireRole(...MEMBER_ROLES), async (req, res) => {
    try {
        const assessment = await DamageAssessment.findById(req.params.id);
        if (!assessment) return res.status(404).json({ message: "Assessment not found." });
        const record = verifyRecordIntegrity(assessment);
        const photos = (assessment.photos || []).map((p, i) => {
            if (!p.data) return { index: i, fileName: p.fileName, verified: null, note: "Bytes stored off-document; the recorded hash remains on file." };
            const current = hashFileBuffer(p.data);
            return { index: i, fileName: p.fileName, verified: current === p.sha256, note: current === p.sha256 ? "Photo matches its recorded hash." : "Photo no longer matches its hash." };
        });
        res.json({ success: true, record, photos, note: "A matching hash proves the content has not changed since it was hashed. It does not prove the assessment was truthful or that the vehicle is roadworthy." });
    } catch (err) {
        console.error("damage verify error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Re-hash the assessment content after each meaningful change. anchorRecord never
// throws; without chain configuration it stays "hashed_only" honestly.
async function reAnchor(assessment) {
    const anchor = await anchorRecord(assessment, `assessment ${assessment.assessmentRef}`);
    assessment.anchor = anchor;
    await assessment.save();
}

// A notification must name the recipient's role or the model rejects it, so the
// assessor's account is looked up once per alert.
async function submitterRole(assessment) {
    const u = await User.findById(assessment.submittedBy).select("role").lean();
    return u?.role || "workshop";
}

// Build the JSON the viewer consumes: photo references (no bytes), findings with
// their 3D mapping flag, the estimate, decisions and integrity.
async function hydrateAssessment(assessment) {
    const a = assessment.toObject ? assessment.toObject() : assessment;
    return {
        id: String(a._id),
        assessmentRef: a.assessmentRef,
        vehicle: String(a.vehicle),
        regNumber: a.regNumber,
        linkedDamageEvent: a.linkedDamageEvent ? String(a.linkedDamageEvent) : null,
        status: a.status,
        incidentNotes: a.incidentNotes,
        suspectedArea: a.suspectedArea,
        analysis: a.analysis || { mode: "none" },
        photoSetDigest: digestPhotoSet(a.photos),
        photos: (a.photos || []).map((p, i) => ({ index: i, fileName: p.fileName, view: p.view, contentType: p.contentType, fileSize: p.fileSize, sha256: p.sha256, url: `/damage/assessments/${a._id}/photo/${i}` })),
        findings: (a.findings || []).map((f) => ({
            id: String(f._id), component: f.component, label: f.label, detectionState: f.detectionState,
            source: f.source, sourceDetail: f.sourceDetail, confidence: f.confidence ?? null, modelOutput: f.modelOutput || null,
            severity: f.severity, recommendation: f.recommendation, linkedPhotoIndex: f.linkedPhotoIndex ?? null,
            inspectorNotes: f.inspectorNotes || null, mappedTo3D: !!f.mappedTo3D, assessedByName: f.assessedByName || null,
            corrections: (f.corrections || []).map((c) => ({ field: c.field, previousValue: c.previousValue, newValue: c.newValue, reason: c.reason, correctedByName: c.correctedByName, correctedAt: c.correctedAt })),
        })),
        estimate: a.estimate || null,
        estimateHistory: a.estimateHistory || [],
        decisions: (a.decisions || []).map((d) => ({ stage: d.stage, decision: d.decision, reason: d.reason, byName: d.byName, byRole: d.byRole, at: d.at })),
        repairCompletion: a.repairCompletion ? {
            workshop: a.repairCompletion.workshop, technician: a.repairCompletion.technician, completedAt: a.repairCompletion.completedAt,
            workSummary: a.repairCompletion.workSummary, finalInspection: a.repairCompletion.finalInspection, verified: !!a.repairCompletion.verified,
            note: a.repairCompletion.note, evidenceCount: (a.repairCompletion.evidence || []).length,
            evidence: (a.repairCompletion.evidence || []).map((e, i) => ({ index: i, fileName: e.fileName, sha256: e.sha256, view: e.view, url: `/damage/assessments/${a._id}/evidence/${i}` })),
        } : null,
        appearancePreview: a.appearancePreview?.available ? a.appearancePreview : { available: false },
        anchor: a.anchor || null,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
    };
}

export default router;
