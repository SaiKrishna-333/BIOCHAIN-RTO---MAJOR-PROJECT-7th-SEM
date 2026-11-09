// seed-owner-vehicle.mjs
// Gives the seeded demo owner (owner@biochain.com) one vehicle to work with, so
// the resale, theft, inheritance, document and inter-state flows can be shown
// live in a demonstration.
//
// It uses the public API only, through the real workflow:
//   dealer submits a new registration -> RTO approves and assigns the number
// Nothing is written to MongoDB directly and no hashes are invented.
//
// Run with the backend up:  node demo-seed/seed-owner-vehicle.mjs
const BASE = process.env.API_BASE || "http://localhost:5000/api";

const OWNER_EMAIL = "owner@biochain.com";
const OWNER_PASSWORD = "owner123";
const DEALER_EMAIL = "dealer@biochain.com";
const DEALER_PASSWORD = "dealer123";
const RTO_EMAIL = "tn.rto@biochain.com"; // Telangana register, so the Karnataka
const RTO_PASSWORD = "tn123";            // account can demo an inter-state move

const REG_NUMBER = "TS09DEMO01";
const CHASSIS = "MA3DEMOSEED0000001";
const ENGINE = "DEMOENGINE001";

const login = async (email, password) => {
    const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
    });
    const data = await res.json().catch(() => ({}));
    if (!data.token) {
        throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(data)}`);
    }
    return data.token;
};

const call = async (path, token, method = "GET", body) => {
    const res = await fetch(`${BASE}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            ...(body ? { "content-type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`);
    }
    return data;
};

const main = async () => {
    const owner = await login(OWNER_EMAIL, OWNER_PASSWORD);

    const mine = await call("/vehicles/my", owner);
    if (mine.length > 0) {
        console.log(`Owner already has ${mine.length} vehicle(s). Nothing to seed.`);
        console.log(mine.map((v) => `${v.regNumber} ${v.make} ${v.model}`).join("\n"));
        return;
    }

    const dealer = await login(DEALER_EMAIL, DEALER_PASSWORD);
    const rto = await login(RTO_EMAIL, RTO_PASSWORD);

    const created = await call("/requests/new-registration", dealer, "POST", {
        buyerEmail: OWNER_EMAIL,
        vehicleDetails: {
            chassisNumber: CHASSIS,
            engineNumber: ENGINE,
            make: "Maruti Suzuki",
            model: "Baleno",
            year: 2024,
            fuelType: "Petrol",
        },
        exShowroomPrice: 700000,
        roadTax: 70000,
        registrationFee: 600,
        insuranceAmount: 28000,
        handlingCharges: 5000,
        otherCharges: 0,
        paymentMode: "Full Payment",
    });
    console.log(`Registration request ${created.requestId} created, invoice ${created.invoiceNumber}`);

    const approved = await call(
        `/requests/${created.requestId}/approve`,
        rto,
        "POST",
        { regNumber: REG_NUMBER },
    );
    console.log(`RTO approved. ${JSON.stringify(approved).slice(0, 200)}`);

    const after = await call("/vehicles/my", owner);
    console.log(
        `\nOwner ${OWNER_EMAIL} now holds ${after.length} vehicle(s):`,
    );
    for (const v of after) {
        console.log(
            `  ${v.regNumber} - ${v.make} ${v.model} (${v.year}) status ${v.status}` +
            `${v.blockchainTxHash ? `, on-chain ${String(v.blockchainTxHash).slice(0, 18)}...` : ", on-chain pending"}`,
        );
    }
};

main().catch((err) => {
    console.error("Seeding failed:", err.message);
    process.exit(1);
});
