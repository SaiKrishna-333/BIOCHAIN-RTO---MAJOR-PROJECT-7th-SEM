// test-idcard-ocr.js
// Live verification for the new sign-up OCR + Digital ID Card features.
// 1) parser unit checks on realistic OCR text (Aadhaar + Driving Licence)
// 2) real OCR of a rendered ID image through the running API
// 3) register -> login -> issue Digital ID Card -> integrity verify
// (asserts the anchor either carries a REAL Polygon Amoy txHash or explains,
//  honestly and actionably, why no transaction was made)
// Run: node --env-file=.env src/test-idcard-ocr.js (backend must be running)
import axios from "axios";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { parseIdentityText } from "./services/ocrService.js";
import { User } from "./models/User.js";
import { UserIdCard } from "./models/UserIdCard.js";

const API = "http://localhost:5000/api";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
    if (cond) { pass++; console.log(` [PASS] ${name}`); }
    else { fail++; console.log(` [FAIL] ${name}${extra ? " - " + extra : ""}`); }
};

// ---------------------------------------------------------------------------
// 1) Parser unit checks (no OCR needed) - deterministic text -> fields
// ---------------------------------------------------------------------------
const aadhaarText = `GOVERNMENT OF INDIA
AADHAAR
NAME: SAI KRISHNA S
S/O: KRISHNAMURTHI S
DOB: 15/08/1998
GENDER: MALE
ADDRESS: 12 MG ROAD, BENGALURU, KARNATAKA
PIN 560001
2345 6789 0123`;

const dlText = `TRANSPORT DEPARTMENT
DRIVING LICENCE
DL NUMBER: KA 01 20110012345
NAME: SAI KRISHNA S
DATE OF BIRTH: 15/08/1998
ADDRESS: BENGALURU KARNATAKA
MOBILE: 9876543210`;

// ---------------------------------------------------------------------------
async function run() {
    await mongoose.connect(process.env.MONGO_URI || "mongodb://127.0.0.1:27017/BioChainRTO");
    console.log("\n=== 1) OCR field-parser (pure logic) ===");

    const a = parseIdentityText(aadhaarText).fields;
    ok("aadhaar: name extracted", /SAI KRISHNA/i.test(a.name || ""), `got "${a.name}"`);
    ok("aadhaar: 12-digit number", a.aadhaarNumber === "234567890123", `got ${a.aadhaarNumber}`);
    ok("aadhaar: dob", a.dob === "15/08/1998", `got ${a.dob}`);
    ok("aadhaar: gender", a.gender === "MALE", `got ${a.gender}`);
    ok("aadhaar: pincode", a.pincode === "560001", `got ${a.pincode}`);
    ok("aadhaar: state code KA", a.state === "KA", `got ${a.state}`);
    ok("aadhaar: address mentions BENGALURU", /BENGALURU/i.test(a.address || ""), `got "${a.address}"`);

    const d = parseIdentityText(dlText);
    ok("dl: documentType driving-licence", d.documentType === "driving-licence", `got ${d.documentType}`);
    ok("dl: dlNumber normalized", /^KA01 20110012345$/.test(d.fields.dlNumber || ""), `got "${d.fields.dlNumber}"`);
    ok("dl: phone", d.fields.phone === "9876543210", `got ${d.fields.phone}`);

    // -----------------------------------------------------------------------
    console.log("\n=== 2) Real OCR through the live API ===");
    const imgPath = path.join(__dirname, "..", "test-fixtures", "sample-id.png");
    if (fs.existsSync(imgPath)) {
        const form = new FormData();
        form.append("document", new Blob([fs.readFileSync(imgPath)], { type: "image/png" }), "sample-id.png");
        try {
            const { data } = await axios.post(`${API}/ocr/extract`, form);
            console.log(` OCR server said: ${data.message}`);
            ok("OCR endpoint reachable + returned JSON", typeof data.success === "boolean");
            ok("OCR read the image (success flag)", data.success === true, `success=${data.success}`);
            if (data.fields && Object.keys(data.fields).length) {
                console.log(` fields: ${JSON.stringify(data.fields)}`);
            }
        } catch (e) {
            ok("OCR endpoint reachable", false, e.message);
        }
    } else {
        console.log(` [NOTE] skipped (no fixture at ${imgPath})`);
    }

    // -----------------------------------------------------------------------
    console.log("\n=== 3) Register -> Digital ID Card -> integrity verify ===");
    const email = `idcard.probe.${Date.now()}@owner.com`;
    const regForm = new FormData();
    regForm.append("name", "Probe Citizen");
    regForm.append("email", email);
    regForm.append("password", "probe123");
    regForm.append("role", "owner");
    regForm.append("phone", "+91 9000000001");
    regForm.append("address", "1 Test Street, Bengaluru");
    regForm.append("state", "KA");
    regForm.append("district", "Bangalore Urban");
    regForm.append("aadhaarNumber", "234567890123");
    regForm.append("dlNumber", "KA01 20110012345");
    regForm.append("kycDocType", "aadhaar");
    regForm.append("kycViaOcr", "true");
    const { status: regStatus } = await axios.post(`${API}/auth/register`, regForm);
    ok("register 201", regStatus === 201, `status ${regStatus}`);

    const created = await User.findOne({ email });
    ok("simulated biometric auto-enrolled at registration", !!created?.fingerprintTemplateId, `template=${created?.fingerprintTemplateId}`);
    ok("KYC provenance stored (OCR)", created?.kyc?.extractedViaOcr === true && created?.kyc?.documentType === "aadhaar", JSON.stringify(created?.kyc));

    const { data: login } = await axios.post(`${API}/auth/login`, { email, password: "probe123" });
    const token = login.token;
    const hdr = { headers: { Authorization: `Bearer ${token}` } };

    const { data: issued } = await axios.post(`${API}/id-card/me`, {}, hdr);
    const card = issued.card;
    ok("card issued", !!card?.cardNumber, `num=${card?.cardNumber}`);
    ok("aadhaar masked on card", /^\d{4} \d{4}$/.test(card?.identifiers?.aadhaarMasked?.replace(/XXXX XXXX /, "")) || card?.identifiers?.aadhaarMasked?.includes("0123"), card?.identifiers?.aadhaarMasked);
    ok("card carries unique fingerprint seed", !!card?.biometric?.fingerprintSeed, card?.biometric?.fingerprintSeed);
    ok("card anchor has recordHash", /^[0-9a-f]{64}$/.test(card?.anchor?.recordHash || ""), card?.anchor?.recordHash);
    const hasTx = /^0x[0-9a-f]{64}$/i.test(card?.anchor?.txHash || "");
    if (hasTx) {
        ok("card carries a real on-chain transaction hash", true);
    } else {
        // No chain commitment is acceptable only when the record says so plainly
        // and says why in terms someone can act on. A silent "pending" or an
        // invented explorer link would be the failure here.
        ok("uncommitted card stays honestly 'pending'", card?.anchor?.status === "pending", `status=${card?.anchor?.status}`);
        ok("and explains why no transaction was made", /not attempted|not submitted|skipped/i.test(card?.anchor?.note || ""), (card?.anchor?.note || "").slice(0, 80));
    }

    // idempotent GET
    const { data: fetched } = await axios.get(`${API}/id-card/me`, hdr);
    ok("GET /id-card/me returns the card", fetched.hasCard === true && fetched.card.cardNumber === card.cardNumber);

    // integrity verify
    const { data: v } = await axios.get(`${API}/id-card/me/verify`, hdr);
    ok("integrity verify => verified true", v.verified === true, v.reason);

    // on-chain receipt of the anchor tx (proves the View Transaction link is live)
    if (hasTx) {
        const rpc = process.env.POLYGON_RPC_URL || "https://polygon-amoy-bor-rpc.publicnode.com";
        let rec = null;
        // Amoy mines in ~2s blocks but RPC propagation lags; poll briefly.
        for (let i = 0; i < 12 && !rec; i++) {
            await new Promise((r) => setTimeout(r, 4000));
            try {
                const r = await axios.post(rpc, { jsonrpc: "2.0", id: 1, method: "eth_getTransactionReceipt", params: [card.anchor.txHash] });
                if (r.data?.result) rec = r.data.result;
            } catch { /* retry */ }
        }
        ok("anchor tx mined on-chain (receipt found)", !!rec, "no receipt after polling");
        if (rec) ok("anchor tx succeeded (status 0x1)", rec.status === "0x1", `status=${rec.status}`);
    }

    // cleanup demo probe data
    await UserIdCard.deleteOne({ user: created._id });
    await mongoose.connection.collection("biometrictemplates").deleteMany({ user: created._id });
    await User.deleteOne({ _id: created._id });
    console.log("\n (probe user + card cleaned up)");

    console.log(`\n=== ID-CARD/OCR live check: ${pass} passed, ${fail} failed ===`);
    await mongoose.disconnect();
    process.exit(fail ? 1 : 0);
}

run().catch((e) => { console.error("FATAL", e); process.exit(1); });
