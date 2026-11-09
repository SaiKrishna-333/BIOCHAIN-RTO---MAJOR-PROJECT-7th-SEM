// seed-a2z-demo.mjs
// Seeds the handful of A-to-Z recording scenarios the UI cannot create by itself:
//   - Citizen C (carol.demo@biochain.com): the third owner AND the legal heir.
//   - V3 (KA45CF1357): a dedicated vehicle owned by B, used for the theft report.
//   - V4 (KA45CF8642): a dedicated vehicle owned by B, claimed by C via inheritance.
//   - SHADOW (XX00SHDW01): a vehicle whose chassis normalises to V1's chassis, so the
//     identity-cloning scan finds a real duplicate-chassis conflict against V1.
//
// It is idempotent: it deletes-then-inserts by these fixed keys, so re-running it
// leaves the same clean set of demo rows. It NEVER touches V1/V2 (registered live in
// the recording) and NEVER deletes the seeded owner B (owner@biochain.com).
//
// Run from the backend folder, after the app's own demo users are seeded:
//   node seed-a2z-demo.mjs
import "dotenv/config";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { User } from "./src/models/User.js";
import { Vehicle } from "./src/models/Vehicle.js";

const uri = process.env.MONGO_URI || "mongodb://localhost:27017/BioChainRTO";

// --- Fixed keys -------------------------------------------------------------
const OWNER_B_EMAIL = "owner@biochain.com";

const CITIZEN_C = {
    name: "Carol Fernandes",
    email: "carol.demo@biochain.com",
    password: "demo1234",
    phone: "9876543221",
    address: "Bengaluru",
    state: "Karnataka",
    district: "Bengaluru Urban",
    aadhaarNumber: "229988776655",
    dlNumber: "KA0520260088776",
};

// V1 is registered live during the recording with chassis MA12E45FG90112233.
// SHADOW stores a separator-only variant of that same chassis. The DB unique index
// sees two different literal strings, so both rows can exist; the cloning detector
// uppercases and strips non-alphanumerics, so it groups them as one and flags the
// duplicate. Its engine number is deliberately distinct - a chassis conflict is
// enough to demonstrate the detector.
const VEHICLES = [
    {
        regNumber: "KA45CF1357",
        chassisNumber: "MA12E45FG9031357",
        engineNumber: "EN45DE9935711",
        make: "Maruti Suzuki",
        model: "Swift VXi",
        year: 2022,
    },
    {
        regNumber: "KA45CF8642",
        chassisNumber: "MA12E45FG9086420",
        engineNumber: "EN45DE9986421",
        make: "Maruti Suzuki",
        model: "Alto K10",
        year: 2021,
    },
    {
        regNumber: "XX00SHDW01",
        chassisNumber: "ma12-e45fg-90112233",
        engineNumber: "EN45SHDW9988771",
        make: "Maruti Suzuki",
        model: "Dzire ZXi",
        year: 2026,
    },
];

async function ensureOwnerB() {
    const b = await User.findOne({ email: OWNER_B_EMAIL });
    if (b) return b;
    // Defensive: the demo users seeder is expected to have created B already. If it
    // has not, create it here so the theft/inheritance vehicles have a real owner to
    // reference. This never removes an existing B.
    const passwordHash = await bcrypt.hash("owner123", 10);
    return User.create({
        name: "Owner Demo",
        email: OWNER_B_EMAIL,
        passwordHash,
        role: "owner",
        phone: "9876543211",
        address: "Bengaluru",
        state: "Karnataka",
        district: "Bengaluru Urban",
    });
}

async function ensureCitizenC() {
    await User.deleteMany({ $or: [{ email: CITIZEN_C.email }, { aadhaarNumber: CITIZEN_C.aadhaarNumber }, { dlNumber: CITIZEN_C.dlNumber }] });
    const passwordHash = await bcrypt.hash(CITIZEN_C.password, 10);
    const carol = await User.create({ ...CITIZEN_C, passwordHash, role: "owner", verificationStatus: "verified" });
    console.log(`  created Citizen C: ${carol.email}`);
    return carol;
}

async function seedVehicles(ownerB) {
    // Remove any prior run's rows first (by reg or chassis) so the unique indexes
    // never collide on a re-run.
    for (const v of VEHICLES) {
        await Vehicle.deleteMany({ $or: [{ regNumber: v.regNumber }, { chassisNumber: v.chassisNumber }, { engineNumber: v.engineNumber }] });
    }
    const now = new Date();
    for (const v of VEHICLES) {
        await Vehicle.create({
            ...v,
            currentOwner: ownerB._id,
            registeredBy: ownerB._id,
            status: "active",
            registrationDate: now,
            issuedByOffice: "KA-01 Bangalore Central RTO",
            issuedByOfficer: "Karnataka RTO Demo",
            ownershipHistory: [{ owner: ownerB._id, transferDate: now, transferReason: "purchase" }],
        });
        console.log(`  created vehicle: ${v.regNumber} (chassis ${v.chassisNumber})`);
    }
}

const main = async () => {
    await mongoose.connect(uri);
    console.log(`Connected to ${uri} for A-to-Z demo seeding`);

    const ownerB = await ensureOwnerB();
    console.log(`  owner B ready: ${ownerB.email}`);
    await ensureCitizenC();
    await seedVehicles(ownerB);

    console.log("A-to-Z demo seed complete");
    await mongoose.disconnect();
};

main().catch((err) => {
    console.error("A-to-Z demo seed failed:", err);
    process.exit(1);
});
