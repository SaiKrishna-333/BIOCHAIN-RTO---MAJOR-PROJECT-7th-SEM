// make-migration-docs.mjs - renders the Feature B demo documents to PNGs that
// tesseract can actually read (large, high-contrast, label-anchored text).
//
//   node tools/make-migration-docs.mjs
//
// Output: backend/test-fixtures/migration/*.png
// The "BAD"/"EXPIRED" variants exist so the demo can show the cross-document
// audit REJECTING a mismatched VIN and an expired certificate - the strongest
// possible demonstration that the intelligence is real.
import { chromium } from "playwright-core";
import { mkdirSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../backend/test-fixtures/migration");

// Identity of V2 (the EV the demo migrates) - keep in sync with demo.mjs.
const V = {
    reg: "KA45CF2468",
    chassis: "MA12E45FG9024680",
    engine: "EN45DE9924681",
    owner: "ANANYA KRISHNAN",
};

const shell = (title, inner) => `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;background:#e8e8e8;font-family:Arial,Helvetica,sans-serif;}
  .doc{width:920px;margin:24px auto;background:#fff;border:3px solid #222;padding:34px 40px;box-sizing:border-box;}
  .hdr{text-align:center;border-bottom:3px solid #222;padding-bottom:12px;margin-bottom:18px;}
  .hdr h1{font-size:30px;margin:0;letter-spacing:2px;color:#123;}
  .hdr p{font-size:17px;margin:6px 0 0;color:#333;}
  table{width:100%;border-collapse:collapse;font-size:21px;}
  td{border:1.5px solid #444;padding:11px 12px;}
  td.k{width:38%;background:#f2f2f2;font-weight:bold;color:#222;}
  td.v{font-family:'Courier New',monospace;font-size:22px;letter-spacing:1px;color:#000;}
  .ftr{margin-top:16px;font-size:14px;color:#555;text-align:center;}
</style></head><body><div class="doc"><div class="hdr"><h1>${title}</h1></div>${inner}<div class="ftr">BioChain RTO demo document - simulated for Feature B testing</div></div></body></html>`;

const row = (k, v) => `<tr><td class="k">${k}</td><td class="v">${v}</td></tr>`;

const DOCS = [
    {
        file: "rc.png", title: "REGISTRATION CERTIFICATE",
        rows: [
            row("Registration Number", V.reg),
            row("Chassis Number", V.chassis),
            row("Engine Number", V.engine),
            row("Owner Name", V.owner),
            row("Registered On", "15/06/2026"),
            row("Vehicle Make", "MARUTI SUZUKI"),
            row("Vehicle Model", "BALENO EV"),
        ],
    },
    {
        file: "insurance.png", title: "MOTOR INSURANCE CERTIFICATE",
        rows: [
            row("Policy Number", "ICI/GEN/2026/778812"),
            row("Insurer", "ICICI LOMBARD GENERAL"),
            row("Vehicle Chassis Number", V.chassis),
            row("Declared Value / IDV", "950000"),
            row("Valid Till", "20/08/2027"),
            row("Registered Owner", V.owner),
        ],
    },
    {
        file: "insurance-wrong-vin.png", title: "MOTOR INSURANCE CERTIFICATE",
        rows: [
            row("Policy Number", "BAJ/GEN/2026/445599"),
            row("Insurer", "BAJAJ ALLIANZ GENERAL"),
            row("Vehicle Chassis Number", "MA3EWDR30RG999888"),
            row("Declared Value / IDV", "940000"),
            row("Valid Till", "10/11/2027"),
            row("Registered Owner", V.owner),
        ],
    },
    {
        file: "puc.png", title: "POLLUTION UNDER CONTROL CERTIFICATE",
        rows: [
            row("PUC Certificate Number", "PUC/KA/2026/556677"),
            row("Registration Number", V.reg),
            row("Fuel Type", "ELECTRIC"),
            row("Valid Upto", "05/09/2027"),
        ],
    },
    {
        file: "puc-expired.png", title: "POLLUTION UNDER CONTROL CERTIFICATE",
        rows: [
            row("PUC Certificate Number", "PUC/KA/2024/113355"),
            row("Registration Number", V.reg),
            row("Fuel Type", "ELECTRIC"),
            row("Expiry Date", "10/01/2025"),
        ],
    },
    {
        file: "address.png", title: "ADDRESS PROOF - RESIDENTIAL CERTIFICATE",
        rows: [
            row("Name of Resident", V.owner),
            row("Address", "14 INDIRANAGAR, BENGALURU"),
            row("State", "KARNATAKA"),
            row("Pin Code", "560038"),
        ],
    },
    {
        file: "bill-of-sale.png", title: "BILL OF SALE / DEALER INVOICE",
        rows: [
            row("Seller", "MARUTI ARENA SHOWROOM"),
            row("Buyer Name", V.owner),
            row("Vehicle Chassis Number", V.chassis),
            row("Sale Price", "945000"),
            row("Sold On", "12/06/2026"),
        ],
    },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
mkdirSync(OUT, { recursive: true });
for (const d of DOCS) {
    const html = shell(d.title, `<table>${d.rows.join("")}</table>`);
    await page.setContent(html, { waitUntil: "load" });
    await page.locator(".doc").screenshot({ path: path.join(OUT, d.file) });
    console.log("wrote", d.file);
}
await browser.close();
console.log("Done. Fixtures in", OUT);
