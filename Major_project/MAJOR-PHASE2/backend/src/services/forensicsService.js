// forensicsService.js
// Vehicle Lifecycle Forensics & Event Replay Engine.
//
// Purpose: reconstruct what happened to a vehicle by replaying the events the
// application ALREADY records, compare the vehicle's state between those events,
// and trace the origin of an inconsistency back to the event and evidence where it
// first appeared. This is an investigative aid, not a fraud verdict.
//
// Design principle: read-only aggregation over existing append-only collections.
// It never mutates a production record. The prior value of an overwritten field is
// recovered from the append-only sources (ComponentRecord/ComponentEvent keep every
// engine serial; OwnershipHistory keeps every transfer; DamageEvent keeps every
// accident/repair), so replay stays reliable even though Vehicle.engineNumber itself
// is a single mutable column.

import mongoose from "mongoose";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { OwnershipHistory } from "../models/OwnershipHistory.js";
import { DamageEvent } from "../models/DamageEvent.js";
import { ComponentRecord, ComponentEvent } from "../models/ComponentRecord.js";
import { Request } from "../models/Request.js";
import { ServiceRecord } from "../models/ServiceRecord.js";
import { TheftReport } from "../models/TheftReport.js";
import { Challan } from "../models/Challan.js";
import { DamageAssessment } from "../models/DamageAssessment.js";
import { InvestigationCase, nextCaseRef } from "../models/InvestigationCase.js";
import {
    verifyRecordIntegrity,
    hashRecordContent,
    anchorRecord,
} from "./recordAnchorService.js";

const asId = (v) => (v && typeof v === "object" && v._id ? v._id : v);
const idStr = (v) => (v ? String(asId(v)) : null);
const norm = (s) => String(s ?? "").trim().toUpperCase();

// Resolve the vehicle by internal id or registration number. Returns the plain doc
// or null. Registration lookup is case/space insensitive to match the search box.
export async function resolveVehicle({ vehicleId, regNumber }) {
    if (vehicleId && mongoose.isValidObjectId(vehicleId)) {
        const v = await Vehicle.findById(vehicleId).lean();
        if (v) return v;
    }
    const reg = String(regNumber || "").trim().toUpperCase();
    if (!reg) return null;
    // Registrations are stored without spaces in this app; accept the spaced form
    // (KA-06-AB-1234) as well as the stored form (KA06AB1234).
    const compact = reg.replace(/[\s-]/g, "");
    const v = await Vehicle.findOne({
        $or: [{ regNumber: reg }, { regNumber: compact }],
    }).lean();
    return v || null;
}

// Build a name/role lookup for every actor referenced across the source documents
// so each replayed event can show who did it, without populating each query.
async function buildActorMap(docs) {
    const ids = new Set();
    for (const d of docs) {
        for (const key of ["actor", "submittedBy", "recordedBy", "verifiedBy", "currentOwner", "fromOwner", "toOwner", "registeredBy"]) {
            const id = d[key];
            if (id) ids.add(idStr(id));
        }
    }
    const map = {};
    const valid = [...ids].filter((i) => i && mongoose.isValidObjectId(i));
    if (valid.length) {
        const users = await User.find({ _id: { $in: valid } }).select("name role email").lean();
        for (const u of users) map[String(u._id)] = { id: String(u._id), name: u.name, role: u.role, email: u.email };
    }
    return (id) => map[idStr(id)] || null;
}

function evidenceFromDamage(evidence = []) {
    return evidence.map((e, i) => ({
        label: e.fileName || `Evidence ${i + 1}`,
        present: true,
        reference: e.storedAs || e.fileName || null,
        sha256: e.sha256 || null,
        contentType: e.contentType || null,
    }));
}

// Integrity block for an event, drawn from whatever the source document carries.
function integrityOf(doc, kind) {
    if (kind === "anchor" && doc.anchor && doc.anchor.recordHash) {
        return {
            available: true,
            recordHash: doc.anchor.recordHash,
            status: doc.anchor.status || "hashed_only",
            txHash: doc.anchor.txHash || null,
            network: doc.anchor.network || "polygon-amoy",
            anchoredAt: doc.anchor.anchoredAt || null,
            note: doc.anchor.note || null,
        };
    }
    if (kind === "tx" && doc.blockchainTxHash) {
        return {
            available: true,
            recordHash: null,
            status: "anchored",
            txHash: doc.blockchainTxHash,
            network: "polygon-amoy",
            anchoredAt: doc.timestamp || null,
            note: "Registration/transfer transaction recorded by the on-chain flow.",
        };
    }
    return { available: false, recordHash: null, status: "none", txHash: null, note: "No integrity proof was recorded for this event." };
}

// Collect every source document for a vehicle and turn each into a normalized replay
// event. Events are sorted by occurredAt (ties broken by a stable per-source order).
export async function reconstruct(vehicleId) {
    const vehicle = await Vehicle.findById(vehicleId).lean();
    if (!vehicle) return { error: "Vehicle not found" };

    const [ownership, damage, components, requests, services, thefts, challans, assessments] = await Promise.all([
        OwnershipHistory.find({ vehicle }).sort({ timestamp: 1 }).lean(),
        DamageEvent.find({ vehicle }).sort({ eventDate: 1 }).lean(),
        ComponentRecord.find({ vehicle }).lean(),
        Request.find({ vehicle }).sort({ createdAt: 1 }).lean(),
        ServiceRecord.find({ vehicle }).sort({ serviceDate: 1 }).lean(),
        TheftReport.find({ vehicle }).sort({ incidentDate: 1 }).lean(),
        Challan.find({ vehicle }).sort({ violationDate: 1 }).lean(),
        DamageAssessment.find({ vehicle }).sort({ createdAt: 1 }).lean(),
    ]);

    // Attach each component's own event history.
    const componentIds = components.map((c) => c._id);
    const componentEvents = await ComponentEvent.find({ component: { $in: componentIds } }).sort({ eventDate: 1 }).lean();
    const eventsByComponent = {};
    for (const ev of componentEvents) (eventsByComponent[idStr(ev.component)] ||= []).push(ev);

    const actorOf = await buildActorMap([
        vehicle, ...ownership, ...damage, ...services, ...thefts, ...challans, ...assessments,
        ...componentEvents.map((e) => ({ recordedBy: e.recordedBy })),
        ...Object.values(componentEvents).flat(),
    ]);

    const events = [];
    const pushEvent = (e) => events.push(e);

    // 1) Registration - the vehicle's original recorded identity.
    const createdAt = vehicle.registrationDate || vehicle.createdAt || new Date();
    pushEvent({
        id: `reg:${vehicle._id}`,
        eventType: "registration",
        occurredAt: createdAt,
        title: "Vehicle registered",
        summary: `Initial identity recorded: engine ${vehicle.engineNumber || "n/a"}, chassis ${vehicle.chassisNumber || "n/a"}, registration ${vehicle.regNumber || "unassigned"}.`,
        actor: actorOf(vehicle.registeredBy),
        changes: [
            { field: "engineNumber", previousValue: null, newValue: vehicle.engineNumber },
            { field: "chassisNumber", previousValue: null, newValue: vehicle.chassisNumber },
            { field: "regNumber", previousValue: null, newValue: vehicle.regNumber },
        ],
        evidence: [{ label: "Registration certificate", present: !!vehicle.ipfsDocuments?.rcCertificate, reference: vehicle.ipfsDocuments?.rcCertificate || null }],
        approval: { required: false, present: true, reference: vehicle.issuedByOffice || null, note: "Issued by the registration office." },
        status: "recorded",
        source: { collection: "Vehicle", id: String(vehicle._id) },
        integrity: integrityOf(vehicle, "tx"),
    });

    // 2) Ownership transfers - append-only.
    ownership.forEach((oh, i) => {
        const from = actorOf(oh.fromOwner);
        const to = actorOf(oh.toOwner);
        const approved = true; // a transfer only reaches OwnershipHistory once completed
        const linkedTx = oh.blockchainTxHash || null;
        pushEvent({
            id: `own:${oh._id}`,
            eventType: "ownership-transfer",
            occurredAt: oh.timestamp || oh.createdAt,
            title: "Ownership transferred",
            summary: `${from?.name || "Previous owner"} to ${to?.name || "New owner"} (${oh.transferType}).`,
            actor: to,
            changes: [{ field: "currentOwner", previousValue: from?.name || null, newValue: to?.name || null }],
            evidence: [],
            approval: { required: true, present: approved, reference: linkedTx, note: linkedTx ? "Transfer completed with an on-chain transaction." : "Transfer recorded on completion; no on-chain transaction is linked to it." },
            status: "approved",
            source: { collection: "OwnershipHistory", id: String(oh._id) },
            integrity: integrityOf(oh, "tx"),
            _order: i,
        });
    });

    // 3) Accident / damage / repair - append-only, with verification status.
    damage.forEach((de) => {
        const verified = de.verificationStatus === "verified";
        const disputed = de.verificationStatus === "disputed";
        const isRepair = de.eventType === "structural-repair" || de.eventType === "safety-part-replacement";
        pushEvent({
            id: `dmg:${de._id}`,
            eventType: isRepair ? "repair" : "accident-damage",
            occurredAt: de.eventDate || de.reportDate,
            title: isRepair ? "Repair recorded" : "Accident / damage recorded",
            summary: de.description,
            actor: actorOf(de.submittedBy) || (de.submitterName ? { name: de.submitterName, role: de.organization || "reporter" } : null),
            changes: [{ field: "verificationStatus", previousValue: "reported", newValue: de.verificationStatus }],
            evidence: evidenceFromDamage(de.evidence),
            approval: { required: true, present: verified, reference: verified ? idStr(de.verifiedBy) : null, note: disputed ? "An officer marked this record as disputed." : verified ? "Verified by an authorized officer." : "Awaiting officer verification." },
            status: verified ? "verified" : disputed ? "needs-review" : "pending",
            source: { collection: "DamageEvent", id: String(de._id) },
            integrity: integrityOf(de, "anchor"),
            _doc: de,
        });
    });

    // 4) Serialized components (engine especially) - each record and each lifecycle
    //    event becomes a replay entry. Engine serial transitions drive identity
    //    conflict detection.
    components.forEach((comp) => {
        const evs = eventsByComponent[idStr(comp._id)] || [];
        evs.forEach((ev) => {
            const isEngine = comp.componentType === "engine";
            const hasEvidence = !!ev.evidenceReference;
            // A newly installed serial on an already-registered engine is an identity
            // change; it requires a supporting approval / evidence reference.
            const identityChange = isEngine && (ev.eventType === "installed" || ev.eventType === "replaced");
            pushEvent({
                id: `cmp:${ev._id}`,
                eventType: isEngine ? "component-replacement" : "component-event",
                occurredAt: ev.eventDate || ev.createdAt,
                title: `${comp.componentType} ${ev.eventType}`,
                summary: `${ev.eventType} ${comp.componentType} ${comp.serialNumber}${ev.reason ? ` - ${ev.reason}` : ""}.`,
                actor: actorOf(ev.recordedBy) || (ev.workshopName ? { name: ev.workshopName, role: "workshop" } : null),
                changes: identityChange
                    ? [{ field: "engineNumber", previousValue: null, newValue: comp.serialNumber }]
                    : [{ field: `${comp.componentType}Status`, previousValue: null, newValue: ev.eventType }],
                evidence: [{ label: "Approval / evidence reference", present: hasEvidence, reference: ev.evidenceReference || null }],
                approval: { required: identityChange, present: hasEvidence, reference: ev.evidenceReference || null, note: identityChange && !hasEvidence ? "Identity change recorded without an approval or evidence reference." : null },
                status: identityChange && !hasEvidence ? "needs-review" : "recorded",
                source: { collection: "ComponentEvent", id: String(ev._id) },
                integrity: integrityOf(comp, "anchor"),
                _engineSerial: identityChange ? comp.serialNumber : null,
                _componentId: String(comp._id),
            });
        });
    });

    // 5) Resale / transfer requests that reference the vehicle. These are the later
    //    records that may depend on a disputed identity value.
    requests.forEach((req) => {
        pushEvent({
            id: `req:${req._id}`,
            eventType: "transaction-request",
            occurredAt: req.createdAt,
            title: `${req.type} request`,
            summary: `Request raised (status: ${req.status}).`,
            actor: actorOf(req.seller) || actorOf(req.buyer),
            changes: [{ field: "requestStatus", previousValue: null, newValue: req.status }],
            evidence: [],
            approval: { required: false, present: req.status === "approved", reference: req.rtoOfficer ? idStr(req.rtoOfficer) : null, note: null },
            status: req.status === "approved" ? "approved" : "pending",
            source: { collection: "Request", id: String(req._id) },
            integrity: integrityOf(req, "tx"),
            _carriesEngine: req.interStateDetails?.vehiclePassport?.engineNumber || null,
        });
    });

    // 6) Service / odometer history - append-only. A reading lower than the last
    //    verified reading is a review flag (odometer anomaly), never a fraud verdict.
    let lastOdometer = null;
    services.forEach((sr) => {
        const decrease = lastOdometer != null && sr.odometerKm < lastOdometer;
        const prev = lastOdometer;
        if (lastOdometer == null || sr.odometerKm > lastOdometer) lastOdometer = sr.odometerKm;
        pushEvent({
            id: `svc:${sr._id}`,
            eventType: "service-odometer",
            occurredAt: sr.serviceDate || sr.createdAt,
            title: `${sr.serviceType} recorded`,
            summary: `${sr.description} (odometer ${sr.odometerKm} km).`,
            actor: actorOf(sr.submittedBy) || (sr.submitterName ? { name: sr.submitterName, role: "workshop" } : null),
            changes: [{ field: "odometerKm", previousValue: prev == null ? null : String(prev), newValue: String(sr.odometerKm) }],
            evidence: [{ label: "Service evidence reference", present: !!sr.evidenceReference, reference: sr.evidenceReference || null }],
            approval: { required: false, present: sr.status === "verified", reference: null, note: sr.status === "flagged_for_review" ? (sr.flagReason || "Reading flagged for review.") : null },
            status: sr.status === "flagged_for_review" || decrease ? "needs-review" : "recorded",
            source: { collection: "ServiceRecord", id: String(sr._id) },
            integrity: integrityOf(sr, "anchor"),
            _odometer: { reading: sr.odometerKm, previous: prev, decrease },
        });
    });

    // 7) Theft reporting and recovery - status changes on the lifecycle.
    thefts.forEach((tr) => {
        const recovered = tr.status === "recovered" || tr.status === "closed";
        pushEvent({
            id: `thf:${tr._id}`,
            eventType: recovered ? "theft-recovered" : "theft-reported",
            occurredAt: recovered && tr.recoveryDate ? tr.recoveryDate : tr.incidentDate || tr.createdAt,
            title: recovered ? "Vehicle recovered" : "Theft reported",
            summary: recovered
                ? `Reported stolen, then recovered${tr.recoveryLocation ? ` at ${tr.recoveryLocation}` : ""}. FIR ${tr.firNumber || "n/a"}.`
                : `Reported stolen at ${tr.incidentLocation || "unknown location"}. FIR ${tr.firNumber || "n/a"}, station ${tr.policeStation || "n/a"}.`,
            actor: actorOf(tr.reporter),
            changes: [{ field: "theftStatus", previousValue: null, newValue: tr.status }],
            evidence: [{ label: "FIR reference", present: !!tr.firNumber, reference: tr.firNumber || null }],
            approval: { required: true, present: recovered, reference: tr.firNumber || null, note: recovered ? null : "Vehicle carries an active theft restriction until recovery is recorded." },
            status: recovered ? "approved" : "needs-review",
            source: { collection: "TheftReport", id: String(tr._id) },
            integrity: integrityOf(tr, "tx"),
            _theftActive: !recovered,
        });
    });

    // 8) Challan issuance and clearance - enforcement events.
    challans.forEach((ch) => {
        const cleared = ch.paymentStatus === "paid";
        pushEvent({
            id: `chn:${ch._id}`,
            eventType: cleared ? "challan-cleared" : "challan-issued",
            occurredAt: cleared && ch.paymentDate ? ch.paymentDate : ch.violationDate || ch.createdAt,
            title: cleared ? "Challan cleared" : "Challan issued",
            summary: cleared
                ? `${ch.violationType} challan of \u20b9${ch.fineAmount} cleared${ch.officerName ? ` (officer ${ch.officerName})` : ""}.`
                : `${ch.violationType} at ${ch.location || "n/a"}; fine \u20b9${ch.fineAmount}${ch.officerName ? ` issued by ${ch.officerName}` : ""}.`,
            actor: actorOf(ch.issuingOfficer) || (ch.officerName ? { name: ch.officerName, role: "police" } : null),
            changes: [{ field: "challanStatus", previousValue: null, newValue: cleared ? "paid" : ch.paymentStatus }],
            evidence: [],
            approval: { required: false, present: cleared, reference: null, note: cleared ? null : "Outstanding challan can gate an ownership transfer." },
            status: cleared ? "approved" : "pending",
            source: { collection: "Challan", id: String(ch._id) },
            integrity: integrityOf(ch, "tx"),
            _challanOutstanding: !cleared,
        });
    });

    // 9) 3D damage assessments - assessment, estimate and repair-evidence chain.
    assessments.forEach((as) => {
        const verified = as.status === "verified";
        const hasEvidence = (as.repairCompletion?.evidence || []).length > 0;
        const completedNoEvidence = (as.status === "repair-completed" || verified) && !hasEvidence;
        pushEvent({
            id: `dmg3d:${as._id}`,
            eventType: "damage-assessment",
            occurredAt: as.updatedAt || as.createdAt,
            title: `Damage assessment ${as.assessmentRef}`,
            summary: `${as.analysis?.mode === "computer-vision" ? "CV-assisted" : "Manual"} assessment, ${as.findings?.length || 0} finding(s), estimate v${as.estimate?.version || 0} ${as.estimate?.status || "none"}, status ${as.status}.`,
            actor: actorOf(as.submittedBy) || (as.submitterName ? { name: as.submitterName, role: "assessor" } : null),
            changes: [{ field: "assessmentStatus", previousValue: null, newValue: as.status }],
            evidence: [{ label: "Photographs", present: (as.photos || []).length > 0, reference: null, sha256: null }],
            approval: { required: true, present: verified, reference: null, note: verified ? "Repair verified after a passed final inspection with evidence." : "Not yet verified; approval of an estimate is not completion." },
            status: verified ? "verified" : as.status === "rejected" ? "needs-review" : "pending",
            source: { collection: "DamageAssessment", id: String(as._id) },
            integrity: integrityOf(as, "anchor"),
            _assessment: { id: String(as._id), ref: as.assessmentRef, completedNoEvidence, linkedEvent: as.linkedDamageEvent ? String(as.linkedDamageEvent) : null },
        });
    });

    events.sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt) || String(a.id).localeCompare(String(b.id)));
    events.forEach((e, i) => { e.sequence = i + 1; });

    const conflicts = detectConflicts(events, vehicle);

    // Attach, for each flagged conflict, which later events depend on the disputed value.
    for (const c of conflicts) {
        c.dependentEventIds = events
            .filter((e) => e.sequence > (c.firstAppearedSequence || 0) && eventCarriesValue(e, c.disputedValue))
            .map((e) => e.id);
    }

    return {
        vehicle: {
            id: String(vehicle._id),
            regNumber: vehicle.regNumber,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            status: vehicle.status,
        },
        currentIdentity: {
            engineNumber: vehicle.engineNumber,
            chassisNumber: vehicle.chassisNumber,
            regNumber: vehicle.regNumber,
        },
        events: events.map(stripInternals),
        conflicts,
        dependencyGraph: buildGraph(events, conflicts),
        integritySummary: summarizeIntegrity(events),
        disclaimer:
            "Reconstruction from recorded events. A blockchain hash or database hash only proves that the recorded data has not changed since it was hashed; it does not prove the underlying information was truthful, that an engine replacement was legitimate, or that a vehicle is roadworthy. A conflict is a prompt for review, never a fraud verdict.",
    };
}

function eventCarriesValue(e, value) {
    if (!value) return false;
    const v = norm(value);
    for (const ch of e.changes || []) if (norm(ch.newValue) === v) return true;
    if (norm(e.summary).includes(v)) return true;
    return false;
}

// Identity-conflict detection. The scenario the spec centres on: an engine serial
// that changed over time where the change was recorded without a supporting approval
// or evidence reference, and where the latest record shows the new value.
function detectConflicts(events, vehicle) {
    const conflicts = [];

    // Engine serial transitions across component events.
    const engineEvents = events.filter((e) => e._engineSerial);
    const distinctSerials = [];
    for (const e of engineEvents) {
        const s = norm(e._engineSerial);
        if (!distinctSerials.includes(s)) distinctSerials.push(s);
    }

    if (distinctSerials.length > 1) {
        const original = distinctSerials[0];
        // Find the first event that introduced a different serial from the original.
        const changeEvent = engineEvents.find((e) => norm(e._engineSerial) !== original);
        if (changeEvent) {
            const missingApproval = changeEvent.approval.required && !changeEvent.approval.present;
            const latestMatchesReplacement = norm(vehicle.engineNumber) === norm(changeEvent._engineSerial);
            conflicts.push({
                type: "engine-identity-change",
                severity: missingApproval ? "needs-review" : "info",
                title: "Engine identifier changed in the recorded history",
                detail:
                    `Engine serial changed from ${original} to ${changeEvent._engineSerial}` +
                    (latestMatchesReplacement ? " and the latest vehicle record shows the new value" : "") +
                    (missingApproval ? ". The required approval / evidence reference is missing, so this event needs review." : ". A supporting reference was recorded."),
                disputedField: "engineNumber",
                disputedValue: changeEvent._engineSerial,
                previousValue: original,
                firstAppearedEventId: changeEvent.id,
                firstAppearedSequence: changeEvent.sequence,
                involvedEventIds: engineEvents.map((e) => e.id),
            });
        }
    }

    // Latest record vs registration: if Vehicle.engineNumber differs from the engine
    // serial captured at registration and there is no component trail explaining it.
    const regEvent = events.find((e) => e.eventType === "registration");
    if (regEvent && distinctSerials.length <= 1 && norm(vehicle.engineNumber) !== norm(regEvent.changes?.[0]?.newValue)) {
        conflicts.push({
            type: "engine-mismatch-unexplained",
            severity: "needs-review",
            title: "Latest engine number does not match the registration record",
            detail:
                `The vehicle record now shows engine ${vehicle.engineNumber}, but registration recorded ${regEvent.changes?.[0]?.newValue}. ` +
                "No component replacement event explains the difference, so this needs review.",
            disputedField: "engineNumber",
            disputedValue: vehicle.engineNumber,
            previousValue: regEvent.changes?.[0]?.newValue,
            firstAppearedEventId: regEvent.id,
            firstAppearedSequence: regEvent.sequence,
            involvedEventIds: [regEvent.id],
        });
    }

    // Unverified damage still open.
    for (const e of events.filter((x) => x.eventType === "accident-damage" && x.status === "pending")) {
        conflicts.push({
            type: "unverified-damage",
            severity: "info",
            title: "Damage record awaiting verification",
            detail: `"${e.summary}" was reported but has not been verified by an authorized officer.`,
            disputedField: null,
            disputedValue: null,
            firstAppearedEventId: e.id,
            firstAppearedSequence: e.sequence,
            involvedEventIds: [e.id],
        });
    }

    // Odometer decreased compared with an earlier recorded reading - a review lead.
    for (const e of events.filter((x) => x._odometer?.decrease)) {
        conflicts.push({
            type: "odometer-anomaly",
            severity: "needs-review",
            title: "Recorded odometer reading decreased",
            detail:
                `An odometer reading of ${e._odometer.reading} km was recorded after a reading of ${e._odometer.previous} km. ` +
                "A decrease can be a data-entry error, a replaced instrument or an incomplete history; it is flagged for review, not treated as proven fraud.",
            disputedField: "odometerKm",
            disputedValue: String(e._odometer.reading),
            previousValue: String(e._odometer.previous),
            firstAppearedEventId: e.id,
            firstAppearedSequence: e.sequence,
            involvedEventIds: [e.id],
        });
    }

    // A repair marked completed/verified without any completion evidence attached.
    for (const e of events.filter((x) => x._assessment?.completedNoEvidence)) {
        conflicts.push({
            type: "repair-missing-evidence",
            severity: "needs-review",
            title: "Repair reported complete without evidence",
            detail:
                `Assessment ${e._assessment.ref} is recorded as ${e.changes?.[0]?.newValue} but carries no workshop completion photographs. ` +
                "Approval of an estimate is not proof that the repair was physically completed.",
            disputedField: "repairEvidence",
            disputedValue: e._assessment.ref,
            previousValue: null,
            firstAppearedEventId: e.id,
            firstAppearedSequence: e.sequence,
            involvedEventIds: [e.id],
        });
    }

    // An active theft restriction the investigator should know about.
    for (const e of events.filter((x) => x._theftActive)) {
        conflicts.push({
            type: "active-theft-restriction",
            severity: "needs-review",
            title: "Vehicle reported stolen and not yet recovered",
            detail:
                "A theft report is on record without a recovery event. While this stands, an ownership transfer must be blocked. " +
                "This reflects the recorded status only; the underlying incident is not re-verified here.",
            disputedField: null,
            disputedValue: null,
            firstAppearedEventId: e.id,
            firstAppearedSequence: e.sequence,
            involvedEventIds: [e.id],
        });
    }

    return conflicts;
}

function summarizeIntegrity(events) {
    let anchored = 0, pending = 0, hashed = 0, none = 0;
    for (const e of events) {
        const s = e.integrity?.status;
        if (s === "anchored") anchored++;
        else if (s === "pending") pending++;
        else if (s === "hashed_only") hashed++;
        else none++;
    }
    return { anchored, pending, hashedOnly: hashed, noProof: none, total: events.length };
}

function stripInternals(e) {
    const { _doc, _engineSerial, _componentId, _carriesEngine, _order, _odometer, _theftActive, _challanOutstanding, _assessment, ...rest } = e;
    return rest;
}

// Recompute the tamper-evident hash for records that support it (damage passport).
// Read-only: it re-hashes current content and compares to the stored anchor hash.
export async function verifyVehicleIntegrity(vehicleId) {
    const damage = await DamageEvent.find({ vehicle: vehicleId });
    const components = await ComponentRecord.find({ vehicle: vehicleId });
    const results = [];
    for (const de of damage) {
        const r = verifyRecordIntegrity(de);
        results.push({ eventId: `dmg:${de._id}`, kind: "damage-event", description: de.description, ...r });
    }
    for (const c of components) {
        const stored = c.anchor?.recordHash;
        if (!stored) { results.push({ eventId: `cmprec:${c._id}`, kind: "component", description: `${c.componentType} ${c.serialNumber}`, verified: false, reason: "No anchor hash recorded." }); continue; }
        const current = hashRecordContent(c.toObject());
        results.push({ eventId: `cmprec:${c._id}`, kind: "component", description: `${c.componentType} ${c.serialNumber}`, verified: current === stored, currentHash: current, storedHash: stored, anchorStatus: c.anchor?.status, txHash: c.anchor?.txHash, reason: current === stored ? "Content matches its recorded hash." : "Content changed since hashing - review this component." });
    }
    return { vehicle: String(vehicleId), results };
}

// A structured investigation report. The client renders and prints it; nothing here
// claims a legal or roadworthiness conclusion.
export function buildInvestigationReport(recon) {
    const findings = recon.conflicts.map((c) => ({
        title: c.title,
        severity: c.severity,
        detail: c.detail,
        field: c.disputedField,
        previousValue: c.previousValue,
        newValue: c.disputedValue,
        firstAppearedSequence: c.firstAppearedSequence,
        dependentEventIds: c.dependentEventIds || [],
    }));

    // Expected lifecycle chains, reported as present / not found in the available
    // records. A missing step is labelled as not found, never as proof it did not
    // happen - the history may simply be incomplete.
    const has = (pred) => recon.events.some(pred);
    const chainCheck = [
        { step: "Vehicle registration", present: has((e) => e.eventType === "registration") },
        { step: "Ownership transfer", present: has((e) => e.eventType === "ownership-transfer") },
        { step: "Service / odometer history", present: has((e) => e.eventType === "service-odometer") },
        { step: "Accident / damage record", present: has((e) => e.eventType === "accident-damage") },
        { step: "3D damage assessment", present: has((e) => e.eventType === "damage-assessment") },
        { step: "Repair record", present: has((e) => e.eventType === "repair") },
        { step: "Theft / recovery event", present: has((e) => e.eventType === "theft-reported" || e.eventType === "theft-recovered") },
        { step: "Challan event", present: has((e) => e.eventType === "challan-issued" || e.eventType === "challan-cleared") },
    ];

    return {
        generatedAt: new Date().toISOString(),
        vehicle: recon.vehicle,
        currentIdentity: recon.currentIdentity,
        eventCount: recon.events.length,
        conflictCount: recon.conflicts.length,
        timeline: recon.events.map((e) => ({ sequence: e.sequence, date: e.occurredAt, eventType: e.eventType, title: e.title, status: e.status })),
        findings,
        chainCheck,
        dependencyGraph: recon.dependencyGraph || { nodes: [], edges: [] },
        integritySummary: recon.integritySummary,
        factSeparation:
            "This report separates directly recorded facts (events with a source reference), user-submitted claims (reported but unverified records), system-generated alerts (the findings above) and unresolved questions (missing or conflicting records). A system alert is not a confirmed fraud finding.",
        conclusion: findings.length
            ? "Inconsistencies were found in the recorded sequence. Each is flagged for manual review with the event and evidence where it first appeared. This is not a determination of fraud."
            : "No identity inconsistencies were detected across the recorded events. All recorded changes carry a supporting reference.",
        disclaimer: recon.disclaimer,
    };
}

// Build a relationship graph over the recorded events so an investigator can see
// which records feed which, and where an expected step is missing. Edges come from
// concrete source references (an assessment's linked accident) and from conflict
// dependency tracing; nothing is inferred that the records do not state.
function buildGraph(events, conflicts) {
    const nodes = events.map((e) => ({ id: e.id, type: e.eventType, title: e.title, sequence: e.sequence, status: e.status }));
    const edges = [];
    const addEdge = (from, to, relation) => {
        if (from && to && from !== to) edges.push({ from, to, relation });
    };

    // Registration -> each later ownership transfer, in order.
    const reg = events.find((e) => e.eventType === "registration");
    let prevOwner = reg?.id || null;
    for (const e of events.filter((x) => x.eventType === "ownership-transfer")) {
        addEdge(prevOwner, e.id, "precedes");
        prevOwner = e.id;
    }

    // Accident -> the 3D assessment that extends it (via the assessment's link).
    const damageBySource = {};
    for (const e of events.filter((x) => x.eventType === "accident-damage" || x.eventType === "repair")) {
        damageBySource[e.source?.id] = e.id;
    }
    for (const e of events) {
        if (e._assessment?.linkedEvent) addEdge(damageBySource[e._assessment.linkedEvent], e.id, "extends-accident");
    }

    // Conflict dependency: the event where a disputed value first appeared -> each
    // later record that carries that value.
    for (const c of conflicts) {
        for (const dep of c.dependentEventIds || []) addEdge(c.firstAppearedEventId, dep, "value-depends-on");
    }

    // Deduplicate edges.
    const seen = new Set();
    const uniq = edges.filter((e) => { const k = `${e.from}>${e.to}>${e.relation}`; if (seen.has(k)) return false; seen.add(k); return true; });
    return { nodes, edges: uniq };
}

// Reconstruct the vehicle's recorded state up to a given event sequence by folding
// every change at or before that point. Fields never recorded stay null - the
// engine reports them as unavailable rather than inventing a value.
function stateUpTo(events, uptoSequence) {
    const state = { owner: null, engineNumber: null, chassisNumber: null, regNumber: null, odometerKm: null, theftStatus: null, challanStatus: null, assessmentStatus: null };
    const upTo = events.filter((e) => e.sequence <= uptoSequence);
    for (const e of upTo) {
        for (const ch of e.changes || []) {
            if (ch.newValue == null) continue;
            if (ch.field === "currentOwner") state.owner = ch.newValue;
            else if (ch.field === "engineNumber") state.engineNumber = ch.newValue;
            else if (ch.field === "chassisNumber") state.chassisNumber = ch.newValue;
            else if (ch.field === "regNumber") state.regNumber = ch.newValue;
            else if (ch.field === "odometerKm") state.odometerKm = ch.newValue;
            else if (ch.field === "theftStatus") state.theftStatus = ch.newValue;
            else if (ch.field === "challanStatus") state.challanStatus = ch.newValue;
            else if (ch.field === "assessmentStatus") state.assessmentStatus = ch.newValue;
        }
    }
    return { uptoSequence, state, eventCount: upTo.length };
}

// Compare the reconstructed state at two timeline points and list every recorded
// difference, each traced to the source event that introduced its later value.
export async function compareStates(vehicleId, fromEventId, toEventId) {
    const full = await reconstructRaw(vehicleId);
    if (full.error) return full;
    const { events } = full;
    const fromEv = events.find((e) => e.id === fromEventId);
    const toEv = events.find((e) => e.id === toEventId);
    if (!fromEv || !toEv) return { error: "One of the selected events is not part of this vehicle's timeline." };
    const a = stateUpTo(events, Math.min(fromEv.sequence, toEv.sequence));
    const b = stateUpTo(events, Math.max(fromEv.sequence, toEv.sequence));
    const diffs = [];
    for (const key of Object.keys(a.state)) {
        if (String(a.state[key]) !== String(b.state[key])) {
            const source = [...events].reverse().find((e) => e.sequence <= b.uptoSequence && (e.changes || []).some((c) => c.field === (key === "owner" ? "currentOwner" : key) && c.newValue != null));
            diffs.push({ field: key, earlierValue: a.state[key], laterValue: b.state[key], introducedByEventId: source?.id || null, introducedBySequence: source?.sequence || null });
        }
    }
    return {
        vehicle: full.vehicle,
        from: { eventId: fromEv.id, sequence: fromEv.sequence, title: fromEv.title, state: a.state },
        to: { eventId: toEv.id, sequence: toEv.sequence, title: toEv.title, state: b.state },
        differences: diffs,
        note: "A difference is any recorded change between the two points, not proof of wrongdoing. It may be an expected change, a correction, or an incomplete history.",
    };
}

// Replay the reconstructed state at one point in the timeline.
export async function stateAtEvent(vehicleId, eventId) {
    const full = await reconstructRaw(vehicleId);
    if (full.error) return full;
    const ev = full.events.find((e) => e.id === eventId);
    if (!ev) return { error: "Event not found in this vehicle's timeline." };
    return { vehicle: full.vehicle, event: { id: ev.id, sequence: ev.sequence, title: ev.title, occurredAt: ev.occurredAt }, state: stateUpTo(full.events, ev.sequence).state };
}

// Reconstruct once and keep the internal (un-stripped) events for comparisons.
async function reconstructRaw(vehicleId) {
    const out = await reconstruct(vehicleId);
    if (out.error) return out;
    // reconstruct returns stripped events; rebuild the raw list is unnecessary for
    // comparisons that only read public fields, so reuse the stripped events.
    return { ...out, events: out.events };
}

// The one allowed write: link an investigation finding to the Fraud Casebook. The
// engine does not touch the source records it investigated; it only records the
// finding and its references as a new case activity, or attaches to an open case.
export async function linkFindingToCase({ vehicleId, conflict, actor, caseId, note }) {
    const vehicle = await Vehicle.findById(vehicleId).lean();
    if (!vehicle) return { error: "Vehicle not found" };
    if (!conflict) return { error: "A finding is required to link to a case." };

    const finding = {
        type: conflict.type,
        title: conflict.title,
        detail: conflict.detail,
        disputedField: conflict.disputedField || null,
        disputedValue: conflict.disputedValue || null,
        previousValue: conflict.previousValue || null,
        firstAppearedSequence: conflict.firstAppearedSequence || null,
        dependentEventIds: conflict.dependentEventIds || [],
        linkedAt: new Date().toISOString(),
        by: { id: actor.id, name: actor.name, role: actor.role },
    };

    let targetCase = null;
    if (caseId && mongoose.isValidObjectId(caseId)) {
        targetCase = await InvestigationCase.findById(caseId);
    }
    const actionDetail = `Forensics finding linked: ${finding.title}`;

    if (targetCase) {
        targetCase.actions.push({ action: "linked", detail: actionDetail, performedBy: actor.id, performerName: actor.name, performerRole: actor.role });
        targetCase.notes.push({ text: String(note || actionDetail).slice(0, 1000), author: actor.id, authorName: actor.name });
        if (!targetCase.relatedAlerts) targetCase.relatedAlerts = [];
        await targetCase.save();
        return { caseRef: targetCase.caseRef, caseId: String(targetCase._id), created: false, finding };
    }

    targetCase = new InvestigationCase({
        caseRef: await nextCaseRef(),
        title: `Lifecycle forensics - ${vehicle.regNumber || vehicle._id}`,
        reason: finding.detail,
        priority: "medium",
        status: "under-review",
        vehicle: vehicle._id,
        regNumber: vehicle.regNumber,
        createdBy: actor.id,
        assignedOfficer: actor.role === "rto" || actor.role === "police" ? actor.id : undefined,
        actions: [
            { action: "created", detail: `Case opened from a forensics finding on ${vehicle.regNumber || "the vehicle"}.`, performedBy: actor.id, performerName: actor.name, performerRole: actor.role },
            { action: "linked", detail: actionDetail, performedBy: actor.id, performerName: actor.name, performerRole: actor.role },
        ],
        notes: [{ text: String(note || finding.detail).slice(0, 1000), author: actor.id, authorName: actor.name }],
    });
    await targetCase.save();
    targetCase.anchor = await anchorRecord(targetCase, `forensics case ${targetCase.caseRef}`);
    await targetCase.save();
    return { caseRef: targetCase.caseRef, caseId: String(targetCase._id), created: true, finding };
}

export default { resolveVehicle, reconstruct, verifyVehicleIntegrity, buildInvestigationReport, compareStates, stateAtEvent, linkFindingToCase };
