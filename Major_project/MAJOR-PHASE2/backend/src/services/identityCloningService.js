// identityCloningService.js
// Feature 5: Cross-Record Vehicle Identity Cloning Detector
//
// Conservative, EXACT-match detection only. Identifiers are normalized with
// SAFE transformations (uppercase, strip non-alphanumerics, collapse spaces)
// and compared for EXACT duplicates. There is deliberately NO fuzzy matching
// that could auto-accuse a person; uncertain cases are left for human review.
// The detector never deletes or silently edits data - it records conflicts.

import mongoose from "mongoose";
import { Vehicle } from "../models/Vehicle.js";
import { IdentityConflict } from "../models/IdentityConflict.js";

// Safe normalization: no invented characters, no external lookups.
export const normalizeIdentifier = (raw) =>
    String(raw || "")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "") // drop separators only
        .trim();

const upsertConflict = async (conflictType, identifierValue, vehicleDoc, rawValue) => {
    const existing = await IdentityConflict.findOne({ conflictType, identifierValue });
    if (existing) {
        const vid = String(vehicleDoc._id);
        if (!existing.vehicles.some(v => String(v) === vid)) existing.vehicles.push(vehicleDoc._id);
        if (vehicleDoc.regNumber && !existing.regNumbers.includes(vehicleDoc.regNumber)) {
            existing.regNumbers.push(vehicleDoc.regNumber);
        }
        if (rawValue && !existing.rawValues.includes(rawValue)) existing.rawValues.push(rawValue);
        existing.lastCheckedAt = new Date();
        await existing.save();
        return { created: false, conflict: existing };
    }
    const conflict = await IdentityConflict.create({
        conflictType,
        identifierValue,
        rawValues: rawValue ? [rawValue] : [],
        vehicles: [vehicleDoc._id],
        regNumbers: vehicleDoc.regNumber ? [vehicleDoc.regNumber] : [],
        lastCheckedAt: new Date()
    });
    return { created: true, conflict };
};

/**
 * Scan the whole vehicle collection for exact duplicate chassis/engine values
 * (after normalization) and conflicting reg->vehicle associations.
 * Reports conflicts only; takes no destructive action.
 */
export const scanForCloningConflicts = async () => {
    const vehicles = await Vehicle.find({})
        .select("_id regNumber chassisNumber engineNumber make model")
        .lean();

    const byChassis = {};
    const byEngine = {};
    const byReg = {};

    for (const v of vehicles) {
        const ch = normalizeIdentifier(v.chassisNumber);
        const en = normalizeIdentifier(v.engineNumber);
        const rg = normalizeIdentifier(v.regNumber);
        if (ch) (byChassis[ch] = byChassis[ch] || []).push(v);
        if (en) (byEngine[en] = byEngine[en] || []).push(v);
        if (rg) (byReg[rg] = byReg[rg] || []).push(v);
    }

    const summary = { duplicateChassis: [], duplicateEngine: [], conflictingRegistration: [] };

    for (const [value, list] of Object.entries(byChassis)) {
        if (list.length > 1) {
            for (const v of list) await upsertConflict("duplicate-chassis", value, v, v.chassisNumber);
            summary.duplicateChassis.push({ value, count: list.length, vehicles: list.map(v => v._id) });
        }
    }
    for (const [value, list] of Object.entries(byEngine)) {
        if (list.length > 1) {
            for (const v of list) await upsertConflict("duplicate-engine", value, v, v.engineNumber);
            summary.duplicateEngine.push({ value, count: list.length, vehicles: list.map(v => v._id) });
        }
    }
    // A single reg number linked to more than one vehicle document = association conflict
    for (const [value, list] of Object.entries(byReg)) {
        if (list.length > 1) {
            for (const v of list) await upsertConflict("conflicting-registration-association", value, v, v.regNumber);
            summary.conflictingRegistration.push({ value, count: list.length, vehicles: list.map(v => v._id) });
        }
    }

    return {
        scanned: vehicles.length,
        detectedAt: new Date().toISOString(),
        note: "Exact-match detection only. No records were modified or deleted. Review each conflict before acting.",
        summary
    };
};

/**
 * Lightweight pre-save check for a NEW vehicle so a fresh exact duplicate is
 * refused where business rules allow, without touching legacy data.
 * Returns { ok } or { ok:false, conflicts:[...] }.
 */
export const checkIncomingVehicle = async ({ chassisNumber, engineNumber, regNumber }, { allowCorrection = false } = {}) => {
    // A legitimate authorized correction can bypass the block (flagged instead).
    const conflicts = [];
    const ch = normalizeIdentifier(chassisNumber);
    const en = normalizeIdentifier(engineNumber);
    const rg = normalizeIdentifier(regNumber);

    if (ch) {
        const matches = await Vehicle.find({}).select("_id regNumber chassisNumber").lean();
        const hit = matches.filter(v => normalizeIdentifier(v.chassisNumber) === ch);
        if (hit.length) conflicts.push({ type: "duplicate-chassis", value: ch, existing: hit.map(h => h._id) });
    }
    if (en) {
        const matches = await Vehicle.find({}).select("_id engineNumber").lean();
        const hit = matches.filter(v => normalizeIdentifier(v.engineNumber) === en);
        if (hit.length) conflicts.push({ type: "duplicate-engine", value: en, existing: hit.map(h => h._id) });
    }
    if (rg) {
        const matches = await Vehicle.find({}).select("_id regNumber").lean();
        const hit = matches.filter(v => normalizeIdentifier(v.regNumber) === rg);
        if (hit.length) conflicts.push({ type: "conflicting-registration-association", value: rg, existing: hit.map(h => h._id) });
    }

    if (conflicts.length === 0) return { ok: true };

    // Record (but do not resolve) the attempted conflict for the reviewer.
    for (const c of conflicts) {
        if (!allowCorrection) {
            // no vehicle doc yet; log against the existing vehicles
            for (const exId of c.existing) {
                if (mongoose.Types.ObjectId.isValid(exId)) {
                    const v = await Vehicle.findById(exId).lean();
                    if (v) await upsertConflict(c.type, c.value, { _id: exId, regNumber: v.regNumber }, c.value);
                }
            }
        }
    }
    return {
        ok: false,
        blockedNewRecord: !allowCorrection,
        conflicts,
        message: "Potential identity conflict detected. This record needs authorized review before it can be saved - it has NOT been automatically labelled fraudulent."
    };
};

export const listConflicts = async ({ reviewStatus, limit = 200 } = {}) => {
    const query = reviewStatus ? { reviewStatus } : {};
    return IdentityConflict.find(query)
        .sort({ detectedAt: -1 })
        .limit(limit)
        .populate("vehicles", "regNumber make model chassisNumber engineNumber status")
        .populate("linkedCase", "caseRef title status")
        .lean();
};
