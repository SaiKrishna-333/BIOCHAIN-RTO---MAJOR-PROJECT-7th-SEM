// transactionAnomalyService.js
// Feature 4: AI-Based Vehicle Transaction Anomaly Detection
//
// Honest scope (per the specification): this is a TRANSPARENT, EXPLAINABLE
// statistical anomaly model over the project's OWN transaction history - it is
// not a trained ML model and must not be claimed as accurate. It begins with a
// baseline (z-scores + thresholds) that is testable on real or synthetic data.
// The existing rule-based weighted score (fraudDetectionService) is kept and
// shown SEPARATELY; this module never overwrites it and never auto-rejects a
// legitimate transfer.

import { OwnershipHistory } from "../models/OwnershipHistory.js";
import { Vehicle } from "../models/Vehicle.js";
import { User } from "../models/User.js";
import { AnomalyAlert } from "../models/AnomalyAlert.js";

const MODEL_VERSION = "anomaly-baseline-v1";

// ---- small, dependency-free statistics helpers ----
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const stddev = (xs) => {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

// Map a z-score magnitude to a 0-100 risk contribution (logistic-shaped, capped)
const zToRisk = (z) => clamp(Math.round(100 / (1 + Math.exp(-1.3 * (Math.abs(z) - 2)))), 0, 100);

/**
 * Analyse vehicle resale intervals for rapid-resale anomalies.
 * Returns explainable factors using the population of observed intervals.
 */
export const analyzeResaleIntervals = async ({ lookbackDays = 365 } = {}) => {
    const cutoff = new Date(Date.now() - lookbackDays * 86400000);
    const histories = await OwnershipHistory.find({ createdAt: { $gte: cutoff } })
        .sort({ vehicle: 1, createdAt: 1 })
        .lean();

    // Build per-vehicle ownership chains -> intervals between consecutive transfers
    const byVehicle = {};
    for (const h of histories) {
        const vid = String(h.vehicle);
        (byVehicle[vid] = byVehicle[vid] || []).push(h);
    }

    const allIntervals = [];
    const vehicleIntervals = [];
    for (const [vid, list] of Object.entries(byVehicle)) {
        for (let i = 1; i < list.length; i++) {
            const days = (new Date(list[i].createdAt) - new Date(list[i - 1].createdAt)) / 86400000;
            if (days >= 0) {
                allIntervals.push(days);
                vehicleIntervals.push({ vehicle: vid, days, at: list[i].createdAt });
            }
        }
    }

    const mu = mean(allIntervals);
    const sigma = stddev(allIntervals);

    // An "unusually fast" resale = interval far below the population mean.
    const anomalies = [];
    for (const vi of vehicleIntervals) {
        const z = sigma > 0 ? (vi.days - mu) / sigma : 0;
        // Only flag when clearly faster than typical AND under 30 days in absolute terms
        if (z < -1.5 && vi.days < 30) {
            anomalies.push({
                vehicle: vi.vehicle,
                intervalDays: Math.round(vi.days * 10) / 10,
                zScore: Math.round(z * 100) / 100,
                riskIndicator: zToRisk(z),
                factor: "rapid-resale",
                detail: `Re-transferred after ${Math.round(vi.days)} days; typical interval is ${Math.round(mu)} days (z=${z.toFixed(2)}).`,
                severity: z < -2.5 ? "high" : z < -2 ? "medium" : "low"
            });
        }
    }

    return {
        modelVersion: MODEL_VERSION,
        sampleSize: allIntervals.length,
        population: { meanIntervalDays: Math.round(mu * 10) / 10, stddevDays: Math.round(sigma * 10) / 10 },
        anomalies,
        caveat: allIntervals.length < 8
            ? "Small sample - baseline statistics are not yet reliable; treat results as indicative only."
            : null
    };
};

/**
 * Owners whose transfer activity is a statistical outlier (too many transfers).
 */
export const analyzeOwnershipChurn = async ({ lookbackDays = 365 } = {}) => {
    const cutoff = new Date(Date.now() - lookbackDays * 86400000);
    const histories = await OwnershipHistory.find({ createdAt: { $gte: cutoff } }).lean();

    const counts = {};
    for (const h of histories) {
        for (const oid of [h.fromOwner, h.toOwner]) {
            if (oid) counts[String(oid)] = (counts[String(oid)] || 0) + 1;
        }
    }
    const values = Object.values(counts);
    const mu = mean(values);
    const sigma = stddev(values);

    const outliers = [];
    for (const [userId, c] of Object.entries(counts)) {
        const z = sigma > 0 ? (c - mu) / sigma : 0;
        if (z > 2 && c >= 4) {
            outliers.push({
                subjectType: "user",
                subject: userId,
                transferCount: c,
                zScore: Math.round(z * 100) / 100,
                riskIndicator: zToRisk(z),
                factor: "frequent-ownership-change",
                detail: `${c} transfers in ${lookbackDays} days vs typical ${Math.round(mu)} (z=${z.toFixed(2)}).`,
                severity: z > 3 ? "high" : "medium"
            });
        }
    }
    return { modelVersion: MODEL_VERSION, mean: Math.round(mu * 10) / 10, stddev: Math.round(sigma * 10) / 10, outliers };
};

/**
 * Repeated links to records already flagged by the existing rule engine
 * (stolen/blocked/under-investigation vehicles or police-flagged users).
 */
export const analyzeFlaggedRepeats = async () => {
    const flaggedVehicles = await Vehicle.find({ status: { $in: ["stolen", "blocked", "under_investigation"] } }).select("_id regNumber").lean();
    const flaggedIds = new Set(flaggedVehicles.map(v => String(v._id)));
    if (flaggedIds.size === 0) return { modelVersion: MODEL_VERSION, repeats: [] };

    const involved = await OwnershipHistory.find({
        $or: [{ vehicle: { $in: [...flaggedIds] } }]
    }).lean();

    // Count how many distinct transactions touch flagged vehicles per user
    const userTouch = {};
    for (const h of involved) {
        for (const oid of [h.fromOwner, h.toOwner]) {
            if (oid) userTouch[String(oid)] = (userTouch[String(oid)] || 0) + 1;
        }
    }
    const repeats = Object.entries(userTouch)
        .filter(([, n]) => n >= 2)
        .map(([userId, n]) => ({
            subjectType: "user",
            subject: userId,
            factor: "flagged-account-repeat",
            repeatCount: n,
            riskIndicator: clamp(n * 30, 0, 100),
            detail: `Participated in ${n} transactions involving flagged vehicles.`,
            severity: n >= 3 ? "high" : "medium"
        }));
    return { modelVersion: MODEL_VERSION, repeats };
};

/**
 * Run the full baseline anomaly pass and persist explainable alerts.
 * Existing rule scores are fetched separately for side-by-side display and are
 * NOT modified here.
 */
export const runAnomalyScan = async () => {
    const [resale, churn, repeats] = await Promise.all([
        analyzeResaleIntervals(),
        analyzeOwnershipChurn(),
        analyzeFlaggedRepeats()
    ]);

    const candidates = [
        ...resale.anomalies.map(a => ({ ...a, subjectType: "vehicle" })),
        ...churn.outliers,
        ...repeats.repeats
    ];

    const created = [];
    for (const c of candidates) {
        if (c.riskIndicator < 30) continue; // only surface meaningful indicators
        const alert = new AnomalyAlert({
            alertType: c.factor,
            subjectType: c.subjectType,
            subject: c.subject,
            subjectLabel: c.detail,
            riskIndicator: c.riskIndicator,
            severity: c.severity,
            contributingFactors: [{ factor: c.factor, detail: c.detail, weight: c.riskIndicator }],
            explanation: c.detail,
            method: "statistical-anomaly",
            modelVersion: MODEL_VERSION,
            recommendedAction: "Manual review by an authorized officer before any transfer decision.",
            relatedVehicles: c.subjectType === "vehicle" ? [c.subject] : []
        });
        await alert.save();
        created.push(alert);
    }

    return {
        modelVersion: MODEL_VERSION,
        populationStats: {
            resale: resale.population,
            resaleSampleSize: resale.sampleSize,
            churn: { mean: churn.mean, stddev: churn.stddev }
        },
        caveat: resale.caveat,
        alertsCreated: created.length,
        alerts: created
    };
};

/**
 * List alerts for the dashboard with light joins for display.
 */
export const listAnomalyAlerts = async ({ status, limit = 100 } = {}) => {
    const query = status ? { reviewStatus: status } : {};
    const alerts = await AnomalyAlert.find(query)
        .sort({ riskIndicator: -1, createdAt: -1 })
        .limit(limit)
        .populate("linkedCase", "caseRef title status")
        .lean();

    // Resolve subject labels (vehicle reg / user name) for display
    for (const a of alerts) {
        try {
            if (a.subjectType === "vehicle") {
                const v = await Vehicle.findById(a.subject).select("regNumber make model").lean();
                a.subjectDisplay = v ? `${v.regNumber || "Unregistered"} ${v.make || ""} ${v.model || ""}`.trim() : "Unknown vehicle";
            } else {
                const u = await User.findById(a.subject).select("name email").lean();
                a.subjectDisplay = u ? `${u.name} (${u.email})` : "Unknown user";
            }
        } catch {
            a.subjectDisplay = "Unknown";
        }
    }
    return alerts;
};

export default { runAnomalyScan, analyzeResaleIntervals, analyzeOwnershipChurn, analyzeFlaggedRepeats, listAnomalyAlerts };
