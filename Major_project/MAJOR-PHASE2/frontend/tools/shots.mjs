// shots.mjs - capture the 8 requested feature screenshots for the major project
// report into a single shareable folder. Headless; reuses the running dev servers
// (backend :5000, frontend :5173) and the SAME demo data left over from the last
// A-to-Z run (so Smart Migration / Fraud / 3D Damage / Forensics all show real data).
import { chromium } from "playwright-core";
import { mkdirSync } from "fs";
import { join } from "path";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5173";
const OUT = "C:\\Users\\Sai Krishna S\\Desktop\\Majormanvitha with Features\\Screenshots for major project report";
mkdirSync(OUT, { recursive: true });

// Demo accounts (match tools/demo.mjs).
const A = {
    owner: { email: "owner@biochain.com", password: "owner123" },               // Citizen B
    citA: { email: "ananya.demo@biochain.com", password: "demo1234" },          // Citizen A (owns the migrated EV)
    rtoKA: { email: "ka.rto@biochain.com", password: "ka123" },
    police: { email: "police@biochain.com", password: "police123" },
    damageOfficer: { email: "damage.rto@biochain.com", password: "damage123" }, // role rto
    forensicsOfficer: { email: "forensics.rto@biochain.com", password: "forensics123" }, // role rto
};

const log = (m) => console.log("[shot] " + m);
const wait = (p, ms) => p.waitForTimeout(ms);
const btn = (page, re) => page.getByRole("button", { name: re }).first();

async function login(page, acc, urlRe) {
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.locator('input[type="email"]').first().fill(acc.email);
    await page.locator('input[type="password"]').first().fill(acc.password);
    await btn(page, /Secure Login/i).click();
    await page.waitForURL(urlRe, { timeout: 15000 }).catch(() => { });
    await page.waitForLoadState("networkidle").catch(() => { });
    await wait(page, 900);
}
async function shot(page, name) {
    await page.waitForLoadState("networkidle").catch(() => { });
    await wait(page, 700);
    await page.screenshot({ path: join(OUT, name), fullPage: true });
    log("saved: " + name);
}

// SwiftShader so the WebGL 3D damage model still paints in headless mode.
const browser = await chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--no-sandbox"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
ctx.setDefaultTimeout(15000);
const page = await ctx.newPage();

try {
    // 1. User Registration and Login  -> the registration console (role + biometric).
    await page.goto(BASE + "/register", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await wait(page, 900);
    await shot(page, "1 - User Registration and Login.png");

    // 2. Vehicle Registration and Ownership Transfer -> owner dashboard.
    await login(page, A.owner, /\/owner/);
    await shot(page, "2 - Vehicle Registration and Ownership Transfer.png");

    // 3. Theft Management and Police Verification -> police dashboard.
    await login(page, A.police, /\/police/);
    await shot(page, "3 - Theft Management and Police Verification.png");

    // 4. Challan Management and Analytics Dashboard -> analytics console.
    await login(page, A.rtoKA, /\/rto/);
    await page.goto(BASE + "/analytics", { waitUntil: "domcontentloaded" });
    await wait(page, 1900); // charts animate in
    await shot(page, "4 - Challan Management and Analytics Dashboard.png");

    // 5. Vehicle Identity and Fraud Detection -> investigations console.
    await login(page, A.rtoKA, /\/rto/);
    await page.goto(BASE + "/investigations", { waitUntil: "domcontentloaded" });
    await wait(page, 1900);
    await shot(page, "5 - Vehicle Identity and Fraud Detection.png");

    // 6. Smart Migration Orchestrator -> migration console (dashboard + workspace).
    await login(page, A.rtoKA, /\/rto/);
    await page.goto(BASE + "/migration", { waitUntil: "domcontentloaded" });
    await wait(page, 1500);
    // Best-effort: open a record so the premium module bar (Workspace, A-G) shows.
    await btn(page, /BCM-|View|Open/i).click().catch(() => { });
    await wait(page, 1400);
    await shot(page, "6 - Smart Migration Orchestrator.png");

    // 7. 3D Vehicle Damage and Repair Intelligence -> open the seeded assessment.
    await login(page, A.damageOfficer, /\/rto/);
    await page.goto(BASE + "/damage", { waitUntil: "domcontentloaded" });
    await wait(page, 900);
    await page.locator('input[placeholder="e.g. KA-06-AB-1234"]').fill("KA46DH5566").catch(() => { });
    await btn(page, /Find vehicle/i).click().catch(() => { });
    await wait(page, 1800);
    await btn(page, /DMR-/i).click().catch(() => { });
    await wait(page, 2400); // let the 3D viewer render
    await shot(page, "7 - 3D Vehicle Damage and Repair Intelligence.png");

    // 8. Vehicle Lifecycle Forensics -> reconstruct the seeded vehicle.
    await login(page, A.forensicsOfficer, /\/rto/);
    await page.goto(BASE + "/forensics", { waitUntil: "domcontentloaded" });
    await wait(page, 900);
    await page.locator('input[placeholder="e.g. KA-06-AB-1234"]').fill("KA45FG1234").catch(() => { });
    await btn(page, /Reconstruct Vehicle History/i).click().catch(() => { });
    await wait(page, 2400); // timeline + dependency graph render
    await shot(page, "8 - Vehicle Lifecycle Forensics.png");
} catch (e) {
    log("FATAL: " + e.message);
} finally {
    await browser.close();
}
log("DONE -> " + OUT);
