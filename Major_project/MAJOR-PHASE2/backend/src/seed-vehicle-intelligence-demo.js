// vehicle-intelligence demo seed
// Seeds believable DEMO data for Features 1, 2, 6, 7 (plus officer scans for 4/5)
// so the Vehicle History page and Investigations console show content in a demo.
// Backend must be running: node src/seed-vehicle-intelligence-demo.js
// Re-runnable: skips anything that already exists. Data is marked "DEMO".
//
// Creates a persistent demo workshop login you can use in the UI:
// email: maruti.demo@workshop.com password: demo123 (Maruti Suzuki, verified)

import fs from "fs";

const BASE = "http://localhost:5000/api";
const DEMO_WS = { email: "maruti.demo@workshop.com", password: "demo123" };

const json = async (path, opts = {}, token) => {
    const res = await fetch(BASE + path, {
        ...opts,
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};
const formJson = async (path, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, String(v));
    const res = await fetch(BASE + path, { method: "POST", body: fd });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};
const say = (m) => console.log(` ${m}`);

const run = async () => {
    console.log("\n=== Vehicle Intelligence demo seed ===\n");

    const rto = await json("/auth/login", { method: "POST", body: { email: "ka.rto@biochain.com", password: "ka123" } });
    if (!rto.data.token) { console.log("RTO login failed - is the backend up and seeded?"); process.exit(1); }
    const rtoTok = rto.data.token;

    const vehicles = (await json("/vehicles/search?limit=200", {}, rtoTok)).data;
    const maruti = (vehicles.vehicles || vehicles).find((v) => /maruti/i.test(v.make));
    if (!maruti) { console.log("No Maruti vehicle in DB - register one first."); process.exit(1); }
    say(`Vehicle: ${maruti.regNumber} (${maruti.make} ${maruti.model} ${maruti.year})`);

    // --- Demo workshop (register once, then always login) ---
    await formJson("/auth/register", {
        name: "Maruti Demo Centre", email: DEMO_WS.email, password: DEMO_WS.password, role: "workshop",
        phone: "7777777777", address: "Bengaluru", state: "KA", district: "Bengaluru Urban",
        aadhaarNumber: "999988887777", dlNumber: "KA-DEMO-0001",
        workshopDetails: JSON.stringify({ companyName: "Maruti Suzuki Arena Demo", affiliatedManufacturer: "Maruti Suzuki", gstin: "29AABCD1234E1Z5", licenseNumber: "DL-KA-DEMO-1" }),
    });
    const { default: mongoose } = await import("mongoose");
    const envText = fs.existsSync(new URL("../.env", import.meta.url)) ? fs.readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
    const mongoUri = (envText.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/biochain";
    await mongoose.connect(mongoUri);
    await mongoose.connection.collection("users").updateOne(
        { email: DEMO_WS.email }, { $set: { "workshopDetails.verified": true } }
    );
    const ws = await json("/auth/login", { method: "POST", body: { email: DEMO_WS.email, password: DEMO_WS.password } });
    if (!ws.data.token) { console.log("Demo workshop login failed"); await mongoose.disconnect(); process.exit(1); }
    const wsTok = ws.data.token;
    say("Demo workshop ready + verified (maruti.demo@workshop.com / demo123)");

    // --- F1: service & odometer history (one legitimately flagged reading) ---
    const existing = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {}, wsTok);
    if (!existing.data.records?.length) {
        const plan = [
            { serviceDate: "2023-03-15", odometerKm: 12450, serviceType: "periodic-service", description: "DEMO: 10k+2k periodic service - engine oil, filter", cost: 3800, partsReplaced: [{ partName: "Engine oil filter" }] },
            { serviceDate: "2024-01-20", odometerKm: 27980, serviceType: "periodic-service", description: "DEMO: 30k service - brake pads replaced", cost: 6400, partsReplaced: [{ partName: "Front brake pads", partSerial: "BP-7731" }] },
            { serviceDate: "2024-02-02", odometerKm: 26900, serviceType: "repair", description: "DEMO: cluster unit replaced under warranty - reading restarted, flagged for review", cost: 0 },
            { serviceDate: "2025-02-11", odometerKm: 41230, serviceType: "inspection", description: "DEMO: state road safety inspection pass", cost: 1000 },
        ];
        for (const p of plan) {
            const r = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, { method: "POST", body: p }, wsTok);
            say(`service record: ${r.status === 201 ? "ok" : `skipped (${r.status})`}${r.data.flagged ? " [FLAGGED - good for demo]" : ""}`);
        }
    } else say(`F1: ${existing.data.records.length} service records already present - skipped`);

    // --- F2: parts provenance ---
    const comps = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {}, wsTok);
    if (!comps.data.components?.length) {
        const engine = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {
            method: "POST", body: { componentType: "engine", serialNumber: "K15M-DEMO-004512", installationDate: `${maruti.year || 2021}-06-01`, reason: "DEMO: original engine fitted at manufacture" }
        }, wsTok);
        say(`engine component: ${engine.status === 201 ? "ok" : `skipped (${engine.status})`}`);
        if (engine.status === 201) {
            await json(`/vehicle-intelligence/components/${engine.data.component._id}/events`, { method: "POST", body: { eventType: "inspected", eventDate: "2024-02-03", inspectionResult: "pass", reason: "DEMO: post-repair inspection" } }, wsTok);
        }
        const batt = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/components`, {
            method: "POST", body: { componentType: "battery-pack", serialNumber: "BAT-DEMO-99887", installationDate: "2023-11-02", reason: "DEMO: 12V auxiliary battery" }
        }, wsTok);
        say(`battery component: ${batt.status === 201 ? "ok" : `skipped (${batt.status})`}`);
    } else say(`F2: ${comps.data.components.length} components already present - skipped`);

    // --- F6: damage passport ---
    const dmgList = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/damage-events`, {}, wsTok);
    if (!dmgList.data.events?.length) {
        const dmg = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/damage-events`, {
            method: "POST", body: { eventType: "accident-damage", eventDate: "2024-02-01", description: "DEMO: front-left collision repaired before cluster replacement", severity: "moderate", affectedAreas: "front-left bumper, chassis rail" }
        }, wsTok);
        if (dmg.status === 201) {
            await json(`/vehicle-intelligence/damage-events/${dmg.data.event._id}/decision`, { method: "PATCH", body: { decision: "verified", remarks: "DEMO: verified by RTO against repair invoice" } }, rtoTok);
        }
        say(`damage event: ${dmg.status === 201 ? "ok + verified" : `skipped (${dmg.status})`}`);
    } else say(`F6: ${dmgList.data.events.length} damage events already present - skipped`);

    // --- F7: battery passport (clearly labelled DEMO values) ---
    const bat = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/battery`, {}, wsTok);
    if (!bat.data.exists) {
        const made = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/battery`, {
            method: "POST", body: { batteryIdentifier: "DEMO-BAT-PACK-001", manufacturer: "Demo Energy Systems", chemistry: "lithium-ion", nominalCapacityKwh: 39.2, installationDate: `${maruti.year || 2021}-06-01`, isElectric: true }
        }, wsTok);
        say(`battery passport: ${made.status === 201 ? "created" : `skipped (${made.status})`}`);
        if (made.status === 201) {
            const evs = [
                { eventType: "initial-report", eventDate: `${maruti.year || 2021}-07-01`, stateOfHealthPercent: 100, capacityKwh: 39.2, sourceType: "simulated-demo", sourceDescription: "DEMO: factory report" },
                { eventType: "soh-report", eventDate: "2023-07-05", stateOfHealthPercent: 96, capacityKwh: 37.6, cycleCount: 310, rangeKmEstimate: 260, sourceType: "simulated-demo", sourceDescription: "DEMO: annual health check" },
                { eventType: "soh-report", eventDate: "2025-07-08", stateOfHealthPercent: 91, capacityKwh: 35.7, cycleCount: 640, rangeKmEstimate: 240, sourceType: "simulated-demo", sourceDescription: "DEMO: annual health check" },
                { eventType: "warranty-update", eventDate: "2025-07-09", sourceType: "workshop-verified", sourceDescription: "DEMO: warranty valid till 2029", warrantyDetails: { provider: "DemoEnergy", coveredUntil: "2029-06-30", terms: "70% capacity retention" } },
            ];
            for (const e of evs) {
                const r = await json(`/vehicle-intelligence/battery/${maruti._id}/events`, { method: "POST", body: e }, wsTok);
                say(`battery event: ${r.status === 201 ? "ok" : `skipped (${r.status})`}`);
            }
        }
    } else say("F7: battery passport already present - skipped");

    // --- F3/F4/F5: officer console content ---
    const police = await json("/auth/login", { method: "POST", body: { email: "police@biochain.com", password: "police123" } });
    const polTok = police.data.token;
    // The case reference the server generates (CASE-<year>-<sequence>) does not
    // contain the word DEMO, so a `?ref=DEMO` filter would never match and every
    // re-run opened another copy of the same case. Look for this vehicle's demo
    // case by title instead, which keeps the script re-runnable.
    const allCases = await json("/investigations/cases", {}, polTok);
    const alreadySeeded = (allCases.data.cases || []).some((k) => {
        const caseVehicle = String(k.vehicle?._id || k.vehicle || "");
        return String(k.title || "").startsWith("DEMO:") && caseVehicle === String(maruti._id);
    });
    if (!alreadySeeded) {
        const c = await json("/investigations/cases", {
            method: "POST", body: { title: "DEMO: odometer inconsistency review", reason: "DEMO: service timeline shows a lower reading after a cluster replacement - review invoice evidence", priority: "medium", vehicleId: maruti._id }
        }, polTok);
        if (c.status === 201) {
            await json(`/investigations/cases/${c.data.case._id}/notes`, { method: "POST", body: { text: "DEMO: pending workshop cluster-replacement invoice" } }, polTok);
            await json(`/investigations/cases/${c.data.case._id}/status`, { method: "PATCH", body: { status: "under-review", remarks: "DEMO review started" } }, polTok);
        }
        say(`casebook: ${c.status === 201 ? "demo case created" : `skipped (${c.status})`}`);
    } else say("F3: demo case already present - skipped");

    const anomaly = await json("/investigations/anomaly/scan", { method: "POST" }, polTok);
    say(`F4 anomaly scan: ${anomaly.status === 200 ? `ok (${anomaly.data.created ?? 0} new alerts)` : `skipped (${anomaly.status})`}`);
    const clone = await json("/investigations/cloning/scan", { method: "POST" }, polTok);
    say(`F5 cloning scan: ${clone.status === 200 ? `ok (${clone.data.conflictsFound ?? clone.data.created ?? 0} conflicts)` : `skipped (${clone.status})`}`);

    await mongoose.disconnect();
    console.log("\nDemo data ready. Open the UI:");
    console.log(" - Vehicle History page: service / parts / damage / battery tabs");
    console.log(" - Investigations console (police or ka.rto login): casebook / anomalies / cloning");
    console.log(" - Workshop login (maruti.demo@workshop.com / demo123) for brand-locked submissions\n");
};

run().catch((e) => { console.error("Demo seed crashed:", e.message); process.exit(1); });
