// test-intel-request-resale.js
// End-to-end test for the Vehicle Intelligence request workflow + enhanced resale flow.
// Run with the backend up: node src/test-intel-request-resale.js
// Everything it creates (2 owners, 1 workshop, 1 vehicle, records, requests) is DELETED at the end.

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

const form = async (path, fields, token) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const res = await fetch(BASE + path, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
};

const BRAND = "IntelTest Motors"; // unique brand so demo-seeded workshops can never win the match

const registerOwner = async (tag, stamp) => {
    const email = `intel.${tag}.${stamp}@resale-test.com`;
    const reg = await form("/auth/register", {
        name: `Intel ${tag} User`, email, password: "intel123", role: "owner",
        phone: `900000000${tag.charCodeAt(0) % 10}`, address: "Bengaluru", state: "KA", district: "Bengaluru Urban",
        aadhaarNumber: String(stamp + tag.charCodeAt(0)).padStart(12, "0").slice(-12), dlNumber: `KA-INTEL-${tag.toUpperCase()}`,
    });
    const login = await json("/auth/login", { method: "POST", body: { email, password: "intel123" } });
    return { email, userId: reg.data.userId, token: login.data.token, reg };
};

const run = async () => {
    console.log("\n=== Vehicle Intelligence request + resale e2e test ===\n");

    const mongoose = (await import("mongoose")).default;
    const fs = await import("fs");
    const envText = fs.existsSync(new URL("../.env", import.meta.url)) ? fs.readFileSync(new URL("../.env", import.meta.url), "utf8") : "";
    const mongoUri = (envText.match(/MONGO_URI=?(.+)/) || [])[1]?.trim() || process.env.MONGO_URI || "mongodb://127.0.0.1:27017/biochain";

    // Pre-clean orphans from any previously interrupted run
    await mongoose.connect(mongoUri);
    const db = mongoose.connection.db;
    const orphanIds = (await db.collection("users").find({ email: { $regex: "^intel\\.(a|b|ws)\\." } }).toArray()).map(u => u._id);
    if (orphanIds.length) {
        await db.collection("servicerecords").deleteMany({ submittedBy: { $in: orphanIds } });
        await db.collection("vehicleintelrequests").deleteMany({ $or: [{ requester: { $in: orphanIds } }, { workshop: { $in: orphanIds } }] });
        await db.collection("requests").deleteMany({ $or: [{ seller: { $in: orphanIds } }, { buyer: { $in: orphanIds } }] });
        // The transfer this suite approves leaves an ownership history row behind,
        // and a history of a vehicle that is no longer here describes nothing.
        const orphanVehicles = (await db.collection("vehicles").find({ chassisNumber: { $regex: "^INTELTESTCHASSIS" } }).toArray()).map(v => v._id);
        if (orphanVehicles.length) {
            await db.collection("ownershiphistories").deleteMany({ vehicle: { $in: orphanVehicles } });
        }
        await db.collection("vehicles").deleteMany({ chassisNumber: { $regex: "^INTELTESTCHASSIS" } });
        await db.collection("notifications").deleteMany({ recipient: { $in: orphanIds } });
        await db.collection("biometrictemplates").deleteMany({ user: { $in: orphanIds } });
        await db.collection("users").deleteMany({ _id: { $in: orphanIds } });
    }
    await mongoose.disconnect();

    const stamp = Date.now();

    // 1. Register Owner A (seller), Owner B (buyer) and a brand-matched workshop
    const ownerA = await registerOwner("a", stamp);
    const ownerB = await registerOwner("b", stamp);
    check("Owners A + B registered", !!ownerA.userId && !!ownerB.userId && !!ownerA.token && !!ownerB.token,
        `(A: ${ownerA.reg.status} ${JSON.stringify(ownerA.reg.data).slice(0, 80)} | B: ${ownerB.reg.status} ${JSON.stringify(ownerB.reg.data).slice(0, 80)})`);

    const wsEmail = `intel.ws.${stamp}@resale-test.com`;
    const wsReg = await form("/auth/register", {
        name: "Intel Test Workshop", email: wsEmail, password: "intel123", role: "workshop",
        phone: "9000000011", address: "Bengaluru", state: "KA", district: "Bengaluru Urban",
        aadhaarNumber: String(stamp + 9).padStart(12, "0").slice(-12), dlNumber: "KA-INTEL-WS",
        workshopDetails: JSON.stringify({ companyName: "Intel Test Motors", affiliatedManufacturer: BRAND }),
    });
    const wsUserId = wsReg.data.userId;
    check("Workshop registered", wsReg.status === 201 && !!wsUserId, `(status ${wsReg.status} ${JSON.stringify(wsReg.data).slice(0, 120)})`);

    // 2. Insert a test vehicle owned by A directly in the DB
    await mongoose.connect(mongoUri);
    await mongoose.connection.collection("users").updateOne(
        { _id: new mongoose.Types.ObjectId(wsUserId) },
        { $set: { "workshopDetails.verified": true } }
    );
    const vehicleDoc = {
        chassisNumber: `INTELTESTCHASSIS${stamp}`, engineNumber: `INTELTESTENGINE${stamp}`,
        regNumber: `TS09IT${String(stamp).slice(-5)}`,
        make: BRAND, model: "Test Hatch", year: 2022,
        currentOwner: new mongoose.Types.ObjectId(ownerA.userId), status: "registered",
    };
    const ins = await mongoose.connection.collection("vehicles").insertOne(vehicleDoc);
    const vehicleId = ins.insertedId.toString();

    // A second vehicle that was never issued a registration number: the transfer
    // of that one has to be refused rather than quietly recorded.
    const bareDoc = {
        chassisNumber: `INTELTESTCHASSISBARE${stamp}`, engineNumber: `INTELTESTENGINEBARE${stamp}`,
        make: BRAND, model: "Test Sedan", year: 2023,
        currentOwner: new mongoose.Types.ObjectId(ownerA.userId), status: "registered",
    };
    const bareIns = await mongoose.connection.collection("vehicles").insertOne(bareDoc);
    const bareVehicleId = bareIns.insertedId.toString();
    await mongoose.disconnect();
    check("Test vehicle created for Owner A", true);

    const wsToken = (await json("/auth/login", { method: "POST", body: { email: wsEmail, password: "intel123" } })).data.token;

    // 3. Owner A requests a vehicle intelligence report
    const req1 = await json("/vehicle-intelligence/request", {
        method: "POST",
        body: { vehicleId, requestedItems: ["service", "odometer", "parts"], note: "Planning to resell - need verified records" }
    }, ownerA.token);
    const intelRequestId = req1.data.request?._id;
    check("Owner A intel request accepted + routed to brand workshop", req1.status === 201 && !!intelRequestId && String(req1.data.request.workshop) === wsUserId, `(status ${req1.status} ${JSON.stringify(req1.data).slice(0, 150)})`);

    const req1b = await json("/vehicle-intelligence/request", {
        method: "POST", body: { vehicleId, requestedItems: ["damage"] }
    }, ownerA.token);
    check("Duplicate open request is merged, not repeated", req1b.status === 200 && String(req1b.data.request?._id) === String(intelRequestId) && req1b.data.request.requestedItems.includes("damage"));

    const foreign = await json("/vehicle-intelligence/request", {
        method: "POST", body: { vehicleId, requestedItems: ["service"] }
    }, ownerB.token);
    check("Non-owner blocked from requesting a report", foreign.status === 403);

    // 4. Workshop sees the incoming request
    const incoming = await json("/vehicle-intelligence/incoming-requests", {}, wsToken);
    const seen = (incoming.data.requests || []).find(r => String(r._id) === String(intelRequestId));
    check("Workshop sees the request with vehicle + requester", incoming.status === 200 && !!seen && seen.vehicle?.make === BRAND && !!seen.requester?.name, JSON.stringify(incoming.data).slice(0, 150));

    // 5. Workshop uploads a verified service record, then marks the request answered
    const svc = await json(`/vehicle-intelligence/vehicle-history/${vehicleId}/service-records`, {
        method: "POST",
        body: { serviceDate: "2024-06-01", odometerKm: 41250, serviceType: "periodic-service", description: "IntelTest: full service + brake pads", cost: 5400, partsReplaced: [{ partName: "Brake pads" }] }
    }, wsToken);
    check("Workshop submits service record", svc.status === 201 && !!svc.data.record?._id, `(status ${svc.status})`);

    const respond = await json(`/vehicle-intelligence/requests/${intelRequestId}/respond`, {
        method: "PUT", body: { note: "All requested records uploaded." }
    }, wsToken);
    const r = respond.data.request || {};
    check("Workshop response marks request answered", respond.status === 200 && r.status === "responded");
    check("Uploaded record auto-attached to the response", (r.response?.recordsCreated || []).some(x => x.type === "service" && String(x.id) === String(svc.data.record._id)), JSON.stringify(r.response?.recordsCreated));
    check("Response anchored with record hash", !!r.anchor?.recordHash, JSON.stringify(r.anchor));
    if (r.anchor?.status === "anchored") check("Anchor tx hash present", !!r.anchor.txHash);
    else console.log(` (anchor status "${r.anchor?.status}" - the hash is stored and the on-chain commit happens once the anchoring wallet can pay the fee)`);

    const respondAgain = await json(`/vehicle-intelligence/requests/${intelRequestId}/respond`, { method: "PUT", body: {} }, wsToken);
    check("Double response rejected", respondAgain.status === 409);

    // 6. The response is visible to Owner A automatically
    const myReqs = await json("/vehicle-intelligence/my-requests", {}, ownerA.token);
    const mine = (myReqs.data.requests || []).find(x => String(x._id) === String(intelRequestId));
    check("Owner A ledger shows responded request", myReqs.status === 200 && mine?.status === "responded" && mine?.response?.submittedAt);

    const sumA = await json(`/vehicle-intelligence/vehicle-summary/${vehicleId}`, {}, ownerA.token);
    check("Owner A summary shows workshop data", sumA.status === 200 && sumA.data.summary.serviceRecords >= 1 && sumA.data.summary.latestService?.odometerKm === 41250, JSON.stringify(sumA.data.summary));

    // 7. Owner A initiates resale with an offer + attached intel
    const transfer = await json("/requests/transfer", {
        method: "POST",
        body: { vehicleId, buyerEmail: ownerB.email, salePrice: 450000, message: "Well maintained, full workshop history attached", attachIntel: true }
    }, ownerA.token);
    const requestId = transfer.data.requestId;
    check("Sale offer created (transfer + offer flag)", transfer.status === 201 && transfer.data.offerCreated === true && !!requestId, `(status ${transfer.status})`);

    const selfSale = await json("/requests/transfer", {
        method: "POST", body: { vehicleId, buyerEmail: ownerA.email }
    }, ownerA.token);
    check("Self-sale blocked", selfSale.status === 400);

    // 8. Owner B sees the incoming offer WITH the full intel report
    const offers = await json("/requests/incoming-offers", {}, ownerB.token);
    const offer = (offers.data.offers || []).find(o => String(o._id) === String(requestId));
    check("Buyer sees offer with seller + vehicle details", offers.status === 200 && !!offer && offer.seller?.name?.startsWith("Intel a") && offer.vehicle?.make === BRAND, JSON.stringify(offers.data).slice(0, 150));
    check("Offer carries price, message and attached intel", offer?.offer?.salePrice === 450000 && !!offer?.offer?.message && offer?.intel?.serviceRecords >= 1 && offer?.intel?.latestService?.odometerKm === 41250, JSON.stringify(offer?.intel));

    // 9. RTO cannot finalize before the buyer accepts
    const rto = await json("/auth/login", { method: "POST", body: { email: "ka.rto@biochain.com", password: "ka123" } });
    check("RTO login", rto.status === 200 && !!rto.data.token);
    const rtoToken = rto.data.token;
    const earlyApprove = await json(`/requests/${requestId}/approve`, { method: "POST", body: {} }, rtoToken);
    check("RTO approval blocked until buyer accepts", earlyApprove.status === 400 && /not reviewed/i.test(earlyApprove.data.message || ""), `(status ${earlyApprove.status} ${JSON.stringify(earlyApprove.data)})`);

    // 10. Buyer accepts (payment + biometrics are client-side, mirroring the buy flow)
    const accept = await json(`/requests/${requestId}/accept-buyer`, { method: "POST", body: { paymentMode: "Demo Payment" } }, ownerB.token);
    check("Buyer accepts the offer", accept.status === 200);
    const acceptAgain = await json(`/requests/${requestId}/accept-buyer`, { method: "POST", body: {} }, ownerB.token);
    check("Double accept rejected", acceptAgain.status === 409);
    const wrongBuyer = await json(`/requests/${requestId}/accept-buyer`, { method: "POST", body: {} }, ownerA.token);
    check("Only the buyer can accept the offer", wrongBuyer.status === 404);

    // 11. RTO finalizes the transfer
    const approve = await json(`/requests/${requestId}/approve`, { method: "POST", body: {} }, rtoToken);
    check("RTO finalizes transfer after buyer acceptance", approve.status === 200, `(status ${approve.status} ${JSON.stringify(approve.data).slice(0, 150)})`);

    // 11b. A vehicle the state never issued a number for cannot change hands:
    // there is nothing in the registry to move, so approving it would invent history.
    const bareTransfer = await json("/requests/transfer", {
        method: "POST",
        body: { vehicleId: bareVehicleId, buyerEmail: ownerB.email }
    }, ownerA.token);
    const bareRequestId = bareTransfer.data.requestId;
    if (bareRequestId) {
        await json(`/requests/${bareRequestId}/accept-buyer`, { method: "POST", body: {} }, ownerB.token);
        const bareApprove = await json(`/requests/${bareRequestId}/approve`, { method: "POST", body: {} }, rtoToken);
        check("Transfer of an unregistered vehicle is refused", bareApprove.status === 400 && /registration number/i.test(bareApprove.data.message || ""), `(status ${bareApprove.status} ${JSON.stringify(bareApprove.data).slice(0, 120)})`);
    } else {
        check("Transfer of an unregistered vehicle is refused", false, `(no request was created: status ${bareTransfer.status})`);
    }

    // 12. Data inheritance: the vehicle + all intel now belong to Owner B automatically
    const vehiclesB = await json("/vehicles/my", {}, ownerB.token);
    const listB = Array.isArray(vehiclesB.data) ? vehiclesB.data : (vehiclesB.data.vehicles || []);
    check("Vehicle appears in Owner B's fleet", listB.some(v => String(v._id) === vehicleId), JSON.stringify(vehiclesB.data).slice(0, 120));
    const sumB = await json(`/vehicle-intelligence/vehicle-summary/${vehicleId}`, {}, ownerB.token);
    check("Owner B sees the inherited workshop records", sumB.status === 200 && sumB.data.summary.serviceRecords >= 1 && sumB.data.summary.latestService?.odometerKm === 41250);

    // ---- Cleanup ----
    await mongoose.connection.close().catch(() => { });
    await mongoose.connect(mongoUri);
    const c = mongoose.connection.db;
    const ids = [ownerA.userId, ownerB.userId, wsUserId].map(id => new mongoose.Types.ObjectId(id));
    await c.collection("servicerecords").deleteMany({ submittedBy: { $in: ids } });
    await c.collection("vehicleintelrequests").deleteMany({ $or: [{ requester: { $in: ids } }, { workshop: { $in: ids } }] });
    await c.collection("requests").deleteMany({ $or: [{ seller: { $in: ids } }, { buyer: { $in: ids } }] });
    const testVehicleIds = [vehicleId, bareVehicleId].map(id => new mongoose.Types.ObjectId(id));
    await c.collection("vehicles").deleteMany({ _id: { $in: testVehicleIds } });
    await c.collection("ownershiphistories").deleteMany({ vehicle: { $in: testVehicleIds } });
    await c.collection("notifications").deleteMany({ recipient: { $in: ids } });
    // Signing up enrols a fingerprint template; deleting the account has to take
    // its biometrics with it or the suite leaves data belonging to nobody.
    await c.collection("biometrictemplates").deleteMany({ user: { $in: ids } });
    await c.collection("users").deleteMany({ _id: { $in: ids } });
    await mongoose.disconnect();
    console.log("\nTest data cleaned up");

    report();
};

const report = () => {
    console.log(`\n=== Result: ${passed} passed, ${failed} failed ===\n`);
    process.exit(failed ? 1 : 0);
};

run().catch(err => { console.error("e2e test crashed:", err); process.exit(1); });
