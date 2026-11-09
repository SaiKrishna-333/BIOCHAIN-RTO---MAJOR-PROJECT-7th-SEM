// ocrService.js
// Real OCR (tesseract.js) for government ID documents uploaded during sign-up.
// The uploaded image is turned into text on the server, and a deterministic
// parser mines the fields the registration form needs (name, Aadhaar, DL,
// DOB, phone, address, state/district). Nothing is sent to any third party.

import { createWorker } from "tesseract.js";

let workerPromise = null;

// Lazily create (and reuse) a single eng worker. The traineddata is fetched
// once into ./cache on first use and reused afterwards.
const getWorker = () => {
    if (!workerPromise) {
        workerPromise = createWorker("eng", 1, {
            cachePath: new URL("../../cache", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
            logger: () => { },
        });
    }
    return workerPromise;
};

/**
 * Run OCR over an image buffer and return the recognized text + average confidence.
 */
export const ocrImageBuffer = async (buffer) => {
    const worker = await getWorker();
    const { data } = await worker.recognize(buffer);
    const words = (data.words || []).filter((w) => (w.text || "").trim());
    const confidence = words.length
        ? words.reduce((a, w) => a + (w.confidence || 0), 0) / words.length
        : data.confidence || 0;
    return { text: data.text || "", confidence: Math.round(confidence) };
};

// ---------------------------------------------------------------------------
// Field mining from raw OCR text. All regexes are tolerant of the spacing /
// letter-substitution noise tesseract produces on ID cards.
// ---------------------------------------------------------------------------

const INDIAN_STATES = {
    "andhra pradesh": "AP", "telangana": "TS", "karnataka": "KA", "tamil nadu": "TN",
    "maharashtra": "MH", "delhi": "DL", "new delhi": "DL", "gujarat": "GJ",
    "rajasthan": "RJ", "uttar pradesh": "UP", "madhya pradesh": "MP", "kerala": "KL",
    "west bengal": "WB", "punjab": "PB", "haryana": "HR", "himachal pradesh": "HP",
    "uttarakhand": "UK", "bihar": "BR", "jharkhand": "JH", "odisha": "OD", "assam": "AS",
};

const cleanName = (raw) => {
    if (!raw) return "";
    return raw
        .replace(/[^A-Za-z\s.\-']/g, "")
        .replace(/\b(DOOR|HOUSE NO|FLAT|VILLAGE|POST|PLACE|DATE OF BIRTH|GENDER|FATHER|MOTHER|WIFE OF|S\/O|D\/O)\b.*$/i, "")
        .trim()
        .replace(/\s+/g, " ")
        .split(" ")
        .map((w) => (w.length > 1 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toUpperCase()))
        .join(" ");
};

export const parseIdentityText = (text) => {
    const fields = {};
    if (!text || !text.trim()) return { fields, documentType: "unknown" };

    // Tesseract often confuses digits inside Aadhaar numbers; normalize common glyph swaps
    const normalized = text
        .replace(/\bO/g, "0")
        .replace(/\bl/g, "1");
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const upper = text.toUpperCase();

    // ---- Document type ----
    let documentType = "id-document";
    if (/AADHAAR|आधार|UNIQUE IDENTIFICATION|UIDAI/.test(upper)) documentType = "aadhaar";
    else if (/DRIVING LICEN[CS]E|DRIVER LICENSE|DL NUMBER|PARIVAHAN|TRANSPORT DEPARTMENT/.test(upper)) documentType = "driving-licence";
    else if (/VOTER|EPIC|ELECTION/.test(upper)) documentType = "voter-id";
    else if (/PAN CARD|PERMANENT ACCOUNT NUMBER|INCOME TAX/.test(upper)) documentType = "pan";

    // ---- Aadhaar: 12 digits, optionally grouped 4-4-4, ignore virtual/OTP hint lines ----
    const digitRuns = (normalized.match(/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g) || [])
        .map((s) => s.replace(/[\s-]/g, ""))
        .filter((s) => !/^(0|1)/.test(s)) // real Aadhaar never starts with 0/1
        .filter((s) => !/(000000000000|123456789012)/.test(s));
    if (digitRuns.length) fields.aadhaarNumber = digitRuns[0];

    // ---- Driving licence: <ST><LL> <YYYY><serial> e.g. KA01 20110012345, DL-19-2011-0012345 ----
    const dlMatch = text.match(/\b([A-Z]{2}[\s-]?\d{2}[\s-]?)(\d{2})(\d{2})[\s-]?(\d{7})\b/i)
        || text.match(/\bDL[\s-](\d{2})[\s-](\d{4})[\s-](\d{7})\b/i);
    if (dlMatch) {
        const all = text.replace(/[^A-Z0-9]/gi, "").toUpperCase();
        const m = all.match(/([A-Z]{2}\d{2})(\d{4})(\d{7})/);
        if (m) fields.dlNumber = `${m[1]} ${m[2]}${m[3]}`;
        else fields.dlNumber = dlMatch[0].toUpperCase().replace(/\s+/g, " ").trim();
    }

    // ---- Date of birth ----
    const dobMatch = text.match(/(?:DATE OF BIRTH|DOB|BORN)[\s:.\-]*?(\d{2}[/\-.]\d{2}[/\-.]\d{4})/i)
        || text.match(/\b(\d{2}[/\-.]\d{2}[/\-.]\d{4})\b/);
    if (dobMatch) fields.dob = dobMatch[1].replace(/[.\-]/g, "/");

    // ---- Phone (+91 optional) ----
    const phoneMatch = text.match(/(?:\+?91[\s-]?)?([6-9]\d{2}[\s-]?\d{3}[\s-]?\d{4})\b/);
    if (phoneMatch) fields.phone = phoneMatch[1].replace(/\D/g, "");

    // ---- Name ----
    // Aadhaar-style: line right after a name label or the ALL-CAPS personal line
    const nameLabel = lines.find((l) => /^ *(NAME|Shri|Smt|K\.M\.|Mr\.?|Mrs\.?)[:\s]+([A-Z][A-Za-z\s.'\- ]{5,40})$/i.test(l) && !/NAME.*DOC/i.test(l));
    if (nameLabel) {
        const after = nameLabel.replace(/^\s*(NAME|Shri|Smt|Mr\.?|Mrs\.?)[:\s]+/i, "");
        fields.name = cleanName(after);
    }
    if (!fields.name) {
        // Common Aadhaar layout prints the holder name alone on its own line near the top
        const candidate = lines.slice(0, 8).find((l) =>
            /^[A-Z][A-Za-z.'\- ]{6,40}$/.test(l) &&
            !/INDIA|GOVERNMENT|REPUBLIC|UNIQUE|AADHAAR|DRIVING|LICENCE|LICENSE|ADDRESS|BIRTH|GENDER|FATHER|MOTHER|DOOR|VILLAGE|POST|PIN|STATE|DIGITAL|MOBILE|WEEKDAY/.test(l.toUpperCase()) &&
            l.split(" ").length >= 2 &&
            l === l.toUpperCase());
        if (candidate) fields.name = cleanName(candidate);
    }

    // ---- Address (Aadhaar prints DOOR NO ... / city / pin) ----
    const addrStart = lines.findIndex((l) => /DOOR NO|ADDRESS|VILLAGE|POST[^A-Z]|PIN[\s:-]/i.test(l) && !/E-?MAIL/i.test(l));
    if (addrStart !== -1) {
        const addrLines = [];
        for (let i = addrStart; i < Math.min(addrStart + 5, lines.length); i++) {
            const l = lines[i].replace(/^\s*(ADDRESS[:\s]*)/i, "");
            if (/^NAME/i.test(l) && addrLines.length) break;
            if (l) addrLines.push(l);
            if (/PIN\s?\d{6}|^\d{6}$/.test(l)) break;
        }
        const addr = addrLines.join(", ").replace(/,\s*$/, "").trim();
        if (addr.length > 8) fields.address = addr;
    }
    const pinMatch = text.match(/\bPIN(?:CODE)?[\s:\-]*(\d{6})\b/i);
    if (pinMatch) fields.pincode = pinMatch[1];

    // ---- State / district ----
    for (const [stateName, code] of Object.entries(INDIAN_STATES)) {
        if (upper.includes(stateName.toUpperCase())) {
            fields.state = code;
            fields.stateName = stateName.replace(/\b\w/g, (c) => c.toUpperCase());
            break;
        }
    }
    const distMatch = text.match(/\b(?:DIST(?:RICT)?|DIST)[\s:.\-]+([A-Z][A-Za-z\s.]{2,25})/i);
    if (distMatch) fields.district = distMatch[1].trim().replace(/\s+/g, " ");

    // ---- Gender ----
    const genderMatch = text.match(/\bGENDER[\s:.\-]*(MALE|FEMALE|OTHER)/i);
    if (genderMatch) fields.gender = genderMatch[1].toUpperCase();

    // ---- Father / mother name (Aadhaar relation line) ----
    const relMatch = text.match(/\b(?:W\/O|H\/O|S\/O|D\/O|C\/O)[:\s.\-]*([A-Z][A-Za-z\s.'\- ]{4,40})/i);
    if (relMatch) fields.guardianName = cleanName(relMatch[1]);

    return { fields, documentType };
};

/**
 * Full pipeline: buffer -> OCR text -> structured form fields.
 */
export const extractIdentityFromImage = async (buffer) => {
    const { text, confidence } = await ocrImageBuffer(buffer);
    const { fields, documentType } = parseIdentityText(text);
    const extractedCount = Object.keys(fields).length;
    return {
        documentType,
        fields,
        confidence,
        rawTextPreview: text.slice(0, 500),
        message: extractedCount
            ? `OCR read the document and found ${extractedCount} field(s). Please review before submitting.`
            : "The document was read but no recognizable fields were extracted. Please type the details manually.",
    };
};
