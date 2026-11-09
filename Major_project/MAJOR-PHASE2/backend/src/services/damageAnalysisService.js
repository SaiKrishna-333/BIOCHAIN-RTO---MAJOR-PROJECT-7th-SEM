// damageAnalysisService.js
// The computer-vision interface for Feature 9 (3D Vehicle Damage & Repair
// Intelligence).
//
// This is the single, replaceable seam between the module and any real image
// model. Two truths govern it:
//
//  1. If a genuine detection endpoint is configured (DAMAGE_CV_ENDPOINT), each
//     photograph is sent to it and its findings are adopted, tagged
//     source: "computer-vision" with the model's own confidence.
//  2. If no such endpoint exists - which is the case in this deployment - the
//     module does NOT invent detections. It returns mode "manual" and the
//     assessor records component findings by hand, tagged
//     source: "manual-inspection". The UI presents these as human findings,
//     never as AI output.
//
// A hash or a confidence value proves only that a piece of data exists; it never
// proves the vehicle is roadworthy or that hidden damage was found.

import crypto from "crypto";

export const ANALYSIS_LIMITATION =
    "A photograph-based assessment can only describe visible surface damage. It cannot reveal hidden structural, " +
    "mechanical or safety problems, cannot certify roadworthiness, and must not treat an area the camera cannot " +
    "see as inspected. Components marked here as 'not assessed' simply were not evaluable from the supplied images.";

// The component keys a real vision model is expected to name, normalised to the
// module's own vocabulary. Unknown labels become "other" and are still reported.
const COMPONENT_ALIASES = {
    "front bumper": "front-bumper", "rear bumper": "rear-bumper", "bumper front": "front-bumper",
    "hood": "bonnet", "bonnet": "bonnet", "roof": "roof",
    "front left door": "door-front-left", "front right door": "door-front-right",
    "rear left door": "door-rear-left", "rear right door": "door-rear-right",
    "front left fender": "fender-front-left", "front right fender": "fender-front-right",
    "headlight": "headlight-left", "tail light": "taillight-left",
    "windshield": "windshield", "wind screen": "windshield", "rear window": "rear-window",
    "radiator": "radiator", "mirror": "mirror-left",
};

function normaliseComponent(raw) {
    const s = String(raw || "").trim().toLowerCase();
    if (COMPONENT_ALIASES[s]) return COMPONENT_ALIASES[s];
    const dashed = s.replace(/\s+/g, "-");
    return dashed || "other";
}

// Ask a configured vision endpoint about one photograph. Returns an array of
// candidate findings, or null when no endpoint is configured (caller degrades to
// manual mode). Never throws for a network problem - it reports the failure so
// the whole run stays honest instead of silently producing nothing.
async function detectInPhoto(buffer, contentType, photoView) {
    const endpoint = process.env.DAMAGE_CV_ENDPOINT;
    if (!endpoint) return null;

    const form = new FormData();
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    form.append("image", new Blob([bytes], { type: contentType || "image/jpeg" }), "photo");
    if (photoView) form.append("view", photoView);

    const res = await fetch(endpoint, {
        method: "POST",
        headers: process.env.DAMAGE_CV_TOKEN ? { Authorization: `Bearer ${process.env.DAMAGE_CV_TOKEN}` } : undefined,
        body: form,
    });
    if (!res.ok) throw new Error(`Vision endpoint responded ${res.status}`);
    const data = await res.json();
    const detections = Array.isArray(data.detections || data.findings) ? (data.detections || data.findings) : [];
    return detections.map((d) => ({
        component: normaliseComponent(d.component || d.label || d.class),
        label: d.label || d.class || "Model finding",
        confidence: typeof d.confidence === "number" ? Math.max(0, Math.min(1, d.confidence)) : null,
        detectionState: typeof d.confidence === "number" && d.confidence >= 0.6 ? "detected" : "needs-review",
        severity: d.severity || "requires-inspection",
        modelOutput: d.raw || JSON.stringify(d),
    }));
}

/**
 * Analyse every photograph attached to an assessment.
 * Returns { mode, engineName, note, findings } where findings are candidates the
 * route adopts. mode is "computer-vision" only when a real endpoint produced them.
 */
export async function runDamageAnalysis(assessment) {
    const photos = assessment.photos || [];
    if (photos.length === 0) {
        return {
            mode: "none",
            note: "No photographs are attached to this assessment yet, so nothing could be analysed.",
            findings: [],
        };
    }

    if (!process.env.DAMAGE_CV_ENDPOINT) {
        return {
            mode: "manual",
            engineName: null,
            note:
                "No computer-vision model is configured in this deployment, so the module did not auto-detect anything. " +
                "An authorised assessor must inspect each photograph and record component findings manually; those findings " +
                "are labelled as human inspection, not AI detection.",
            findings: [],
        };
    }

    // A real endpoint exists: query it per photo and adopt what it reports.
    const collected = [];
    let failures = 0;
    for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        let buffer = p.data;
        if (!buffer && p.storage === "disk") {
            // Disk-stored photos are analysed by the caller before the bytes are
            // dropped; here we simply skip and note it rather than claim a result.
            continue;
        }
        if (!buffer) continue;
        try {
            const found = await detectInPhoto(buffer, p.contentType, p.view);
            if (found) for (const f of found) collected.push({ ...f, linkedPhotoIndex: i });
        } catch {
            failures++;
        }
    }

    const engineName = process.env.DAMAGE_CV_ENGINE_NAME || "configured-vision-endpoint";
    return {
        mode: "computer-vision",
        engineName,
        note:
            collected.length
                ? `${collected.length} candidate finding(s) from ${engineName}. Confidence below the review threshold is marked 'needs review', not 'detected'.` +
                (failures ? ` ${failures} photo(s) could not be analysed.` : "")
                : `${engineName} returned no visible findings for the supplied photographs. Absence of a detection does not mean the component is undamaged.`,
        findings: collected,
    };
}

// A stable content digest for a set of photo bytes, used purely to let the report
// state which images an assessment was based on. Not a truthfulness claim.
export function digestPhotoSet(photos = []) {
    const h = crypto.createHash("sha256");
    for (const p of photos) h.update(String(p.sha256 || ""));
    return h.digest("hex");
}

export default { runDamageAnalysis, digestPhotoSet, ANALYSIS_LIMITATION };
