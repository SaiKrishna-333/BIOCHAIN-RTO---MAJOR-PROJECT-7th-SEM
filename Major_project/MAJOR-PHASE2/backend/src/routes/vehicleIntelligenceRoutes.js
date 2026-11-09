// vehicleIntelligenceRoutes.js
// Vehicle Intelligence feature family (mounted at /api/vehicle-intelligence):
// Feature 1 - Verified Vehicle Service and Odometer History
// Feature 2 - Critical Vehicle Parts Provenance Tracker
// Feature 6 - Verified Vehicle Damage and Repair Passport
// Feature 7 - Electric Vehicle Battery Passport
// Existing routes (/api/vehicles, /api/patent-features, ...) are untouched.

import express from "express";
import mongoose from "mongoose";
import multer from "multer";
import { authRequired, requireRole } from "../middleware/authMiddleware.js";
import { User } from "../models/User.js";
import { Vehicle } from "../models/Vehicle.js";
import { ServiceRecord } from "../models/ServiceRecord.js";
import { ComponentRecord, ComponentEvent } from "../models/ComponentRecord.js";
import { DamageEvent } from "../models/DamageEvent.js";
import { BatteryPassport } from "../models/BatteryPassport.js";
import { VehicleIntelRequest } from "../models/VehicleIntelRequest.js";
import {
    anchorRecord,
    verifyRecordIntegrity,
    hashFileBuffer
} from "../services/recordAnchorService.js";
import { createNotification, createRoleNotification } from "../services/notificationService.js";
import {
    saveStagedFile,
    removeMediaForEvent,
    discardStagedFile,
    digestForEvidence,
    stagingDir,
    newStagedName,
    streamMediaFile,
} from "../services/accidentMediaService.js";

const router = express.Router();

// Evidence uploads (damage passport) - 5MB, in-memory, hashed then stored in Mongo
const evidenceUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ALLOWED_EVIDENCE = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

// Serial numbers normalized consistently (uppercase, keep alphanumerics + hyphen)
const normalizeSerial = (s) => String(s || "").toUpperCase().replace(/\s+/g, "").trim();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const isValidObjectId = (id) => mongoose.Types.ObjectId.isValid(id);

// "Maruti Suzuki", "MARUTI SUZUKI", "MARUTI-SUZUKI" all match
const normalizeManufacturer = (name) =>
    String(name || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

// Load a vehicle (by id or reg number) and enforce workshop brand access:
// a workshop user may only touch vehicles whose make matches their
// registered company affiliation (e.g. a Maruti Suzuki centre sees Maruti cars).
const loadVehicleForUser = async (identifier, user) => {
    let vehicle = null;
    if (isValidObjectId(identifier)) {
        vehicle = await Vehicle.findById(identifier);
    }
    if (!vehicle) {
        vehicle = await Vehicle.findOne({
            regNumber: new RegExp(`^${String(identifier).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i")
        });
    }
    if (!vehicle) return { error: 404, message: "Vehicle not found" };

    if (user.role === "workshop") {
        const dbUser = await User.findById(user.id);
        const affiliated = dbUser?.workshopDetails?.affiliatedManufacturer;
        if (!affiliated) {
            return { error: 403, message: "Workshop account has no registered vehicle company. Complete your workshop profile first." };
        }
        if (normalizeManufacturer(vehicle.make) !== normalizeManufacturer(affiliated)) {
            // Brand mismatch: the workshop cannot see this vehicle's data
            return { error: 403, message: `This vehicle (${vehicle.make}) is not linked to your registered company (${affiliated}). Only the matching authorized workshop can access it.` };
        }
    }
    return { vehicle };
};

// Only verified workshops, RTO or admin may submit authorized records
const requireAuthorizedSubmitter = authRequired; // role check done per-route below

const SUBMITTER_ROLES = ["workshop", "rto", "admin"];

const getSubmitterProfile = async (userId) => {
    const dbUser = await User.findById(userId);
    if (!dbUser) return null;
    if (dbUser.role === "workshop" && !dbUser.workshopDetails?.verified) {
        return { error: "Your workshop is not verified yet. Ask an admin/RTO to verify your service-centre credentials." };
    }
    const submitterName = dbUser.role === "workshop"
        ? `${dbUser.workshopDetails?.companyName || dbUser.name} (${dbUser.workshopDetails?.affiliatedManufacturer || "Independent"})`
        : `${dbUser.name} [${dbUser.role.toUpperCase()}]`;
    const manufacturer = dbUser.role === "workshop"
        ? dbUser.workshopDetails?.affiliatedManufacturer
        : dbUser.role;
    return { submitterName, manufacturer };
};

// Generic date validation: not in the future, not before the vehicle's model year
const validateServiceDate = (dateStr, vehicle) => {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "Invalid date format.";
    if (date > new Date()) return "Date cannot be in the future.";
    const earliest = new Date(`${vehicle.year || 1900}-01-01`);
    if (date < earliest) return `Date is before the vehicle's model year (${vehicle.year}).`;
    return null;
};

// ---------------------------------------------------------------------------
// FEATURE 1: Verified Vehicle Service and Odometer History
// ---------------------------------------------------------------------------

// Vehicles this authorized submitter may maintain records for.
// Workshops only see vehicles whose make matches their registered company.
// GET /my-brand-vehicles
router.get("/my-brand-vehicles", authRequired, requireRole("workshop", "rto", "admin"), async (req, res) => {
    try {
        if (req.user.role === "workshop") {
            const dbUser = await User.findById(req.user.id);
            const affiliated = dbUser?.workshopDetails?.affiliatedManufacturer;
            if (!affiliated) {
                return res.json({ success: true, vehicles: [], needProfile: true, message: "Register your company details first to see matching vehicles." });
            }
            // Match the same way the access gate does (normalizeManufacturer),
            // not with a strict anchored regex: a stored make like "Maruti "
            // (trailing space) or "MARUTI-SUZUKI" is the same brand yet would
            // fail a raw string match, so the vehicle would disappear from this
            // list even though the workshop can open it.
            const wanted = normalizeManufacturer(affiliated);
            const all = await Vehicle.find({})
                .select("regNumber chassisNumber make model year status")
                .sort({ updatedAt: -1 })
                .lean();
            const vehicles = all
                .filter((v) => normalizeManufacturer(v.make) === wanted)
                .slice(0, 200);
            return res.json({ success: true, vehicles, needProfile: false });
        }
        const vehicles = await Vehicle.find({})
            .select("regNumber chassisNumber make model year status")
            .sort({ updatedAt: -1 })
            .limit(200)
            .lean();
        res.json({ success: true, vehicles, needProfile: false });
    } catch (err) {
        console.error("my-brand-vehicles error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// List service/odometer timeline for a vehicle
// GET /vehicle-history/:vehicleId/service-records
router.get("/vehicle-history/:vehicleId/service-records", authRequired, async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const vehicle = access.vehicle;

        const { status, from, to } = req.query;
        const query = { vehicle: vehicle._id };
        if (status) query.status = status;
        if (from || to) {
            query.serviceDate = {};
            if (from) query.serviceDate.$gte = new Date(from);
            if (to) query.serviceDate.$lte = new Date(to);
        }

        const records = await ServiceRecord.find(query)
            .sort({ serviceDate: -1 })
            .populate("submittedBy", "name role")
            .lean();

        // Odometer trend summary for the timeline header
        const readings = records.map(r => r.odometerKm);
        const flaggedCount = records.filter(r => r.status === "flagged_for_review").length;

        res.json({
            success: true,
            vehicle: { id: vehicle._id, regNumber: vehicle.regNumber, make: vehicle.make, model: vehicle.model, year: vehicle.year, blockchainTxHash: vehicle.blockchainTxHash || null },
            summary: {
                totalRecords: records.length,
                flaggedReadings: flaggedCount,
                latestOdometerKm: readings.length ? Math.max(...readings) : null,
                note: flaggedCount > 0
                    ? "One or more readings are lower than earlier recorded readings. Flagged readings require review and are NOT proof of fraud."
                    : null
            },
            records
        });
    } catch (err) {
        console.error("service-records list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Submit a new service record (authorized workshop / RTO / admin only)
// POST /vehicle-history/:vehicleId/service-records
router.post("/vehicle-history/:vehicleId/service-records", requireAuthorizedSubmitter, requireRole(...SUBMITTER_ROLES), async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const vehicle = access.vehicle;

        const profile = await getSubmitterProfile(req.user.id);
        if (profile?.error) return res.status(403).json({ message: profile.error });

        const { serviceDate, odometerKm, serviceType, description, partsReplaced, cost, evidenceReference } = req.body;

        // ---- Validation ----
        const errors = [];
        const dateError = validateServiceDate(serviceDate, vehicle);
        if (dateError) errors.push(dateError);
        const km = Number(odometerKm);
        if (!Number.isFinite(km) || km < 0 || km > 2_000_000) errors.push("Odometer reading must be a plausible non-negative number in km.");
        if (!["periodic-service", "repair", "part-replacement", "inspection", "recall", "other"].includes(serviceType)) errors.push("Invalid service type.");
        if (!description || !String(description).trim()) errors.push("Description is required.");
        if (Array.isArray(partsReplaced)) {
            for (const p of partsReplaced) {
                if (!p?.partName) errors.push("Each replaced part needs a partName.");
            }
        }
        if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

        // ---- Odometer rollback-style flagging (warning, never an accusation) ----
        const latest = await ServiceRecord.findOne({ vehicle: vehicle._id }).sort({ serviceDate: -1 });
        let status = "verified";
        let flagReason = null;
        if (latest && km < latest.odometerKm) {
            status = "flagged_for_review";
            flagReason = `Reading ${km} km is lower than the previously recorded ${latest.odometerKm} km (record dated ${latest.serviceDate.toISOString().slice(0, 10)}). This can happen for legitimate reasons (instrument replacement, data-entry error) and requires manual review - it is not proof of tampering.`;
        }

        const record = new ServiceRecord({
            vehicle: vehicle._id,
            regNumber: vehicle.regNumber,
            serviceDate: new Date(serviceDate),
            odometerKm: km,
            serviceType,
            description: String(description).trim(),
            partsReplaced: Array.isArray(partsReplaced) ? partsReplaced : [],
            cost: Number.isFinite(Number(cost)) ? Number(cost) : undefined,
            submittedBy: req.user.id,
            submitterName: profile.submitterName,
            manufacturer: profile.manufacturer,
            evidenceReference: evidenceReference || null,
            status,
            flagReason
        });

        // Tamper-evident hash of the finalized record (DB always; chain when configured)
        record.anchor = await anchorRecord(record.toObject(), `service-record ${vehicle.regNumber}`);
        await record.save();

        res.status(201).json({
            success: true,
            flagged: status === "flagged_for_review",
            message: status === "flagged_for_review"
                ? "Record saved but FLAGGED FOR REVIEW due to an inconsistent odometer reading."
                : "Service record added to the verified timeline.",
            record
        });
    } catch (err) {
        console.error("service-records create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Authorized correction of a record field (keeps append-only audit trail)
// PATCH /service-records/:recordId/correct
router.patch("/service-records/:recordId/correct", authRequired, requireRole("rto", "admin", "workshop"), async (req, res) => {
    try {
        const { field, newValue, reason } = req.body;
        const record = await ServiceRecord.findById(req.params.recordId);
        if (!record) return res.status(404).json({ message: "Record not found" });

        // Workshops may only correct records on vehicles of their own brand
        const access = await loadVehicleForUser(record.vehicle, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });

        const CORRECTABLE = ["odometerKm", "serviceDate", "description", "serviceType", "cost"];
        if (!CORRECTABLE.includes(field)) {
            return res.status(400).json({ message: `Only ${CORRECTABLE.join(", ")} can be corrected.` });
        }
        if (!reason || !String(reason).trim()) {
            return res.status(400).json({ message: "A correction reason is required for the audit trail." });
        }

        let validatedNew = newValue;
        if (field === "odometerKm") {
            validatedNew = Number(newValue);
            if (!Number.isFinite(validatedNew) || validatedNew < 0) return res.status(400).json({ message: "Invalid odometer value." });
        } else if (field === "serviceDate") {
            const d = new Date(newValue);
            if (isNaN(d.getTime())) return res.status(400).json({ message: "Invalid date." });
            validatedNew = d;
        }

        const previousValue = record[field];
        record.corrections.push({ field, previousValue, newValue: validatedNew, reason: String(reason).trim(), correctedBy: req.user.id });
        record[field] = validatedNew;

        // A correction re-evaluates the flag: still below the previous record?
        const earlier = await ServiceRecord.findOne({ vehicle: record.vehicle, _id: { $ne: record._id } }).sort({ serviceDate: -1 });
        if (field === "odometerKm" && earlier && validatedNew < earlier.odometerKm) {
            record.status = "flagged_for_review";
            record.flagReason = `Corrected reading ${validatedNew} km is still below the previous record (${earlier.odometerKm} km).`;
        } else if (record.status === "flagged_for_review") {
            record.status = "corrected";
            record.flagReason = null;
        }

        // Corrections are an audited exception: the original hash stays intact,
        // a fresh hash of the corrected content is recorded for future checks.
        record.anchor = await anchorRecord(record.toObject(), `service-record corrected ${record._id}`);
        await record.save();

        res.json({ success: true, message: "Correction recorded with audit trail.", record });
    } catch (err) {
        console.error("service-records correct error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify a record still matches its tamper-evident hash
// GET /service-records/:recordId/verify
router.get("/service-records/:recordId/verify", authRequired, async (req, res) => {
    try {
        const record = await ServiceRecord.findById(req.params.recordId);
        if (!record) return res.status(404).json({ message: "Record not found" });
        const access = await loadVehicleForUser(record.vehicle, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });

        const result = verifyRecordIntegrity(record.toObject());
        res.json({ success: true, ...result });
    } catch (err) {
        console.error("service-records verify error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// FEATURE 2: Critical Vehicle Parts Provenance Tracker
// ===========================================================================

// Re-check a serial against OTHER vehicles that currently hold it as "active".
const detectComponentConflict = async (serial, excludeVehicleId) => {
    const activeElsewhere = await ComponentRecord.find({
        serialNumber: serial,
        status: "active",
        vehicle: { $ne: excludeVehicleId }
    }).populate("vehicle", "regNumber make model").lean();
    if (activeElsewhere.length) {
        return {
            flagged: true,
            reason: `Serial ${serial} is recorded as ACTIVE on ${activeElsewhere.length} other vehicle(s): ` +
                activeElsewhere.map(c => c.vehicle?.regNumber || c.vehicle?._id).join(", ") +
                ". This is a possible identity conflict for INVESTIGATION - it is not proof of fraud."
        };
    }
    return { flagged: false };
};

// List components + lifecycle for a vehicle
router.get("/vehicle-history/:vehicleId/components", authRequired, async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });

        const components = await ComponentRecord.find({ vehicle: access.vehicle._id })
            .sort({ createdAt: -1 }).lean();
        for (const c of components) {
            c.events = await ComponentEvent.find({ component: c._id }).sort({ eventDate: 1 }).lean();
        }
        const conflicts = components.filter(c => c.conflict?.flagged).length;
        res.json({
            success: true,
            vehicle: { id: access.vehicle._id, regNumber: access.vehicle.regNumber, make: access.vehicle.make },
            summary: { totalComponents: components.length, conflicts, note: conflicts ? "Some serials conflict with other vehicles and need review." : null },
            components
        });
    } catch (err) {
        console.error("components list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Register a serialized component on a vehicle (authorized submitter)
router.post("/vehicle-history/:vehicleId/components", authRequired, requireRole(...SUBMITTER_ROLES), async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const profile = await getSubmitterProfile(req.user.id);
        if (profile?.error) return res.status(403).json({ message: profile.error });

        const { componentType, serialNumber, installationDate, reason, evidenceReference } = req.body;
        const serial = normalizeSerial(serialNumber);
        const VALID_TYPES = ["engine", "battery-pack", "gearbox", "transmission", "motor", "chassis-panel", "other"];
        const errors = [];
        if (!VALID_TYPES.includes(componentType)) errors.push("Invalid component type.");
        if (!serial || serial.length < 4) errors.push("A meaningful serial number (4+ chars) is required.");
        const instDate = installationDate ? new Date(installationDate) : new Date();
        if (isNaN(instDate.getTime())) errors.push("Invalid installation date.");
        if (instDate > new Date()) errors.push("Installation date cannot be in the future.");
        if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

        // Duplicate guard for same serial on same vehicle
        const dup = await ComponentRecord.findOne({ serialNumber: serial, vehicle: access.vehicle._id });
        if (dup) return res.status(409).json({ message: "This serial is already recorded on this vehicle. Add a lifecycle event instead of a duplicate." });

        const conflict = await detectComponentConflict(serial, access.vehicle._id);

        const component = new ComponentRecord({
            componentType, serialNumber: serial, vehicle: access.vehicle._id,
            regNumber: access.vehicle.regNumber, status: "active",
            conflict: { flagged: conflict.flagged, reason: conflict.reason || null, flaggedAt: conflict.flagged ? new Date() : null },
            evidenceReference: evidenceReference || null
        });
        component.anchor = await anchorRecord(component.toObject(), `component ${serial}`);
        await component.save();

        await ComponentEvent.create({
            component: component._id, vehicle: access.vehicle._id, eventType: "installed",
            eventDate: instDate, reason: reason || "Initial registration", workshopName: profile.submitterName,
            recordedBy: req.user.id, evidenceReference: evidenceReference || null
        });

        res.status(201).json({
            success: true, conflictFlagged: conflict.flagged,
            message: conflict.flagged
                ? "Component recorded but its serial CONFLICTS with another vehicle - flagged for investigation."
                : "Component added to the provenance timeline.",
            component
        });
    } catch (err) {
        console.error("components create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Append a lifecycle event (installed/removed/replaced/inspected) - never overwrite history
router.post("/components/:componentId/events", authRequired, requireRole(...SUBMITTER_ROLES), async (req, res) => {
    try {
        const component = await ComponentRecord.findById(req.params.componentId);
        if (!component) return res.status(404).json({ message: "Component not found" });
        const access = await loadVehicleForUser(component.vehicle, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const profile = await getSubmitterProfile(req.user.id);
        if (profile?.error) return res.status(403).json({ message: profile.error });

        const { eventType, eventDate, reason, inspectionResult, evidenceReference } = req.body;
        if (!["installed", "removed", "replaced", "inspected"].includes(eventType)) {
            return res.status(400).json({ message: "Invalid event type." });
        }
        const d = eventDate ? new Date(eventDate) : new Date();
        if (isNaN(d.getTime()) || d > new Date()) return res.status(400).json({ message: "Invalid or future event date." });

        const event = await ComponentEvent.create({
            component: component._id, vehicle: component.vehicle, eventType, eventDate: d,
            reason: reason || null, workshopName: profile.submitterName,
            inspectionResult: eventType === "inspected" ? (inspectionResult || "pass") : "not-applicable",
            evidenceReference: evidenceReference || null, recordedBy: req.user.id
        });

        // Move the component's derived status (append-only history is preserved)
        if (eventType === "removed") component.status = "removed";
        else if (eventType === "replaced") component.status = "replaced";
        else if (eventType === "inspected") component.status = inspectionResult === "fail" ? "inspected-failed" : "inspected-passed";
        else if (eventType === "installed") {
            component.status = "active";
            const conflict = await detectComponentConflict(component.serialNumber, component.vehicle);
            component.conflict = { flagged: conflict.flagged, reason: conflict.reason || null, flaggedAt: conflict.flagged ? new Date() : null, reviewStatus: component.conflict?.reviewStatus || "unreviewed" };
        }
        await component.save();

        res.status(201).json({ success: true, message: "Lifecycle event recorded.", event, component });
    } catch (err) {
        console.error("component event error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Resolve a component conflict after human review (never auto-cleared)
router.patch("/components/:componentId/conflict", authRequired, requireRole("rto", "police", "admin"), async (req, res) => {
    try {
        const component = await ComponentRecord.findById(req.params.componentId);
        if (!component) return res.status(404).json({ message: "Component not found" });
        const { reviewStatus, remarks } = req.body;
        if (!["unreviewed", "under-investigation", "cleared"].includes(reviewStatus)) {
            return res.status(400).json({ message: "Invalid review status." });
        }
        component.conflict.reviewStatus = reviewStatus;
        if (remarks) component.conflict.reason = `${component.conflict.reason || ""} [review: ${remarks}]`.trim();
        await component.save();
        res.json({ success: true, component });
    } catch (err) {
        console.error("component conflict error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// FEATURE 6: Verified Vehicle Damage and Repair Passport
// ===========================================================================

router.get("/vehicle-history/:vehicleId/damage-events", authRequired, async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const events = await DamageEvent.find({ vehicle: access.vehicle._id })
            .sort({ eventDate: -1 })
            .select("-evidence.data") // never ship raw bytes in the list
            .lean();
        const counts = events.reduce((a, e) => { a[e.verificationStatus] = (a[e.verificationStatus] || 0) + 1; return a; }, {});
        res.json({
            success: true,
            vehicle: { id: access.vehicle._id, regNumber: access.vehicle.regNumber },
            summary: { total: events.length, reported: counts.reported || 0, verified: counts.verified || 0, disputed: counts.disputed || 0 },
            note: "Only damage that someone reported and an authorized party submitted appears here. The system cannot discover unreported damage.",
            events
        });
    } catch (err) {
        console.error("damage-events list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Submit a damage/repair event with optional evidence files
router.post("/vehicle-history/:vehicleId/damage-events", authRequired, requireRole(...SUBMITTER_ROLES), evidenceUpload.array("evidence", 5), async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const profile = await getSubmitterProfile(req.user.id);
        if (profile?.error) return res.status(403).json({ message: profile.error });

        const { eventType, eventDate, description, severity, affectedAreas } = req.body;
        const VALID = ["accident-damage", "flood-exposure", "structural-repair", "safety-part-replacement", "inspection"];
        const errors = [];
        if (!VALID.includes(eventType)) errors.push("Invalid damage event type.");
        const d = eventDate ? new Date(eventDate) : null;
        if (!d || isNaN(d.getTime())) errors.push("A valid event date is required.");
        else if (d > new Date()) errors.push("Event date cannot be in the future.");
        if (!description || !String(description).trim()) errors.push("Description is required.");
        if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

        const evidence = [];
        for (const file of (req.files || [])) {
            if (!ALLOWED_EVIDENCE.includes(file.mimetype)) {
                return res.status(400).json({ message: `Unsupported evidence type: ${file.mimetype}` });
            }
            evidence.push({
                fileName: file.originalname, contentType: file.mimetype, fileSize: file.size,
                data: file.buffer, sha256: hashFileBuffer(file.buffer)
            });
        }

        const event = new DamageEvent({
            vehicle: access.vehicle._id, regNumber: access.vehicle.regNumber, eventType,
            eventDate: d, description: String(description).trim(),
            severity: ["minor", "moderate", "severe", "unknown"].includes(severity) ? severity : "unknown",
            affectedAreas: Array.isArray(affectedAreas) ? affectedAreas : (affectedAreas ? String(affectedAreas).split(",").map(s => s.trim()) : []),
            verificationStatus: "reported", submittedBy: req.user.id,
            submitterName: profile.submitterName, organization: profile.submitterName, evidence
        });
        // Anchor hashes of evidence (bytes stay off-chain) then the record
        event.anchor = event.anchor || {};
        event.anchor.evidenceHashes = evidence.map(e => ({ file: e.fileName, sha256: e.sha256 }));
        const anchorObj = event.toObject();
        anchorObj.evidence = anchorObj.evidence.map(e => ({ fileName: e.fileName, sha256: e.sha256 }));
        event.anchor = { ...await anchorRecord(anchorObj, `damage-event ${access.vehicle.regNumber}`), evidenceHashes: event.anchor.evidenceHashes };
        await event.save();

        res.status(201).json({ success: true, message: "Damage/repair event recorded as REPORTED. It needs authorized verification to become VERIFIED.", event: { ...event.toObject(), evidence: event.evidence.map(e => ({ fileName: e.fileName, sha256: e.sha256, fileSize: e.fileSize })) } });
    } catch (err) {
        console.error("damage-events create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Verify or dispute a damage event (officer/authorized inspector)
router.patch("/damage-events/:eventId/decision", authRequired, requireRole("rto", "police", "workshop", "admin"), async (req, res) => {
    try {
        const event = await DamageEvent.findById(req.params.eventId);
        if (!event) return res.status(404).json({ message: "Event not found" });
        const { decision, remarks } = req.body;
        if (!["verified", "disputed", "reported"].includes(decision)) return res.status(400).json({ message: "Decision must be verified, disputed or reported." });

        // The submitted statement is never edited: the officer's finding is stored
        // beside it, so the record still hashes to what the submitter signed off on.
        event.verificationStatus = decision;
        if (decision === "verified") { event.verifiedBy = req.user.id; event.verifiedAt = new Date(); }
        event.officerReview = {
            outcome: decision === "reported" ? "pending" : decision,
            remarks: remarks ? String(remarks).trim() : null,
            reviewedBy: req.user.id,
            reviewedByName: req.user.name,
            reviewedByRole: req.user.role,
            reviewedAt: new Date(),
        };
        await event.save();

        // Tell the owner who uploaded the accident evidence what was decided
        if (event.sourceChannel === "owner-upload" && decision !== "reported") {
            const owner = await User.findById(event.submittedBy).select("_id name").lean();
            if (owner) {
                await createNotification({
                    type: "accident-evidence",
                    title: `Accident evidence ${decision}`,
                    message: `Your accident submission for ${event.regNumber} was reviewed by ${req.user.name} [${req.user.role.toUpperCase()}] and marked ${decision.toUpperCase()}.`,
                    recipient: owner._id,
                    recipientRole: "owner",
                    relatedVehicle: event.vehicle,
                    priority: decision === "disputed" ? "high" : "medium",
                    actionUrl: `/vehicle-history/${event.vehicle}`,
                });
            }
        }

        res.json({ success: true, event: { ...event.toObject(), evidence: event.evidence.map(e => ({ fileName: e.fileName, sha256: e.sha256 })) } });
    } catch (err) {
        console.error("damage-events decision error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Download a single evidence file (safe types rendered inline)
router.get("/damage-events/:eventId/evidence/:idx", authRequired, async (req, res) => {
    try {
        const event = await DamageEvent.findById(req.params.eventId);
        if (!event) return res.status(404).json({ message: "Event not found" });
        const access = await loadVehicleForUser(event.vehicle, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const file = event.evidence[parseInt(req.params.idx, 10)];
        if (!file) return res.status(404).json({ message: "Evidence file not found" });

        // Dashcam media sits on the evidence disk and is personal data: it is
        // released only to the owner who submitted it and to the officers who
        // review it. Everyone else still sees the fingerprint on the passport,
        // never the bytes.
        if (file.storage === "disk") {
            const isOfficer = ["police", "rto", "admin"].includes(req.user.role);
            if (!isOfficer && String(event.submittedBy) !== req.user.id) {
                return res.status(403).json({
                    message: "This file is released only to the owner who submitted it and to reviewing officers. Its fingerprint remains visible on the damage passport.",
                });
            }
            const streamed = await streamMediaFile(file.toObject ? file.toObject() : file, req, res);
            if (streamed) return;
            return res.status(410).json({ message: "The stored file is no longer on this server's evidence disk." });
        }
        if (!file.data) return res.status(404).json({ message: "Evidence file not found" });
        res.set("Content-Type", file.contentType);
        res.set("Content-Disposition", `inline; filename="${file.fileName}"`);
        res.send(file.data);
    } catch (err) {
        console.error("damage evidence fetch error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Re-check stored evidence against its recorded hash (detects later tampering)
router.get("/damage-events/:eventId/verify-integrity", authRequired, async (req, res) => {
    try {
        const event = await DamageEvent.findById(req.params.eventId);
        if (!event) return res.status(404).json({ message: "Event not found" });
        // Evidence digests belong to a specific vehicle: only people with a right to
        // see that vehicle may run this check.
        const access = await loadVehicleForUser(event.vehicle, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });

        const results = [];
        for (let i = 0; i < event.evidence.length; i++) {
            const e = event.evidence[i];
            // Dashcam media lives on the evidence disk, small files inside the
            // document: re-hash whichever applies, and treat an unreadable file as
            // a failed check rather than a silent pass.
            const current = await digestForEvidence(e);
            results.push({
                index: i,
                fileName: e.fileName,
                currentHash: current,
                recordedHash: e.sha256,
                verified: !!current && current.toLowerCase() === String(e.sha256 || "").toLowerCase(),
                ...(!current ? { note: "The stored file could not be read, so it could not be checked." } : {}),
            });
        }
        const recordIntegrity = verifyRecordIntegrity(event.toObject());
        res.json({
            success: true, evidence: results,
            allEvidenceIntact: results.every(r => r.verified),
            recordIntegrity,
            limitation: "A matching hash shows a file has not changed since it was hashed. It does NOT prove the evidence was truthful when submitted."
        });
    } catch (err) {
        console.error("damage integrity error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// OWNER ACCIDENT EVIDENCE UPLOAD (dashcam clip / photos) + OFFICER VERIFICATION
// The owner states what happened and uploads the media themselves. Police and
// RTO see it in a review queue, play it, re-check every file against the hash
// taken at submission, and record a finding. Nothing here replaces Feature 6's
// authorized-submitter route: an owner upload can only ever start as "reported",
// and only an officer can move it to verified or disputed.
// ===========================================================================

const ACCIDENT_MEDIA_TYPES = [
    "video/mp4", "video/quicktime", "video/webm", "video/x-msvideo",
    "image/jpeg", "image/png", "image/webp",
];
const MAX_ACCIDENT_FILES = 4;
const MAX_ACCIDENT_FILE_BYTES = 60 * 1024 * 1024;

// Large clips are written to a staging folder by multer, then hashed and filed
// by saveStagedFile - no 60MB buffer is ever held in request memory.
const accidentUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            stagingDir().then((dir) => cb(null, dir)).catch(cb);
        },
        filename: (req, file, cb) => cb(null, newStagedName()),
    }),
    limits: { fileSize: MAX_ACCIDENT_FILE_BYTES, files: MAX_ACCIDENT_FILES },
    fileFilter: (req, file, cb) => {
        if (!ACCIDENT_MEDIA_TYPES.includes(file.mimetype)) {
            return cb(new Error(`Unsupported evidence type: ${file.mimetype}. Upload MP4, MOV, WebM video or JPEG/PNG/WebP photos.`));
        }
        cb(null, true);
    },
});

const cleanStagedFiles = async (files = []) => {
    for (const f of files) await discardStagedFile(f?.path);
};

// Run multer inside the handler so a rejected file type or an oversized clip can
// be answered with a real status and message instead of Express' default 500.
const runAccidentUpload = (req, res) => new Promise((resolve, reject) => {
    accidentUpload.array("media", MAX_ACCIDENT_FILES)(req, res, (err) => (err ? reject(err) : resolve()));
});

const uploadRejectionResponse = (err) => {
    if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
            return { status: 413, message: `Each evidence file must be ${Math.round(MAX_ACCIDENT_FILE_BYTES / 1024 / 1024)}MB or smaller.` };
        }
        if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
            return { status: 413, message: `Attach at most ${MAX_ACCIDENT_FILES} files per accident report.` };
        }
        return { status: 400, message: `Upload rejected: ${err.message}` };
    }
    if (/Unsupported evidence type/.test(err.message || "")) {
        return { status: 400, message: err.message };
    }
    return null;
};

// Submit accident evidence as the registered owner of the vehicle
router.post(
    "/vehicle-history/:vehicleId/accident-upload",
    authRequired,
    requireRole("owner"),
    async (req, res) => {
        try {
            await runAccidentUpload(req, res);
        } catch (uploadErr) {
            await cleanStagedFiles(req.files || []);
            const rejection = uploadRejectionResponse(uploadErr);
            if (rejection) return res.status(rejection.status).json({ message: rejection.message });
            console.error("accident upload error:", uploadErr.message);
            return res.status(500).json({ message: "Server error" });
        }
        const staged = req.files || [];
        try {
            const vehicle = await Vehicle.findById(req.params.vehicleId);
            if (!vehicle) {
                await cleanStagedFiles(staged);
                return res.status(404).json({ message: "Vehicle not found" });
            }
            if (String(vehicle.currentOwner) !== req.user.id) {
                // Somebody else's file bytes must not linger on the server just because
                // the request was refused.
                await cleanStagedFiles(staged);
                return res.status(403).json({ message: "Only the registered owner of this vehicle can upload its accident evidence." });
            }

            const {
                eventDate, description, location, severity, injuries,
                oppositePartyRegNumber, oppositePartyName, oppositePartyPhone,
                oppositePartyInsurance, policeStation, firNumber,
            } = req.body;

            const errors = [];
            const d = eventDate ? new Date(eventDate) : null;
            if (!d || isNaN(d.getTime())) errors.push("A valid accident date is required.");
            else if (d > new Date()) errors.push("Accident date cannot be in the future.");
            if (!description || !String(description).trim()) errors.push("A description of what happened is required.");
            if (!location || !String(location).trim()) errors.push("The location of the accident is required.");
            if (severity && !["minor", "moderate", "severe", "unknown"].includes(severity)) errors.push("Unknown severity value.");
            if (injuries && !["none", "minor", "serious", "unknown"].includes(injuries)) errors.push("Unknown injury value.");
            if (!staged.length) errors.push("Attach at least one dashcam video or accident photo.");
            if (errors.length) {
                await cleanStagedFiles(staged);
                return res.status(400).json({ message: "Validation failed", errors });
            }

            const evidence = [];
            try {
                for (const file of staged) {
                    evidence.push(await saveStagedFile({
                        stagedPath: file.path,
                        originalname: file.originalname,
                        mimetype: file.mimetype,
                        size: file.size,
                    }));
                }
            } catch (storeErr) {
                // Without retrievable media there is nothing for an officer to check,
                // so the whole submission is refused rather than half-recorded.
                console.error("accident media storage failed:", storeErr.message);
                await cleanStagedFiles(staged);
                return res.status(503).json({
                    message: "Evidence storage is unavailable on this server, so nothing was recorded. Check that the application can write to its uploads folder.",
                });
            }

            const event = new DamageEvent({
                vehicle: vehicle._id,
                regNumber: vehicle.regNumber,
                eventType: "accident-damage",
                eventDate: d,
                description: String(description).trim(),
                severity: ["minor", "moderate", "severe", "unknown"].includes(severity) ? severity : "unknown",
                verificationStatus: "reported",
                submittedBy: req.user.id,
                submitterName: `${req.user.name} [OWNER]`,
                sourceChannel: "owner-upload",
                accident: {
                    location: String(location).trim(),
                    oppositePartyRegNumber: oppositePartyRegNumber ? String(oppositePartyRegNumber).toUpperCase().trim() : null,
                    oppositePartyName: oppositePartyName || null,
                    oppositePartyPhone: oppositePartyPhone || null,
                    oppositePartyInsurance: oppositePartyInsurance || null,
                    policeStation: policeStation || null,
                    firNumber: firNumber || null,
                    injuries: ["none", "minor", "serious", "unknown"].includes(injuries) ? injuries : "unknown",
                },
                officerReview: { outcome: "pending" },
                evidence,
            });

            event.anchor = {
                ...(await anchorRecord(event.toObject(), `accident-upload ${vehicle.regNumber}`)),
                evidenceHashes: evidence.map((e) => ({ file: e.fileName, sha256: e.sha256 })),
            };

            try {
                await event.save();
            } catch (saveErr) {
                await removeMediaForEvent(evidence);
                throw saveErr;
            }

            // Officers see it in their queue without having to go looking
            const alertPriority = event.accident.injuries === "serious" ? "critical" : "high";
            for (const role of ["police", "rto"]) {
                try {
                    await createRoleNotification({
                        type: "accident-evidence",
                        title: `Accident evidence uploaded - ${vehicle.regNumber}`,
                        message: `${req.user.name} uploaded ${evidence.length} accident file(s) for ${vehicle.regNumber}${event.accident.firNumber ? ` (FIR ${event.accident.firNumber})` : ""}. Verification required.`,
                        role,
                        relatedVehicle: vehicle._id,
                        priority: alertPriority,
                        actionRequired: true,
                        actionUrl: `/${role === "police" ? "police" : "rto"}?tab=accidents`,
                    });
                } catch (notifyErr) {
                    // The submission is already safe; a missed alert must not lose it
                    console.error("accident upload notification failed:", notifyErr.message);
                }
            }

            res.status(201).json({
                success: true,
                message: "Accident evidence recorded as REPORTED. Police and RTO officers have been alerted and must verify it before it is shown as verified.",
                event: {
                    ...event.toObject(),
                    evidence: event.evidence.map((e) => ({ fileName: e.fileName, contentType: e.contentType, fileSize: e.fileSize, sha256: e.sha256, storage: e.storage })),
                },
            });
        } catch (err) {
            // Files already moved onto a record are untouched by this: their staged
            // path no longer exists, and discardStagedFile ignores a missing file.
            await cleanStagedFiles(staged);
            console.error("accident-upload error:", err.message);
            res.status(500).json({ message: "Server error" });
        }
    },
);

// Officer review queue: every owner-submitted accident, newest first
router.get("/accident-uploads", authRequired, requireRole("police", "rto", "admin"), async (req, res) => {
    try {
        const filter = { sourceChannel: "owner-upload" };
        const wanted = String(req.query.status || "pending");
        if (wanted === "all") {
            // no status filter
        } else if (["reported", "verified", "disputed"].includes(wanted)) {
            filter.verificationStatus = wanted;
        } else {
            filter.verificationStatus = "reported";
        }

        const events = await DamageEvent.find(filter)
            .select("-evidence.data")
            .sort({ createdAt: -1 })
            .limit(100)
            .populate("submittedBy", "name email phone")
            .lean();

        res.json({
            success: true,
            total: events.length,
            uploads: events.map((e) => ({
                _id: e._id,
                regNumber: e.regNumber,
                vehicle: e.vehicle,
                eventDate: e.eventDate,
                description: e.description,
                severity: e.severity,
                verificationStatus: e.verificationStatus,
                accident: e.accident,
                officerReview: e.officerReview,
                owner: { name: e.submittedBy?.name, email: e.submittedBy?.email, phone: e.submittedBy?.phone },
                media: (e.evidence || []).map((f, i) => ({
                    index: i, fileName: f.fileName, contentType: f.contentType,
                    fileSize: f.fileSize, sha256: f.sha256, storage: f.storage,
                    isVideo: String(f.contentType || "").startsWith("video/"),
                })),
                anchor: { recordHash: e.anchor?.recordHash, status: e.anchor?.status, txHash: e.anchor?.txHash },
                submittedAt: e.createdAt,
            })),
            note: "These are owner statements with their own media. A hash match proves the file has not changed since upload - it does not prove the account is truthful.",
        });
    } catch (err) {
        console.error("accident-uploads list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Play or download one evidence file. Officers get every upload; an owner can
// only retrieve the files they submitted themselves.
router.get("/accident-uploads/:eventId/media/:idx", authRequired, async (req, res) => {
    try {
        const event = await DamageEvent.findById(req.params.eventId).select("-evidence.data -anchor");
        if (!event) return res.status(404).json({ message: "Event not found" });
        const isOfficer = ["police", "rto", "admin"].includes(req.user.role);
        if (!isOfficer && String(event.submittedBy) !== req.user.id) {
            return res.status(403).json({ message: "Not authorized to view this evidence" });
        }
        const file = event.evidence[parseInt(req.params.idx, 10)];
        if (!file) return res.status(404).json({ message: "Evidence file not found" });

        if (file.storage === "disk") {
            const streamed = await streamMediaFile(file.toObject ? file.toObject() : file, req, res);
            if (streamed) return;
            return res.status(410).json({ message: "The stored file is no longer on this server's evidence disk." });
        }
        if (!file.data) return res.status(404).json({ message: "Evidence bytes not found" });
        res.set("Content-Type", file.contentType || "application/octet-stream");
        res.set("Content-Disposition", `inline; filename="${file.fileName}"`);
        res.send(file.data);
    } catch (err) {
        console.error("accident media fetch error:", err.message);
        if (!res.headersSent) res.status(500).json({ message: "Server error" });
    }
});

// ===========================================================================
// FEATURE 7: Electric Vehicle Battery Passport
// ===========================================================================

const SOURCE_TYPES = ["unverified", "owner-reported", "workshop-verified", "diagnostic-device", "simulated-demo"];

router.get("/vehicle-history/:vehicleId/battery", authRequired, async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const passport = await BatteryPassport.findOne({ vehicle: access.vehicle._id }).populate("events.recordedBy", "name role").lean();
        if (!passport) {
            return res.json({ success: true, exists: false, vehicle: { id: access.vehicle._id, regNumber: access.vehicle.regNumber, make: access.vehicle.make }, message: "No battery passport created for this vehicle yet." });
        }
        // Health trend chart points (only real/submitted values, labelled by source)
        const chart = (passport.events || [])
            .filter(e => typeof e.stateOfHealthPercent === "number")
            .map(e => ({ date: e.eventDate, soh: e.stateOfHealthPercent, source: e.sourceType }))
            .sort((a, b) => new Date(a.date) - new Date(b.date));
        res.json({ success: true, exists: true, passport, healthChart: chart });
    } catch (err) {
        console.error("battery get error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Create a battery passport (authorized submitter, EV only by declaration)
router.post("/vehicle-history/:vehicleId/battery", authRequired, requireRole(...SUBMITTER_ROLES), async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const profile = await getSubmitterProfile(req.user.id);
        if (profile?.error) return res.status(403).json({ message: profile.error });

        const { batteryIdentifier, manufacturer, chemistry, nominalCapacityKwh, installationDate, isElectric } = req.body;
        const errors = [];
        if (!batteryIdentifier || !String(batteryIdentifier).trim()) errors.push("Battery identifier is required.");
        if (isElectric === false) errors.push("A battery passport applies only to electric vehicles.");
        if (nominalCapacityKwh != null && (!Number.isFinite(Number(nominalCapacityKwh)) || Number(nominalCapacityKwh) <= 0)) errors.push("Nominal capacity must be a positive number.");
        if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

        const existing = await BatteryPassport.findOne({ vehicle: access.vehicle._id });
        if (existing) return res.status(409).json({ message: "This vehicle already has a battery passport. Add a history event instead." });

        const passport = new BatteryPassport({
            vehicle: access.vehicle._id, regNumber: access.vehicle.regNumber, isElectric: true,
            batteryIdentifier: normalizeSerial(batteryIdentifier), manufacturer: manufacturer || null,
            chemistry: ["lithium-ion", "lfp", "nickel-metal-hydride", "solid-state", "other", "unknown"].includes(chemistry) ? chemistry : "unknown",
            nominalCapacityKwh: nominalCapacityKwh ? Number(nominalCapacityKwh) : undefined,
            installationDate: installationDate ? new Date(installationDate) : undefined, events: []
        });
        passport.anchor = await anchorRecord(passport.toObject(), `battery ${access.vehicle.regNumber}`);
        await passport.save();
        res.status(201).json({ success: true, message: "Battery passport created. Add verified history events over time.", passport });
    } catch (err) {
        console.error("battery create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// Append a battery history event (never overwrites prior events)
router.post("/battery/:vehicleId/events", authRequired, async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const passport = await BatteryPassport.findOne({ vehicle: access.vehicle._id });
        if (!passport) return res.status(404).json({ message: "Create a battery passport first." });

        const { eventType, eventDate, stateOfHealthPercent, capacityKwh, cycleCount, rangeKmEstimate, replacementDetails, warrantyDetails, sourceType, sourceDescription, notes } = req.body;
        const errors = [];
        if (!["initial-report", "soh-report", "replacement", "warranty-update", "charging-data", "inspection"].includes(eventType)) errors.push("Invalid event type.");
        if (!SOURCE_TYPES.includes(sourceType)) errors.push("Every battery value must declare its source (no automatic battery reading exists).");
        const d = eventDate ? new Date(eventDate) : new Date();
        if (isNaN(d.getTime()) || d > new Date()) errors.push("Invalid or future event date.");
        if (stateOfHealthPercent != null && (isNaN(Number(stateOfHealthPercent)) || Number(stateOfHealthPercent) < 0 || Number(stateOfHealthPercent) > 100)) errors.push("State of health must be 0-100.");
        if (errors.length) return res.status(400).json({ message: "Validation failed", errors });

        // Workshops may only submit verified values; owners submit owner-reported
        const profile = await getSubmitterProfile(req.user.id);
        if (profile?.error) return res.status(403).json({ message: profile.error });

        const ev = {
            eventType, eventDate: d, sourceType, sourceDescription: sourceDescription || null, notes: notes || null,
            recordedBy: req.user.id
        };
        if (stateOfHealthPercent != null) ev.stateOfHealthPercent = Number(stateOfHealthPercent);
        if (capacityKwh != null) ev.capacityKwh = Number(capacityKwh);
        if (cycleCount != null) ev.cycleCount = Number(cycleCount);
        if (rangeKmEstimate != null) ev.rangeKmEstimate = Number(rangeKmEstimate);
        if (replacementDetails) ev.replacementDetails = String(replacementDetails);
        if (warrantyDetails) ev.warrantyDetails = { provider: warrantyDetails.provider, coveredUntil: warrantyDetails.coveredUntil ? new Date(warrantyDetails.coveredUntil) : undefined, terms: warrantyDetails.terms };
        ev.anchor = await anchorRecord({ eventType, eventDate: d, stateOfHealthPercent: ev.stateOfHealthPercent, capacityKwh: ev.capacityKwh, sourceType, sourceDescription }, "battery-event");

        passport.events.push(ev);
        // Derived latest SoH (the events array itself is never overwritten)
        if (ev.stateOfHealthPercent != null) { passport.currentSoH = ev.stateOfHealthPercent; passport.lastTestedAt = d; passport.lastSource = sourceType; }
        await passport.save();
        res.status(201).json({ success: true, message: "Battery history event appended. Prior events are preserved.", passport });
    } catch (err) {
        console.error("battery event error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// ---------------------------------------------------------------------------
// Vehicle Intelligence Requests: owner asks, authorized workshop answers
// The records themselves always live on the VEHICLE, so once the workshop
// responds, the data is visible to the owner - and to any future buyer.
// ---------------------------------------------------------------------------

// POST /request { vehicleId, requestedItems: ["service",...], note }
router.post("/request", authRequired, requireRole("owner", "admin"), async (req, res) => {
    try {
        const { vehicleId, requestedItems, note } = req.body;
        if (!vehicleId || !Array.isArray(requestedItems) || requestedItems.length === 0) {
            return res.status(400).json({ message: "vehicleId and a non-empty requestedItems list are required." });
        }
        const bad = requestedItems.filter((i) => !["service", "odometer", "parts", "battery", "damage"].includes(i));
        if (bad.length) return res.status(400).json({ message: `Unknown item types: ${bad.join(", ")}` });

        const vehicle = await Vehicle.findById(vehicleId);
        if (!vehicle) return res.status(404).json({ message: "Vehicle not found" });
        if (String(vehicle.currentOwner) !== String(req.user.id)) {
            return res.status(403).json({ message: "You can only request a report for a vehicle you own." });
        }

        // Find the brand-matched verified workshop for this vehicle's make
        const candidates = await User.find({ role: "workshop", "workshopDetails.verified": true });
        const workshop = candidates.find(
            (u) => normalizeManufacturer(u.workshopDetails?.affiliatedManufacturer) === normalizeManufacturer(vehicle.make)
        );
        if (!workshop) {
            return res.status(404).json({
                message: `No verified workshop is registered for ${vehicle.make} vehicles yet. Ask an authorized ${vehicle.make} service centre to create and verify a workshop account.`
            });
        }

        // Reuse an existing open request for the same vehicle instead of duplicating
        let request = await VehicleIntelRequest.findOne({ vehicle: vehicle._id, requester: req.user.id, status: "pending" });
        if (request) {
            request.requestedItems = [...new Set([...request.requestedItems, ...requestedItems])];
            request.note = note || request.note;
            await request.save();
            return res.json({ success: true, message: "Updated your existing open request to the workshop.", request });
        }

        request = await VehicleIntelRequest.create({
            vehicle: vehicle._id,
            requester: req.user.id,
            workshop: workshop._id,
            requestedItems,
            note: note || undefined
        });
        res.status(201).json({
            success: true,
            message: `Request sent to ${workshop.workshopDetails?.companyName || workshop.name}. They will reply with the verified records.`,
            request
        });
        createNotification({
            type: "intel-request",
            title: "New vehicle intelligence request",
            message: `${req.user.name} requested verified records (${requestedItems.join(", ")}) for ${vehicle.make} ${vehicle.model || ""} ${vehicle.regNumber || ""}.`,
            recipient: workshop._id,
            recipientRole: "workshop",
            relatedVehicle: vehicle._id,
            relatedRequest: request._id,
            requestModel: "VehicleIntelRequest",
            actionRequired: true,
            actionUrl: "/workshop?tab=requests"
        }).catch((e) => console.error("intel-request notify failed:", e.message));
    } catch (err) {
        console.error("intel-request create error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /my-requests - owner view (with a vehicle + workshop summary)
router.get("/my-requests", authRequired, requireRole("owner", "admin"), async (req, res) => {
    try {
        const requests = await VehicleIntelRequest.find({ requester: req.user.id })
            .sort({ createdAt: -1 })
            .populate("vehicle", "regNumber make model year")
            .populate("workshop", "name workshopDetails.companyName");
        res.json({ success: true, requests });
    } catch (err) {
        console.error("intel-request list error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /incoming-requests - workshop view (requests assigned to me)
router.get("/incoming-requests", authRequired, requireRole("workshop", "admin"), async (req, res) => {
    try {
        const query = req.user.role === "workshop" ? { workshop: req.user.id } : {};
        const requests = await VehicleIntelRequest.find(query)
            .sort({ status: 1, createdAt: -1 })
            .populate("vehicle", "regNumber make model year chassisNumber")
            .populate("requester", "name email phone");
        res.json({ success: true, requests });
    } catch (err) {
        console.error("intel-request incoming error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// PUT /requests/:id/respond { note?, recordsCreated?: [{type,id}] }
// The workshop first creates the vehicle records (existing endpoints), then
// marks the request answered; completion is hashed and anchored on-chain.
router.put("/requests/:id/respond", authRequired, requireRole("workshop", "admin"), async (req, res) => {
    try {
        const request = await VehicleIntelRequest.findById(req.params.id);
        if (!request) return res.status(404).json({ message: "Request not found" });
        if (req.user.role === "workshop" && String(request.workshop) !== String(req.user.id)) {
            return res.status(403).json({ message: "This request is assigned to a different workshop." });
        }
        if (request.status === "responded") {
            return res.status(409).json({ message: "This request was already answered." });
        }

        const { note, recordsCreated } = req.body;
        const cleanRecords = (Array.isArray(recordsCreated) ? recordsCreated : [])
            .filter((r) => r && ["service", "parts", "battery", "damage"].includes(r.type) && isValidObjectId(r.id))
            .map((r) => ({ type: r.type, id: r.id }));

        // Nothing pasted? Auto-attach every record THIS submitter created for
        // this vehicle after the request arrived - the usual case.
        if (cleanRecords.length === 0) {
            const since = request.createdAt;
            const [svc, comp, dmg, batt] = await Promise.all([
                ServiceRecord.find({ vehicle: request.vehicle, submittedBy: req.user.id, createdAt: { $gte: since } }).select("_id"),
                ComponentRecord.find({ vehicle: request.vehicle, recordedBy: req.user.id, createdAt: { $gte: since } }).select("_id"),
                DamageEvent.find({ vehicle: request.vehicle, submittedBy: req.user.id, createdAt: { $gte: since } }).select("_id"),
                BatteryPassport.findOne({ vehicle: request.vehicle, recordedBy: req.user.id, createdAt: { $gte: since } }).select("_id")
            ]);
            svc.forEach((r) => cleanRecords.push({ type: "service", id: r._id }));
            comp.forEach((r) => cleanRecords.push({ type: "parts", id: r._id }));
            dmg.forEach((r) => cleanRecords.push({ type: "damage", id: r._id }));
            if (batt) cleanRecords.push({ type: "battery", id: batt._id });
        }

        request.status = "responded";
        request.response = {
            submittedBy: req.user.id,
            submittedAt: new Date(),
            note: note || undefined,
            recordsCreated: cleanRecords
        };
        request.anchor = await anchorRecord(
            {
                requestId: String(request._id),
                vehicle: String(request.vehicle),
                requester: String(request.requester),
                items: request.requestedItems,
                recordsCreated: cleanRecords.map((r) => `${r.type}:${String(r.id)}`),
                respondedAt: request.response.submittedAt
            },
            "intel-request-response"
        );
        await request.save();
        createNotification({
            type: "intel-response",
            title: "Your vehicle report is ready",
            message: `${req.user.name ? req.user.name : "The workshop"} replied to your vehicle intelligence request. Open Vehicle Reports to see the verified records.`,
            recipient: request.requester,
            recipientRole: "owner",
            relatedVehicle: request.vehicle,
            relatedRequest: request._id,
            requestModel: "VehicleIntelRequest",
            actionUrl: "/owner?tab=reports"
        }).catch((e) => console.error("intel-response notify failed:", e.message));
        res.json({ success: true, message: "Response submitted. The vehicle owner sees the report immediately.", request });
    } catch (err) {
        console.error("intel-request respond error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

// GET /vehicle-summary/:vehicleId - compact intelligence summary used by the
// owner dashboard rows and the resale offer view (and bundled into transfers).
router.get("/vehicle-summary/:vehicleId", authRequired, async (req, res) => {
    try {
        const access = await loadVehicleForUser(req.params.vehicleId, req.user);
        if (access.error) return res.status(access.error).json({ message: access.message });
        const vehicle = access.vehicle;

        const [serviceAgg, latestService, components, damage, battery] = await Promise.all([
            ServiceRecord.countDocuments({ vehicle: vehicle._id }),
            ServiceRecord.findOne({ vehicle: vehicle._id }).sort({ odometerKm: -1 }).select("serviceDate odometerKm serviceType status"),
            ComponentRecord.countDocuments({ vehicle: vehicle._id }),
            DamageEvent.countDocuments({ vehicle: vehicle._id }),
            BatteryPassport.findOne({ vehicle: vehicle._id }).select("currentSoH lastTestedAt packHealth")
        ]);

        res.json({
            success: true,
            vehicle: { _id: vehicle._id, regNumber: vehicle.regNumber, make: vehicle.make, model: vehicle.model, year: vehicle.year, fuelType: vehicle.fuelType },
            summary: {
                serviceRecords: serviceAgg,
                latestService: latestService
                    ? { date: latestService.serviceDate, odometerKm: latestService.odometerKm, type: latestService.serviceType, verified: latestService.anchor?.status === "anchored" || latestService.anchor?.status === "pending" }
                    : null,
                partsTracked: components,
                damageEvents: damage,
                battery: battery ? { currentSoH: battery.currentSoH ?? null, lastTestedAt: battery.lastTestedAt || null } : null
            }
        });
    } catch (err) {
        console.error("vehicle-summary error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
});

export default router;
