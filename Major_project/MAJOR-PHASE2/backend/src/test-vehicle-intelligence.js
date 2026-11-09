// test-vehicle-intelligence.js
// Smoke test for Feature 1 (Service & Odometer History) + workshop role access.
// Run with the backend up: node src/test-vehicle-intelligence.js
// Creates a temporary workshop user + records, and DELETES everything it created.

const BASE = "http://localhost:5000/api";
let passed = 0, failed = 0;

const check = (name, cond, extra = "") => {
    if (cond) { passed++; console.log(` ${name}`); }
    else { failed++; console.log(` ${name} ${extra}`); }
};

const json = async (path, opts = {}, token) => {
    const res = await fetch(BASE + path, {
        ...opts,
        headers: {
            "Content-Type": "application/json",
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            ...(opts.headers || {}),
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const form = async (path, fields) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(BASE + path, { method: "POST", body: fd });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const run = async () => {
    console.log("\n=== Vehicle Intelligence / Feature 1 smoke test ===\n");

    // 1. RTO login to find vehicles
    const rto = await json("/auth/login", { method: "POST", body: { email: "ka.rto@biochain.com", password: "ka123" } });
    check("RTO login", rto.status === 200 && rto.data.token, `(status ${rto.status} - is the DB seeded?)`);
    if (!rto.data.token) return report();
    const rtoToken = rto.data.token;

    const search = await json("/vehicles/search?limit=200", {}, rtoToken);
    const vehicles = search.data.vehicles || search.data || [];
    const maruti = vehicles.find(v => /maruti/i.test(v.make));
    const nonMaruti = vehicles.find(v => !/maruti/i.test(v.make));
    check("Found a Maruti vehicle in DB", !!maruti, "(seed one if missing)");
    if (!maruti) return report();

    // 1b. Pre-clean orphans from any previously interrupted run (unique email per
    // run means a crashed run's "Smoke:" records would otherwise pollute counts)
    const mongoosePre = (await import("mongoose")).default;
    const preEnv = (await import("fs")).existsSync(new URL("../.env", import.meta.url))
        ? (await import("fs")).readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
    const preUri = (preEnv.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/biochain";
    await mongoosePre.connect(preUri);
    const preDb = mongoosePre.connection.db;
    const smokeUserIds = (await preDb.collection("users").find({ email: { $regex: "^smoke\\.workshop\\." } }).toArray()).map(u => u._id);
    await preDb.collection("servicerecords").deleteMany({ $or: [{ submittedBy: { $in: smokeUserIds } }, { description: { $regex: "^Smoke" } }] });
    await preDb.collection("biometrictemplates").deleteMany({ user: { $in: smokeUserIds } });
    await preDb.collection("users").deleteMany({ _id: { $in: smokeUserIds } });
    await mongoosePre.disconnect();

    // 2. Register workshop user (unique email per run)
    const stamp = Date.now();
    const wsEmail = `smoke.workshop.${stamp}@workshop.com`;
    const reg = await form("/auth/register", {
        name: "Smoke Workshop", email: wsEmail, password: "smoke123", role: "workshop",
        phone: "9999999999", address: "Bengaluru", state: "KA", district: "Bengaluru Urban",
        aadhaarNumber: String(stamp).padStart(12, "0").slice(-12), dlNumber: "KA-SMOKE-0001",
        workshopDetails: JSON.stringify({ companyName: "Smoke Motors", affiliatedManufacturer: "Maruti Suzuki" }),
    });
    check("Workshop registration accepted", reg.status === 201, `(status ${reg.status} ${JSON.stringify(reg.data)})`);
    const wsUserId = reg.data.userId;

    const wsLogin = await json("/auth/login", { method: "POST", body: { email: wsEmail, password: "smoke123" } });
    check("Workshop login returns workshopDetails", wsLogin.status === 200 && wsLogin.data.user?.workshopDetails?.affiliatedManufacturer === "Maruti Suzuki");
    const wsToken = wsLogin.data.token;

    // 3. Unverified workshop cannot submit
    const unverifiedSubmit = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {
        method: "POST",
        body: { serviceDate: "2024-05-01", odometerKm: 15000, serviceType: "periodic-service", description: "Smoke test first service" }
    }, wsToken);
    check("Unverified workshop blocked from submitting", unverifiedSubmit.status === 403);

    // 4. Verify the workshop directly in DB (simulating admin/RTO approval)
    const { default: mongoosePkg } = await import("mongoose"); // shares MONGO_URI env
    const fs = await import("fs");
    const envText = fs.existsSync(new URL("../.env", import.meta.url)) ? fs.readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
    const mongoUri = (envText.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/biochain";
    await mongoosePkg.connect(mongoUri);
    const col = mongoosePkg.connection.collection("users");
    await col.updateOne({ _id: new mongoosePkg.Types.ObjectId(wsUserId) }, { $set: { "workshopDetails.verified": true } });
    check("Workshop marked verified in DB", true);
    const wsToken2 = (await json("/auth/login", { method: "POST", body: { email: wsEmail, password: "smoke123" } })).data.token;

    // 5. Brand-vehicle list only shows Maruti
    const brand = await json("/vehicle-intelligence/my-brand-vehicles", {}, wsToken2);
    check("Brand list contains only Maruti vehicles", brand.status === 200 && brand.data.vehicles.every(v => /maruti/i.test(v.make)), JSON.stringify(brand.data).slice(0, 120));

    // 6. Cross-brand access is denied
    if (nonMaruti) {
        const crossBrand = await json(`/vehicle-intelligence/vehicle-history/${nonMaruti._id}/service-records`, {}, wsToken2);
        check("Workshop denied access to other brand's vehicle", crossBrand.status === 403);
    } else {
        console.log(" (no non-Maruti vehicle in DB, cross-brand check skipped)");
    }

    // 7. Submit a valid record
    // Baseline first: demo-seeded records may already exist on this vehicle,
    // so all count/value assertions are deltas against the pre-test state.
    const base = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {}, wsToken2);
    const baseTotal = base.data?.summary?.totalRecords ?? 0;
    const baseFlagged = base.data?.summary?.flaggedReadings ?? 0;
    const baseMaxOdo = base.data?.summary?.latestOdometerKm ?? 0;
    const rec1 = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {
        method: "POST",
        body: { serviceDate: "2026-01-01", odometerKm: baseMaxOdo + 1000, serviceType: "periodic-service", description: "Smoke: 15k service", cost: 4200, partsReplaced: [{ partName: "Oil filter" }] }
    }, wsToken2);
    check("Verified workshop submits record", rec1.status === 201 && rec1.data.record?.anchor?.recordHash, `(status ${rec1.status})`);

    // 8. Lower odometer reading is flagged, not rejected
    const rec2 = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {
        method: "POST",
        body: { serviceDate: "2026-01-15", odometerKm: Math.max(baseMaxOdo - 500, 0), serviceType: "repair", description: "Smoke: dash instrument replaced" }
    }, wsToken2);
    check("Lower odometer reading saved but FLAGGED for review", rec2.status === 201 && rec2.data.flagged === true && rec2.data.record.status === "flagged_for_review");

    // 9. Timeline shows summary + note
    const timeline = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {}, wsToken2);
    check("Timeline lists both records with flag warning", timeline.status === 200 && timeline.data.summary.totalRecords === baseTotal + 2 && timeline.data.summary.flaggedReadings === baseFlagged + 1, `(got ${JSON.stringify(timeline.data.summary)})`);

    // 10. Invalid values rejected
    const bad = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {
        method: "POST",
        body: { serviceDate: "2099-01-01", odometerKm: -5, serviceType: "repair", description: "x" }
    }, wsToken2);
    check("Future date + negative odometer rejected", bad.status === 400 && bad.data.errors?.length >= 2);

    // 11. Owner cannot submit (role guard)
    const ownerLogin = await json("/auth/login", { method: "POST", body: { email: "owner@biochain.com", password: "owner123" } });
    const ownerBlocked = await json(`/vehicle-intelligence/vehicle-history/${maruti._id}/service-records`, {
        method: "POST", body: { serviceDate: "2024-07-01", odometerKm: 16000, serviceType: "repair", description: "should fail" }
    }, ownerLogin.data.token);
    check("Owner blocked from submitting records", ownerBlocked.status === 403);

    // 12. Authorized correction (RTO) clears the flag with audit trail
    // Corrected value must exceed the newest existing reading (demo data included)
    const corrected = await json(`/vehicle-intelligence/service-records/${rec2.data.record._id}/correct`, {
        method: "PATCH",
        body: { field: "odometerKm", newValue: Math.max(baseMaxOdo, 15000, rec1.data.record.odometerKm) + 500, reason: "Smoke: dash unit was replaced, verified against invoice" }
    }, rtoToken);
    check("RTO correction recorded with audit trail", corrected.status === 200 && corrected.data.record.status === "corrected" && corrected.data.record.corrections.length === 1);

    // 13. Integrity verification matches
    const verify = await json(`/vehicle-intelligence/service-records/${rec1.data.record._id}/verify`, {}, rtoToken);
    check("Hash integrity verification passes", verify.status === 200 && verify.data.verified === true);
    check("On-chain anchor honestly marked pending", verify.data.anchorStatus === "pending");

    // ---- Cleanup ----
    await mongoosePkg.connection.collection("servicerecords").deleteMany({ submittedBy: new mongoosePkg.Types.ObjectId(wsUserId) });
    await mongoosePkg.connection.collection("biometrictemplates").deleteMany({ user: new mongoosePkg.Types.ObjectId(wsUserId) });
    await col.deleteOne({ _id: new mongoosePkg.Types.ObjectId(wsUserId) });
    await mongoosePkg.disconnect();
    console.log("\nTest data cleaned up");

    report();
};

const report = () => {
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed ? 1 : 0);
};

run().catch(err => { console.error("Smoke test crashed:", err); process.exit(1); });
