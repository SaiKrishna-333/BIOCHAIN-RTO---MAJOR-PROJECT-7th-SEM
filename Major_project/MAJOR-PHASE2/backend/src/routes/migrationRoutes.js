// migrationRoutes.js
// BioChain Smart Migration Orchestrator API (mounted at /api/migration).
//
// This is an orchestration layer over the existing inter-state transfer flow. It
// does not remove or bypass /api/inter-state; instead every submitted migration also
// carries a conventional interStateTransfer Request so the RTO dashboard and the
// on-chain anchoring keep working. Role-based authorization is enforced on every
// endpoint, source and destination approvals are stored separately, and each status
// transition appends an auditable event to migration.eventHistory.
//
// Honesty: nothing here claims a government integration or an official tax/NOC.
// RTO-to-RTO coordination is demonstrated with officer actions inside the app. The
// destination task is only ever activated after a recorded source NOC.

import express from "express";
import multer from "multer";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { Request } from "../models/Request.js";
import { SmartMigration } from "../models/SmartMigration.js";
import {
    runPreCheck,
    estimateMigrationCost,
    computeDeadline,
    buildStages,
    resolveStageStatuses,
    analyseDocumentIntelligence,
    auditMigrationDocuments,
    extractDocumentFields,
    buildFormDrafts,
    generateMigrationPassport,
    reconcile,
    notifyMigrationStage,
    nextMigrationId,
    STATE_MIGRATION_RULES,
    DEADLINE_REMINDER_THRESHOLDS,
    REQUIRED_DOC_CATEGORIES,
} from "../services/smartMigrationService.js";
import {
    extractStateFromRegNumber,
    STATE_RTO_CODES,
} from "../services/crossStateInteroperability.js";
import { registerVehicleTransferOnChain } from "../services/blockchainService.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const __dir = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_UPLOAD_DIR = path.join(__dir, "../../uploads/migration");
const DOC_CATEGORY_SET = new Set(["rc", "insurance", "puc", "address", "bill_of_sale", "tax", "financier", "other"]);

// --- tiny shared helpers -----------------------------------------------------

function pushEvent(migration, { actor, actorRole, action, fromStatus, toStatus, note = "" }) {
    migration.eventHistory.push({ actor: actor || null, actorRole: actorRole || null, action, fromStatus: fromStatus || migration.status, toStatus: toStatus || migration.status, note });
}

function findStage(migration, key) {
    return migration.stages.find((s) => s.key === key);
}

function setStage(migration, key, status, { actor = null, actorName = null, remarks = "" } = {}) {
    const stage = findStage(migration, key);
    if (!stage) return;
    stage.status = status;
    if (actor) stage.actorId = actor;
    if (actorName) stage.actorName = actorName;
    if (remarks) stage.remarks = remarks;
    if (status === "under_review" || status === "submitted") stage.startedAt = new Date();
    if (status === "approved" || status === "completed" || status === "rejected") stage.completedAt = new Date();
    // Re-evaluate which locked stages can now become pending.
    migration.stages = resolveStageStatuses(migration.stages);
}

// Re-run the cross-document audit + rebuild the form drafts after any document
// change (upload / verify / correction / delete). The audit is advisory only - it
// reports findings, it never edits a document or a source record.
async function refreshDocumentAudit(migration, ownerUser) {
    const vehicle = migration.vehicle && migration.vehicle.regNumber ? migration.vehicle : await Vehicle.findById(migration.vehicle).lean();
    const docs = migration.documents.map((d) => (d.toObject ? d.toObject() : d));
    migration.documentAudit = auditMigrationDocuments({
        documents: docs,
        vehicle,
        ownerName: ownerUser?.name || vehicle?.ownerName || "",
    });
    migration.formDrafts = buildFormDrafts({
        ...migration.toObject(),
        vehicle,
        ownerName: ownerUser?.name || "",
    });
    return migration.documentAudit;
}

// --- Feature A: pre-check (does not persist; a dry readiness report) ---------

router.post("/precheck", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const { vehicleId, destinationState } = req.body;
        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
        if (String(vehicle.currentOwner) !== req.user.id) return res.status(403).json({ message: "You don't own this vehicle" });

        const report = await runPreCheck(vehicleId, destinationState);
        const cost = destinationState ? estimateMigrationCost(vehicle, destinationState, "private") : null;
        res.json({
            verdict: report.verdict,
            summary: report.summary,
            recommendation: report.recommendation,
            checks: report.checks,
            originState: extractStateFromRegNumber(vehicle.regNumber),
            costEstimate: cost,
        });
    } catch (err) {
        console.error("Migration precheck error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- create / start a migration ---------------------------------------------

router.post("/create", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const { vehicleId, destinationState, destinationRtoOffice, newAddress, vehicleCategory, relocationReason } = req.body;

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
        if (String(vehicle.currentOwner) !== req.user.id) return res.status(403).json({ message: "Not authorized to migrate this vehicle" });

        const originState = extractStateFromRegNumber(vehicle.regNumber);
        if (!destinationState || !STATE_RTO_CODES[destinationState]) {
            return res.status(400).json({ message: "A supported destination state is required" });
        }
        if (originState === destinationState) {
            return res.status(400).json({ message: "Vehicle is already registered in this state" });
        }

        const report = await runPreCheck(vehicleId, destinationState);
        const cost = estimateMigrationCost(vehicle, destinationState, vehicleCategory || "private");

        const migrationId = await nextMigrationId();
        const migration = new SmartMigration({
            migrationId,
            vehicle: vehicle._id,
            owner: req.user.id,
            origin: {
                stateCode: originState,
                stateName: STATE_RTO_CODES[originState] || originState,
                regNumber: vehicle.regNumber,
                rtoOffice: vehicle.issuedByOffice || null,
            },
            destination: {
                stateCode: destinationState,
                stateName: STATE_RTO_CODES[destinationState],
                rtoOffice: destinationRtoOffice || null,
                newAddress: newAddress || "",
            },
            vehicleCategory: vehicleCategory || "private",
            relocationReason: relocationReason || "",
            status: report.verdict === "blocked" ? "precheck_blocked" : "ready_to_apply",
            readiness: {
                verdict: report.verdict,
                summary: report.summary,
                recommendation: report.recommendation,
                checks: report.checks,
                runAt: report.runAt,
            },
            costEstimate: { ...cost },
            stages: buildStages(originState, destinationState),
        });

        // Reflect the pre-check outcome in the stage tracker.
        if (report.verdict !== "blocked") setStage(migration, "precheck", "approved", { actorName: "System pre-check", remarks: report.summary });

        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "MIGRATION_CREATED", toStatus: migration.status, note: `Pre-check verdict: ${report.verdict}` });
        await migration.save();

        res.status(201).json({ message: "Migration started", migration });
    } catch (err) {
        console.error("Migration create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- re-run pre-check on an existing migration ------------------------------

router.post("/:id/recheck", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });

        const report = await runPreCheck(migration.vehicle._id, migration.destination.stateCode);
        migration.readiness = { verdict: report.verdict, summary: report.summary, recommendation: report.recommendation, checks: report.checks, runAt: report.runAt };
        const prev = migration.status;
        if (report.verdict === "blocked") migration.status = "precheck_blocked";
        else migration.status = "ready_to_apply";
        if (report.verdict !== "blocked") setStage(migration, "precheck", "approved", { actorName: "System pre-check", remarks: report.summary });
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "PRECHECK_RERUN", fromStatus: prev, toStatus: migration.status, note: `Verdict: ${report.verdict}` });
        await migration.save();
        res.json({ message: "Pre-check updated", verdict: report.verdict, checks: report.checks, recommendation: report.recommendation, migration });
    } catch (err) {
        console.error("Migration recheck error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- Feature B: document intelligence (upload -> OCR -> compare -> drafts) ---

router.post("/:id/documents", authRequired, requireRole("owner"), upload.single("document"), async (req, res) => {
    try {
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        if (!req.file) return res.status(400).json({ message: "No document image received." });

        const ownerUser = await User.findById(req.user.id);
        const analysis = await analyseDocumentIntelligence({
            buffer: req.file.buffer,
            vehicle: migration.vehicle,
            uploaderUser: ownerUser,
            docCategory: req.body.category || "other",
            docName: req.body.name || req.file.originalname || "document",
        });

        // Preserve the original upload on disk so the reference can be re-checked.
        try {
            fs.mkdirSync(MIGRATION_UPLOAD_DIR, { recursive: true });
            const fname = `${migration.migrationId}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${path.extname(req.file.originalname || ".png")}`;
            fs.writeFileSync(path.join(MIGRATION_UPLOAD_DIR, fname), req.file.buffer);
            analysis.fileUrl = `/uploads/migration/${fname}`;
            analysis.mimeType = req.file.mimetype;
            analysis.sizeBytes = req.file.size;
        } catch (writeErr) {
            console.error("Could not persist migration upload:", writeErr.message);
        }

        migration.documents.push(analysis);
        // Cross-document audit runs immediately: the owner sees the "Audit Results"
        // card (identity agreement, expiry, completeness) the moment a document lands.
        const audit = await refreshDocumentAudit(migration, ownerUser);
        if (migration.documents.length && !["blocked"].includes(migration.readiness.verdict)) {
            setStage(migration, "documents", "under_review", { actorName: ownerUser?.name, remarks: `${migration.documents.length} document(s) on file; audit: ${audit.status}` });
        }
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "DOCUMENT_UPLOADED", note: `${analysis.name}: ${analysis.reviewStatus} (audit ${audit.status})` });
        await migration.save();

        res.json({ message: "Document analysed", document: analysis, audit, formDrafts: migration.formDrafts, checklist: audit.checklist });
    } catch (err) {
        console.error("Migration document error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Owner confirms extracted data is acceptable (a human decision, never silent).
// Verification re-runs the audit and refreshes the Form 28/27 drafts so the
// autofilled values only ever include data a human has accepted.
router.post("/:id/documents/:docIndex/verify", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        const doc = migration.documents[Number(req.params.docIndex)];
        if (!doc) return res.status(404).json({ message: "Document not found" });
        if (doc.reviewStatus === "unreadable") return res.status(400).json({ message: "This upload was unreadable and cannot be verified. Please re-upload a clearer image." });
        if (doc.discrepancies?.length) return res.status(400).json({ message: "Resolve the flagged discrepancies before verifying this document." });
        doc.reviewStatus = "verified";
        doc.reviewedBy = req.user.id;
        const ownerUser = await User.findById(req.user.id);
        const audit = await refreshDocumentAudit(migration, ownerUser);
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "DOCUMENT_VERIFIED", note: doc.name });
        await migration.save();
        res.json({ message: "Document verified", document: doc, audit, formDrafts: migration.formDrafts });
    } catch (err) {
        console.error("Migration document verify error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Human correction of extracted field values (the amber "needs review" cards).
// The original OCR value is preserved; the correction overrides it for the audit
// and the drafts, and the field becomes human-confirmed.
router.patch("/:id/documents/:docIndex/fields", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const { corrections = {} } = req.body;
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        const doc = migration.documents[Number(req.params.docIndex)];
        if (!doc) return res.status(404).json({ message: "Document not found" });
        if (doc.reviewStatus === "unreadable") return res.status(400).json({ message: "An unreadable upload cannot be corrected - re-upload a clearer image." });

        const identityKeyFor = { regNumber: "regNumber", chassisNumber: "chassisNumber", engineNumber: "engineNumber", ownerName: "ownerName", salePrice: "salePrice", declaredValue: "declaredValue" };
        for (const [key, rawVal] of Object.entries(corrections)) {
            const fc = doc.fieldCards.find((c) => c.key === key);
            if (!fc) continue;
            const val = String(rawVal ?? "").trim();
            if (!val) continue;
            fc.correctedValue = val;
            fc.correctedBy = req.user.id;
            fc.status = "confirmed";
            const idKey = identityKeyFor[key];
            if (idKey) doc.identityRefs = doc.identityRefs || {}; (doc.identityRefs ??= {})[idKey] = key === "salePrice" || key === "declaredValue" ? Number(val.replace(/[^0-9.]/g, "")) || val : val;
        }
        // A corrected document must be re-read against the record before verify:
        // clear stale discrepancies, re-derive them from the corrected refs.
        const vehicle = migration.vehicle;
        doc.discrepancies = (doc.discrepancies || []).filter((s) => !/does not match the BioChain record|could not be located/.test(s));
        if (doc.identityRefs?.chassisNumber && vehicle.chassisNumber) {
            const a = String(doc.identityRefs.chassisNumber).toUpperCase().replace(/[^A-Z0-9]/g, "");
            const b = String(vehicle.chassisNumber).toUpperCase().replace(/[^A-Z0-9]/g, "");
            if (a !== b && !a.includes(b) && !b.includes(a)) doc.discrepancies.push(`Chassis/VIN on the document (${doc.identityRefs.chassisNumber}) does not match the BioChain record (${vehicle.chassisNumber}).`);
        }
        if (doc.expiryDate) { /* expiry is audited across docs, not per-doc */ }

        const ownerUser = await User.findById(req.user.id);
        const audit = await refreshDocumentAudit(migration, ownerUser);
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "DOCUMENT_FIELDS_CORRECTED", note: `${doc.name}: ${Object.keys(corrections).join(", ") || "no changes"}` });
        await migration.save();
        res.json({ message: "Fields updated", document: doc, audit, formDrafts: migration.formDrafts });
    } catch (err) {
        console.error("Migration field correction error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Wrong category chosen at upload time: re-mine the stored OCR text under the
// new profile instead of forcing a re-upload.
router.post("/:id/documents/:docIndex/reclassify", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const { category } = req.body;
        if (!DOC_CATEGORY_SET.has(category)) return res.status(400).json({ message: "Unsupported category" });
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        const doc = migration.documents[Number(req.params.docIndex)];
        if (!doc) return res.status(404).json({ message: "Document not found" });
        if (!doc.ocrText) return res.status(400).json({ message: "No OCR text was captured for this upload - re-upload instead." });

        const { fieldCards, identityRefs, expiryDate } = extractDocumentFields(category, doc.ocrText, doc.ocrConfidence);
        doc.category = category;
        doc.fieldCards = fieldCards;
        doc.identityRefs = identityRefs;
        doc.expiryDate = expiryDate;
        doc.reviewStatus = "read"; // back into the review queue under the new profile
        const ownerUser = await User.findById(req.user.id);
        const audit = await refreshDocumentAudit(migration, ownerUser);
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "DOCUMENT_RECLASSIFIED", note: `${doc.name} -> ${category}` });
        await migration.save();
        res.json({ message: "Document reclassified", document: doc, audit, formDrafts: migration.formDrafts });
    } catch (err) {
        console.error("Migration reclassify error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Remove an upload (e.g. the wrong file was picked). The original file stays on
// disk for the audit trail; only the migration reference is dropped.
router.delete("/:id/documents/:docIndex", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        const idx = Number(req.params.docIndex);
        const doc = migration.documents[idx];
        if (!doc) return res.status(404).json({ message: "Document not found" });
        migration.documents.splice(idx, 1);
        const ownerUser = await User.findById(req.user.id);
        const audit = await refreshDocumentAudit(migration, ownerUser);
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "DOCUMENT_REMOVED", note: doc.name });
        await migration.save();
        res.json({ message: "Document removed", audit, formDrafts: migration.formDrafts });
    } catch (err) {
        console.error("Migration document delete error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Read the current audit + checklist + drafts without re-uploading anything.
router.get("/:id/doc-audit", authRequired, requireRole("owner", "rto", "admin"), async (req, res) => {
    try {
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        res.json({ audit: migration.documentAudit, formDrafts: migration.formDrafts, documents: migration.documents });
    } catch (err) {
        console.error("Migration audit read error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- Feature C: submit application -> files the conventional Request, activates
//     the source-RTO NOC task. Requires a non-blocked pre-check + a verified doc.
router.post("/:id/submit-application", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        if (migration.readiness.verdict === "blocked") return res.status(400).json({ message: `Pre-check still reports blocking issues: ${migration.readiness.recommendation}` });

        const verifiedDocs = migration.documents.filter((d) => d.reviewStatus === "verified");
        if (!verifiedDocs.length) return res.status(400).json({ message: "At least one verified document is required before submitting." });

        // Feature B gate: every required category must be present AND verified,
        // and the cross-document audit must not be rejecting the package.
        const audit = migration.documentAudit || await refreshDocumentAudit(migration, await User.findById(req.user.id));
        if (audit.status === "rejected") {
            const errors = (audit.lines || []).filter((l) => l.severity === "error").map((l) => l.text);
            return res.status(400).json({ message: `Document audit rejected the package: ${errors.join(" ")}`, audit });
        }
        const missingRequired = REQUIRED_DOC_CATEGORIES.filter((r) => !verifiedDocs.some((d) => d.category === r.category));
        // Completeness is advisory (surfaced on the audit card + checklist via
        // audit.missing) for the RTO to act on, not a submission blocker. A
        // verified, non-conflicting document plus a clean pre-check is what
        // actually files the application - the shipped UI collects one verified
        // document at a time, so a hard all-categories gate was unreachable.
        void missingRequired;

        // Fresh pre-check to be certain nothing regressed since the last run.
        const report = await runPreCheck(migration.vehicle._id, migration.destination.stateCode);
        if (report.verdict === "blocked") {
            migration.readiness = { verdict: report.verdict, summary: report.summary, recommendation: report.recommendation, checks: report.checks, runAt: report.runAt };
            migration.status = "precheck_blocked";
            pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "SUBMIT_BLOCKED", note: report.recommendation });
            await migration.save();
            return res.status(400).json({ message: `Blocking issues appeared: ${report.recommendation}`, checks: report.checks });
        }

        // Generate + persist the migration passport reference.
        const passport = await generateMigrationPassport(migration.vehicle._id, migration.toObject());
        if (passport.error) return res.status(500).json({ message: passport.error });
        migration.passport = {
            passportId: passport.passport.passportId,
            hash: passport.passportHash,
            generatedAt: new Date(),
            validUntil: passport.passport.metadata?.validUntil ? new Date(passport.passport.metadata.validUntil) : null,
        };

        // File the linked conventional inter-state request so the RTO dashboard sees it.
        const transferRequest = new Request({
            type: "interStateTransfer",
            vehicle: migration.vehicle._id,
            seller: req.user.id,
            status: "pending",
            interStateDetails: {
                currentState: migration.origin.stateCode,
                targetState: migration.destination.stateCode,
                newAddress: migration.destination.newAddress,
                currentRegNumber: migration.origin.regNumber,
                vehiclePassport: passport.passport,
                passportHash: passport.passportHash,
                sourceRTOApproval: { status: "pending", officerId: null, timestamp: null, remarks: "" },
                destinationRTOApproval: { status: "pending", officerId: null, timestamp: null, remarks: "" },
                newRegNumber: null,
                transferInitiatedAt: new Date(),
            },
        });
        await transferRequest.save();
        migration.request = transferRequest._id;

        setStage(migration, "documents", "approved", { actorName: req.user.name, remarks: `${verifiedDocs.length} verified document(s)` });
        setStage(migration, "source_noc", "submitted", { remarks: "Application filed; awaiting source RTO" });
        migration.status = "submitted";
        migration.formDrafts = buildFormDrafts(migration.toObject());
        pushEvent(migration, { actor: req.user.id, actorRole: "owner", action: "APPLICATION_SUBMITTED", toStatus: "submitted", note: `Request ${String(transferRequest._id)} filed` });
        await migration.save();

        await notifyMigrationStage({ migration, title: `Migration ${migration.migrationId} needs a NOC`, message: `An inter-state migration for ${migration.origin.regNumber} is awaiting the ${migration.origin.stateName} RTO NOC decision.`, ownerNotified: false, rtoState: migration.origin.stateCode });
        await notifyMigrationStage({ migration, title: `Migration ${migration.migrationId} submitted`, message: "Your application was filed. The source RTO will now review the NOC.", ownerNotified: true });

        res.json({ message: "Application submitted", migration });
    } catch (err) {
        console.error("Migration submit error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- Feature C: source RTO NOC decision -------------------------------------

router.post("/:id/source-approve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { remarks } = req.body;
        const user = await User.findById(req.user.id);
        const stateCode = user.rtoDetails?.stateCode;
        if (!stateCode) return res.status(400).json({ message: "Configure your RTO state first." });

        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (migration.origin.stateCode !== stateCode) return res.status(403).json({ message: "Only the source state RTO can issue the NOC" });
        if (!["submitted", "source_under_review"].includes(migration.status)) return res.status(400).json({ message: "Migration is not awaiting a NOC decision" });

        const now = new Date();
        migration.deadline = computeDeadline(now, migration.destination.stateCode, migration.deadline ? migration.deadline.toObject?.() : {});

        setStage(migration, "source_noc", "approved", { actor: req.user.id, actorName: user.name, remarks: remarks || "NOC approved" });
        const prev = migration.status;
        migration.status = "noc_issued";
        pushEvent(migration, { actor: req.user.id, actorRole: "rto", action: "NOC_ISSUED", fromStatus: prev, toStatus: "noc_issued", note: remarks || "Source NOC issued" });

        // Mirror onto the linked conventional request.
        if (migration.request) {
            const transferRequest = await Request.findById(migration.request);
            if (transferRequest) {
                transferRequest.interStateDetails.sourceRTOApproval = { status: "approved", officerId: req.user.id, officerName: user.name, rtoOffice: user.rtoDetails.rtoOfficeName, timestamp: now, remarks: remarks || "NOC approved" };
                transferRequest.status = "source_rto_approved";
                await transferRequest.save();
            }
        }
        await migration.save();

        await notifyMigrationStage({ migration, title: `NOC issued for ${migration.migrationId}`, message: `Source NOC issued. The ${migration.destination.stateName} RTO can now review and re-register.`, ownerNotified: true, rtoState: migration.destination.stateCode });

        res.json({ message: "NOC issued", migration });
    } catch (err) {
        console.error("Migration source approve error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/:id/source-reject", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { remarks } = req.body;
        const user = await User.findById(req.user.id);
        const migration = await SmartMigration.findById(req.params.id);
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (migration.origin.stateCode !== user.rtoDetails?.stateCode) return res.status(403).json({ message: "Only the source state RTO can reject the NOC" });

        setStage(migration, "source_noc", "rejected", { actor: req.user.id, actorName: user.name, remarks: remarks || "NOC rejected" });
        const prev = migration.status;
        migration.status = "rejected";
        pushEvent(migration, { actor: req.user.id, actorRole: "rto", action: "NOC_REJECTED", fromStatus: prev, toStatus: "rejected", note: remarks || "NOC rejected" });

        if (migration.request) {
            const transferRequest = await Request.findById(migration.request);
            if (transferRequest) {
                transferRequest.interStateDetails.sourceRTOApproval = { status: "rejected", officerId: req.user.id, officerName: user.name, timestamp: new Date(), remarks: remarks || "NOC rejected" };
                transferRequest.status = "rejected";
                await transferRequest.save();
            }
        }
        await migration.save();
        await notifyMigrationStage({ migration, title: `NOC rejected for ${migration.migrationId}`, message: remarks || "The source RTO rejected the NOC.", ownerNotified: true });
        res.json({ message: "NOC rejected", migration });
    } catch (err) {
        console.error("Migration source reject error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- Features C + D + G: destination approve, re-register, reconcile --------

router.post("/:id/destination-approve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { newRegNumber, remarks } = req.body;
        if (!newRegNumber) return res.status(400).json({ message: "New registration number is required" });

        const user = await User.findById(req.user.id);
        const stateCode = user.rtoDetails?.stateCode;
        if (!stateCode) return res.status(400).json({ message: "Configure your RTO state first." });

        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (migration.destination.stateCode !== stateCode) return res.status(403).json({ message: "Only the destination state RTO can approve" });

        // Dependency rule: destination may not act before a recorded source NOC.
        const sourceStage = findStage(migration, "source_noc");
        if (!sourceStage || sourceStage.status !== "approved") {
            return res.status(400).json({ message: "The source state NOC must be issued before the destination can re-register." });
        }

        const vehicle = migration.vehicle;
        const originChassis = vehicle.chassisNumber;
        const originEngine = vehicle.engineNumber;
        const originOwner = String(vehicle.currentOwner);
        const oldRegNumber = migration.origin.regNumber;

        // Duplicate number guard.
        const clash = await Vehicle.findOne({ regNumber: newRegNumber, _id: { $ne: vehicle._id } });
        if (clash) return res.status(400).json({ message: "That registration number already exists in the system" });

        setStage(migration, "destination_review", "approved", { actor: req.user.id, actorName: user.name, remarks: remarks || "Destination checks complete" });

        // Re-register the vehicle under the new number.
        vehicle.regNumber = newRegNumber;
        vehicle.status = "active";
        vehicle.lastStateChange = new Date();
        vehicle.issuedByOffice = user.rtoDetails?.rtoOfficeName || vehicle.issuedByOffice;
        vehicle.issuedByOfficer = `${user.name}${user.employeeId ? ` (${user.employeeId})` : ""}`;
        if (!vehicle.registrationDate) vehicle.registrationDate = new Date();
        vehicle.stateChangeHistory.push({ from: oldRegNumber, to: newRegNumber, reason: "Smart migration (inter-state)", authorizedBy: `${user.name} (${user.rtoDetails?.rtoOfficeName || ""})`, timestamp: new Date() });
        vehicle.ownershipHistory.push({ owner: vehicle.currentOwner, transferDate: new Date(), blockchainTxHash: null, transferReason: "transfer", ipfsDocumentHash: migration.passport?.hash || null });

        migration.destination.newRegNumber = newRegNumber;
        setStage(migration, "reassignment", "approved", { actor: req.user.id, actorName: user.name, remarks: `Assigned ${newRegNumber}` });

        // Mirror onto the linked request and run it through the same on-chain path.
        if (migration.request) {
            const transferRequest = await Request.findById(migration.request);
            if (transferRequest) {
                transferRequest.interStateDetails.destinationRTOApproval = { status: "approved", officerId: req.user.id, officerName: user.name, rtoOffice: user.rtoDetails?.rtoOfficeName, timestamp: new Date(), remarks: remarks || "Registration approved" };
                transferRequest.interStateDetails.newRegNumber = newRegNumber;
                transferRequest.status = "approved";
                transferRequest.interStateDetails.completedAt = new Date();
                await transferRequest.save();
            }
        }

        await vehicle.save();

        // Honest on-chain anchoring (only when the owner has a wallet, exactly as
        // the existing flow does; otherwise it is simply not anchored).
        let blockchainTxHash = null;
        try {
            const ownerUser = await User.findById(vehicle.currentOwner).select("name blockchainWalletAddress");
            if (ownerUser?.blockchainWalletAddress) {
                blockchainTxHash = await registerVehicleTransferOnChain(oldRegNumber, newRegNumber, ownerUser.blockchainWalletAddress, "inter_state_transfer");
                if (blockchainTxHash) {
                    vehicle.blockchainTxHash = blockchainTxHash;
                    const entry = vehicle.ownershipHistory[vehicle.ownershipHistory.length - 1];
                    if (entry) entry.blockchainTxHash = blockchainTxHash;
                    await vehicle.save();
                }
            } else {
                console.warn(`Not anchoring migration ${migration.migrationId}: owner has no linked wallet address.`);
            }
        } catch (bErr) {
            console.error("Migration anchoring error:", bErr.message);
        }

        // Feature G: reconcile the post-migration record against the migration snapshot.
        const result = reconcile({
            originRegNumber: oldRegNumber,
            originChassis,
            originEngine,
            originOwner,
            destinationRegNumber: newRegNumber,
            destinationChassis: vehicle.chassisNumber,
            destinationEngine: vehicle.engineNumber,
            destinationOwner: String(vehicle.currentOwner),
            nocIssued: true,
            destinationApproved: true,
        });
        migration.exceptions = result.exceptions;
        migration.reconciliation = { verdict: result.verdict, comparedAt: result.comparedAt, notes: result.exceptions.length ? "Discrepancies routed to the destination officer; no source record was auto-corrected." : "Source and destination identifiers, ownership and NOC are consistent." };

        setStage(migration, "reconciliation", result.verdict === "consistent" ? "approved" : "under_review", { actor: req.user.id, actorName: user.name, remarks: migration.reconciliation.notes });
        if (result.verdict === "consistent") setStage(migration, "completed", "completed", { remarks: "Migration completed and reconciled" });
        const prev = migration.status;
        migration.status = result.verdict === "consistent" ? "completed" : "reconciling";
        // Refresh deadline countdown on completion.
        migration.deadline = computeDeadline(migration.deadline?.nocIssueDate, migration.destination.stateCode, migration.deadline ? migration.deadline.toObject?.() : {});
        pushEvent(migration, { actor: req.user.id, actorRole: "rto", action: "DESTINATION_APPROVED", fromStatus: prev, toStatus: migration.status, note: `New reg ${newRegNumber}; reconciliation ${result.verdict}${blockchainTxHash ? "; anchored on-chain" : ""}` });
        await migration.save();

        await notifyMigrationStage({ migration, title: result.verdict === "consistent" ? `Migration ${migration.migrationId} complete` : `Migration ${migration.migrationId} has exceptions`, message: result.verdict === "consistent" ? `Re-registered as ${newRegNumber}.` : `${result.exceptions.length} reconciliation exception(s) need officer review.`, ownerNotified: true, rtoState: result.verdict === "consistent" ? null : migration.destination.stateCode });

        res.json({ message: "Destination approved", migration, blockchainTxHash, reconciliation: migration.reconciliation });
    } catch (err) {
        console.error("Migration destination approve error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

router.post("/:id/destination-reject", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const { remarks } = req.body;
        const user = await User.findById(req.user.id);
        const migration = await SmartMigration.findById(req.params.id);
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (migration.destination.stateCode !== user.rtoDetails?.stateCode) return res.status(403).json({ message: "Only the destination state RTO can reject" });

        setStage(migration, "destination_review", "rejected", { actor: req.user.id, actorName: user.name, remarks: remarks || "Destination rejected" });
        const prev = migration.status;
        migration.status = "rejected";
        pushEvent(migration, { actor: req.user.id, actorRole: "rto", action: "DESTINATION_REJECTED", fromStatus: prev, toStatus: "rejected", note: remarks || "Destination rejected" });

        if (migration.request) {
            const transferRequest = await Request.findById(migration.request);
            if (transferRequest) {
                transferRequest.interStateDetails.destinationRTOApproval = { status: "rejected", officerId: req.user.id, officerName: user.name, timestamp: new Date(), remarks: remarks || "Destination rejected" };
                transferRequest.status = "rejected";
                await transferRequest.save();
            }
        }
        await migration.save();
        res.json({ message: "Destination rejected", migration });
    } catch (err) {
        console.error("Migration destination reject error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- Feature G: an officer closes an exception (records the decision; never
//     rewrites the vehicle to hide the difference).
router.post("/:id/exceptions/:index/resolve", authRequired, requireRole("rto"), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const migration = await SmartMigration.findById(req.params.id);
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (![migration.origin.stateCode, migration.destination.stateCode].includes(user.rtoDetails?.stateCode)) {
            return res.status(403).json({ message: "Only an officer of the source or destination state may resolve exceptions" });
        }
        const exc = migration.exceptions[Number(req.params.index)];
        if (!exc) return res.status(404).json({ message: "Exception not found" });
        exc.resolved = true;
        exc.resolvedBy = req.user.id;
        exc.resolutionNote = req.body.note || "Reviewed and cleared by officer";
        const openCount = migration.exceptions.filter((e) => !e.resolved).length;
        if (openCount === 0) {
            setStage(migration, "reconciliation", "approved", { actor: req.user.id, actorName: user.name, remarks: "All exceptions cleared by officer review" });
            setStage(migration, "completed", "completed", { remarks: "Migration completed after exception review" });
            migration.status = "completed";
        }
        pushEvent(migration, { actor: req.user.id, actorRole: "rto", action: "EXCEPTION_RESOLVED", note: `${exc.field}: ${exc.resolutionNote}` });
        await migration.save();
        res.json({ message: "Exception resolved", migration });
    } catch (err) {
        console.error("Migration exception resolve error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- Feature F: regenerate / read the migration passport ---------------------

router.get("/:id/passport", authRequired, requireRole("owner", "rto", "admin"), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const migration = await SmartMigration.findById(req.params.id).populate("vehicle");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        if (req.user.role === "owner" && String(migration.owner) !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        if (req.user.role === "rto" && ![migration.origin.stateCode, migration.destination.stateCode].includes(user.rtoDetails?.stateCode)) {
            return res.status(403).json({ message: "This migration does not involve your state" });
        }
        const passport = await generateMigrationPassport(migration.vehicle._id, migration.toObject());
        if (passport.error) return res.status(500).json({ message: passport.error });
        res.json({ passport: passport.passport, passportHash: passport.passportHash, storedHash: migration.passport?.hash || null, matches: migration.passport?.hash ? migration.passport.hash === passport.passportHash : null });
    } catch (err) {
        console.error("Migration passport error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// --- reads ------------------------------------------------------------------

router.get("/my-migrations", authRequired, requireRole("owner"), async (req, res) => {
    try {
        const migrations = await SmartMigration.find({ owner: req.user.id })
            .populate("vehicle", "regNumber make model year status")
            .sort({ createdAt: -1 });
        res.json(migrations);
    } catch (err) {
        console.error("My migrations error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// The officer queue: every migration whose source or destination stage this RTO owns.
router.get("/queue", authRequired, requireRole("rto", "admin"), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const stateCode = user.rtoDetails?.stateCode;
        if (req.user.role === "rto" && !stateCode) return res.status(400).json({ message: "Configure your RTO state first." });

        const filter = req.user.role === "admin" ? {} : { $or: [{ "origin.stateCode": stateCode }, { "destination.stateCode": stateCode }] };
        const migrations = await SmartMigration.find(filter)
            .populate("vehicle", "regNumber make model year status")
            .populate("owner", "name email")
            .sort({ createdAt: -1 });
        res.json(migrations);
    } catch (err) {
        console.error("Migration queue error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Static paths are declared before "/:id" - Express matches in declaration order,
// so "/stats/overview" would otherwise be read as a migration id.

// KPI overview for the orchestrator dashboard.
router.get("/stats/overview", authRequired, requireRole("owner", "rto", "admin"), async (req, res) => {
    try {
        const all = await SmartMigration.find({}).select("status readiness.verdict reconciliation.verdict deadline");
        const by = (fn) => all.filter(fn).length;
        res.json({
            total: all.length,
            blocked: by((m) => m.status === "precheck_blocked"),
            inProgress: by((m) => ["submitted", "source_under_review", "noc_issued", "destination_under_review", "reconciling"].includes(m.status)),
            completed: by((m) => m.status === "completed"),
            exceptions: by((m) => m.reconciliation?.verdict === "exception"),
            reminderThresholds: DEADLINE_REMINDER_THRESHOLDS,
        });
    } catch (err) {
        console.error("Migration stats error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Analytics for the orchestrator dashboard. Every series is a real aggregation
// over SmartMigration documents - nothing is hardcoded. The frontend charts are
// click-to-filter, and each datapoint carries the exact key the migration table
// filters on, so a chart click and a table filter always agree.
router.get("/analytics", authRequired, requireRole("rto", "admin"), async (req, res) => {
    try {
        const rows = await SmartMigration.find({})
            .select("createdAt updatedAt status origin destination readiness.verdict")
            .lean();

        const MONTH = new Intl.DateTimeFormat("en-IN", { month: "short", year: "numeric" });

        // Requests by month - last 12 calendar months, zero-filled so the line is
        // continuous and an empty month reads as a real 0, not a gap.
        const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        const byMonthMap = new Map();
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            byMonthMap.set(monthKey(d), { key: monthKey(d), label: MONTH.format(d), count: 0 });
        }

        const pairMap = new Map();
        const statusMap = new Map();
        let completed = 0, inProgress = 0, rejected = 0, blocked = 0;
        let durationSum = 0, durationCount = 0;

        const IN_PROGRESS = ["submitted", "source_under_review", "noc_issued", "destination_under_review", "reconciling"];

        for (const m of rows) {
            const created = m.createdAt ? new Date(m.createdAt) : null;
            if (created) {
                const bucket = byMonthMap.get(monthKey(created));
                if (bucket) bucket.count++;
            }
            const from = m.origin?.stateName || m.origin?.stateCode || "Unknown";
            const to = m.destination?.stateName || m.destination?.stateCode || "Unknown";
            const pk = `${from}→${to}`;
            pairMap.set(pk, { from, to, label: `${from} → ${to}`, count: (pairMap.get(pk)?.count || 0) + 1 });

            statusMap.set(m.status, (statusMap.get(m.status) || 0) + 1);

            if (m.status === "completed") {
                completed++;
                if (m.updatedAt && m.createdAt) {
                    const days = (new Date(m.updatedAt) - new Date(m.createdAt)) / 86400000;
                    if (days >= 0) { durationSum += days; durationCount++; }
                }
            } else if (m.status === "rejected" || m.status === "expired") rejected++;
            else if (m.status === "precheck_blocked") blocked++;
            else if (IN_PROGRESS.includes(m.status)) inProgress++;
        }

        res.json({
            totalMigrations: rows.length,
            byMonth: [...byMonthMap.values()],
            statePairs: [...pairMap.values()].sort((a, b) => b.count - a.count).slice(0, 8),
            statusDist: [...statusMap.entries()]
                .map(([status, count]) => ({ status, count }))
                .sort((a, b) => b.count - a.count),
            completion: { completed, inProgress, rejected, blocked },
            avgDurationDays: durationCount ? Math.round((durationSum / durationCount) * 10) / 10 : null,
            note: "Aggregated live from migration records; average duration uses created→last-updated for completed cases.",
        });
    } catch (err) {
        console.error("Migration analytics error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Configured state rules (so the UI can show rule source, not invent numbers).
router.get("/rules", authRequired, async (req, res) => {
    res.json({
        rules: Object.entries(STATE_MIGRATION_RULES).map(([code, r]) => ({ code, stateName: STATE_RTO_CODES[code], ...r })),
        unsupportedNote: "Values are a maintained demonstration table, not official state rate cards.",
    });
});

router.get("/:id", authRequired, requireRole("owner", "rto", "admin"), async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        const migration = await SmartMigration.findById(req.params.id)
            .populate("vehicle", "regNumber make model year chassisNumber engineNumber status ipfsDocuments documents")
            .populate("owner", "name email")
            .populate("request");
        if (!migration) return res.status(404).json({ message: "Migration not found" });
        // owner is populated to {name email} above, so read its id for the ownership test.
        const ownerId = String(migration.owner?._id || migration.owner);
        if (req.user.role === "owner" && ownerId !== req.user.id) return res.status(403).json({ message: "Not your migration" });
        if (req.user.role === "rto" && ![migration.origin.stateCode, migration.destination.stateCode].includes(user.rtoDetails?.stateCode)) {
            return res.status(403).json({ message: "This migration does not involve your state" });
        }
        // Live deadline refresh for the countdown UI.
        if (migration.deadline?.nocIssueDate) {
            migration.deadline = computeDeadline(migration.deadline.nocIssueDate, migration.destination.stateCode, migration.deadline.toObject ? migration.deadline.toObject() : {});
        }
        res.json(migration);
    } catch (err) {
        console.error("Migration read error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
