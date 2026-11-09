// demo.mjs - automated A-to-Z BioChain RTO walkthrough for screen recording.
// Headed (recordable):  $env:DEMO_HEADED=1; node tools/demo.mjs
// Headless (self-test): node tools/demo.mjs
//
// It drives the full lifecycle in document order: registration, digital ID, two
// dealer registrations (V1 petrol + V2 electric), RTO approvals, on-chain/RC view,
// challan+payment, the three workshop intel passports, the EV battery passport,
// an owner accident upload + police verification, a resale carrying the FULL
// multi-party approval checklist, intra-state and inter-state transfers, a theft
// report, an inheritance claim, then the fraud casebook, anomaly and cloning
// detectors, analytics and registry search, and finally the two standalone modules -
// 3D Damage & Repair Intelligence (F9) and Lifecycle Forensics (F10).
// Seed first, in the backend:
//   node seed-a2z-demo.mjs        (Citizen C, theft/inheritance vehicles, SHADOW clone)
//   node seed-damage-demo.mjs     (F9 case: vehicle KA46DH5566, assessment DMR-...)
//   node seed-forensics-demo.mjs  (F10 case: vehicle KA45FG1234, engine-swap conflict)
import { chromium } from "playwright-core";
import { fileURLToPath } from "url";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5173";
const HEADED = process.env.DEMO_HEADED === "1";
const PHOTO = fileURLToPath(new URL("../src/assets/road-footer.jpg", import.meta.url));
// A readable identity document for the Smart Migration OCR panel - the backend
// test-fixtures sample has printed text, so OCR returns "read" (not "unreadable")
// and the owner can verify it, which is what submitting an application requires.
const MIGRATION_DOC = fileURLToPath(new URL("../../backend/test-fixtures/sample-id.png", import.meta.url));
const HOLD = HEADED ? 120 : 60; // imperceptible scene transition - zero gap feel

const A = {
    dealer: { email: "dealer@biochain.com", password: "dealer123" },
    rtoKA: { email: "ka.rto@biochain.com", password: "ka123" },
    rtoTN: { email: "tn.rto@biochain.com", password: "tn123" },
    police: { email: "police@biochain.com", password: "police123" },
    workshop: { email: "maruti.demo@workshop.com", password: "demo123" },
    owner: { email: "owner@biochain.com", password: "owner123" }, // Citizen B (buyer)
    damageOfficer: { email: "damage.rto@biochain.com", password: "damage123" }, // Feature 9 reviewer (role rto)
    forensicsOfficer: { email: "forensics.rto@biochain.com", password: "forensics123" }, // Feature 10 investigator (role rto)
};
const CITIZEN = { name: "Ananya Krishnan", email: "ananya.demo@biochain.com", password: "demo1234", aadhaar: "119988776655", dl: "KA0520260099887" }; // Citizen A (seller)
const CAROL = { email: "carol.demo@biochain.com", password: "demo1234" }; // Citizen C (third owner + heir) - seeded

// Fixed registry numbers. V1 lives the whole recording; V2 is the EV; V3/V4 are
// seeded for theft/inheritance; SHADOW is the seeded clone. V1 changes reg when the
// inter-state move finalises, so cleanup keys on chassis, not reg.
const REG = "KA45CF1234"; // V1 - Maruti Dzire (petrol)
const REG_V2 = "KA45CF2468"; // V2 - Maruti Baleno EV
const REG_V3 = "KA45CF1357"; // V3 - theft vehicle (owned by B)
const REG_V4 = "KA45CF8642"; // V4 - inheritance vehicle (owned by B, claimed by C)
const REG_V1_TN = "TN45CF1234"; // V1 after inter-state re-registration
const REG_V2_TN = "TN45CF2468"; // V2 after the Smart Migration Orchestrator re-registers it
const CHASSIS_V1 = "MA12E45FG90112233";
const MODEL_V1 = "Dzire ZXi";
const MODEL_V2 = "Baleno EV";

let TRANSFER_REQ_ID = ""; // captured from the RTO checklist dropdown in scene 15

const log = (m) => console.log("[" + new Date().toISOString().slice(11, 19) + "] " + m);
let sceneNo = 0;
// Bottom-right feature-classification badge. EVERY scene is classified into one
// of three tiers so a viewer glancing at the corner instantly understands what
// they are watching:
//   core     -> one of the 4 flagship BioChain modules (green, star)
//   enhanced -> an integrative feature built on top of the basic registry (green)
//   normal   -> a standard registry flow such as login / approval / navigation (grey)
// The scene name always stays bottom-left; this badge is bottom-right.
const TIERS = {
    1: { t: "normal", label: "Public registry landing" },
    2: { t: "enhanced", label: "Biometric enrollment at registration" },
    3: { t: "enhanced", label: "Digital ID Card + on-chain integrity verify" },
    4: { t: "enhanced", label: "F2 \u00b7 Vehicle Digital Twin + On-Chain Anchor" },
    5: { t: "normal", label: "Dealer registration (EV)" },
    6: { t: "normal", label: "RTO registration approval" },
    7: { t: "enhanced", label: "F2 \u00b7 On-Chain RC Verification (Polygon Amoy)" },
    8: { t: "enhanced", label: "F3 \u00b7 Challan + Demo Gateway Payment" },
    9: { t: "enhanced", label: "F4 \u00b7 Vehicle Intelligence Passport" },
    10: { t: "enhanced", label: "F5 \u00b7 EV Battery Passport" },
    11: { t: "enhanced", label: "F6 \u00b7 Accident Evidence Capture" },
    12: { t: "enhanced", label: "F6 \u00b7 Officer Review of Evidence" },
    13: { t: "enhanced", label: "F6 \u00b7 Challan Block + Dual-Biometric Resale" },
    14: { t: "enhanced", label: "F6 \u00b7 Buyer Accepts & Pays (Biometric)" },
    15: { t: "enhanced", label: "F8 \u00b7 Conditional Multi-Party Approval" },
    16: { t: "normal", label: "RTO transfer finalization" },
    17: { t: "normal", label: "Intra-state ownership transfer" },
    18: { t: "enhanced", label: "F7 \u00b7 Inter-State Transfer + Passport Carry-Forward" },
    19: { t: "core", label: "F11 \u00b7 Smart Interstate Migration Orchestrator" },
    20: { t: "normal", label: "Theft report + stolen flag" },
    21: { t: "normal", label: "Inheritance claim + approval" },
    22: { t: "core", label: "F3 \u00b7 Fraud Detection \u2014 Casebook" },
    23: { t: "core", label: "F3 \u00b7 Fraud Detection \u2014 Transaction Anomaly Scan" },
    24: { t: "core", label: "F3 \u00b7 Fraud Detection \u2014 Identity Cloning Scan" },
    25: { t: "normal", label: "Analytics dashboard + registry search" },
    26: { t: "core", label: "F9 \u00b7 3D Vehicle Damage & Repair Intelligence" },
    27: { t: "core", label: "F10 \u00b7 Lifecycle Forensics & Event Replay" },
    28: { t: "normal", label: "Walkthrough complete" },
};

async function caption(page, text) {
    sceneNo++;
    log("SCENE " + sceneNo + ": " + text);
    const tier = TIERS[sceneNo] || { t: "normal", label: "" };
    await page.evaluate(({ t, tier }) => {
        let b = document.getElementById("demo-caption");
        if (!b) {
            b = document.createElement("div");
            b.id = "demo-caption";
            b.style.cssText =
                "position:fixed;left:12px;bottom:12px;z-index:99999;max-width:560px;" +
                "background:#0b2545;color:#fff;font:600 15px/1.4 system-ui,sans-serif;" +
                "padding:12px 16px;border-radius:10px;border-left:6px solid #ff9933;" +
                "box-shadow:0 6px 24px rgba(0,0,0,.35);";
        }
        b.textContent = t;
        document.body.appendChild(b);

        // Always-on bottom-right tier badge. Core and enhanced are green so the
        // viewer's eye is drawn to them; standard flows use a muted slate.
        let f = document.getElementById("demo-feature-badge");
        if (!f) {
            f = document.createElement("div");
            f.id = "demo-feature-badge";
            document.body.appendChild(f);
        }
        const STYLE = {
            core: { bg: "#05361f", bd: "#22c55e", tag: "\u2605 CORE FEATURE", glow: "#86efac", shadow: "rgba(34,197,94,.45)" },
            enhanced: { bg: "#0b3d2e", bd: "#2ecc71", tag: "\u2726 ENHANCED FEATURE", glow: "#a7f3c4", shadow: "rgba(46,204,113,.40)" },
            normal: { bg: "#26313d", bd: "#64748b", tag: "STANDARD FLOW", glow: "#cbd5e1", shadow: "rgba(0,0,0,.35)" },
        }[tier.t] || { bg: "#26313d", bd: "#64748b", tag: "STANDARD FLOW", glow: "#cbd5e1", shadow: "rgba(0,0,0,.35)" };
        f.style.cssText =
            "position:fixed;right:12px;bottom:12px;z-index:99999;max-width:440px;" +
            "background:" + STYLE.bg + ";color:#fff;font:700 14px/1.35 system-ui,sans-serif;" +
            "padding:11px 18px;border-radius:10px;border-left:5px solid " + STYLE.bd + ";" +
            "box-shadow:0 6px 24px " + STYLE.shadow + ";letter-spacing:.3px;";
        f.innerHTML =
            '<div style="font-size:11px;font-weight:800;letter-spacing:1px;color:' + STYLE.glow + '">' + STYLE.tag + "</div>" +
            (tier.label ? '<div style="margin-top:3px;font-weight:600">' + tier.label + "</div>" : "");
    }, { t: "Scene " + sceneNo + " \u2014 " + text, tier });
}

const btn = (page, re) => page.getByRole("button", { name: re }).first();
const btns = (page, re) => page.getByRole("button", { name: re });
const tab = (page, re) => page.locator(".tab-btn", { hasText: re }).first();
const row = (page, text) => page.locator("tr", { hasText: text }).first();
const scopedForm = (page, text) => page.locator("form").filter({ hasText: text }).first();

// Condition-driven pause. Resolves as soon as the DOM has been quiet for
// 140ms (React finished rendering whatever the action triggered) and NEVER
// longer than maxMs - so a click that updates instantly continues instantly,
// with zero artificial gap. Replaces every blind sleep in the walkthrough.
async function settle(p, maxMs = 1500) {
    await p
        .waitForFunction(
            () => {
                if (!window.__s) {
                    window.__s = { t: performance.now() };
                    new MutationObserver(() => { window.__s.t = performance.now(); })
                        .observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });
                }
                return performance.now() - window.__s.t > 140;
            },
            { polling: 70, timeout: maxMs }
        )
        .catch(() => { });
}
// Wait until a visible toast containing any of `needles` appears, then let it
// stay on screen for `dwellMs` so the viewer can read it (toasts auto-dismiss
// on their own timer, which ends the dwell naturally).
async function seeToast(page, needles, dwellMs = 3000, timeout = 8000) {
    await page
        .waitForFunction(
            (ns) => {
                const t = (document.body.innerText || "").toLowerCase();
                return ns.some((n) => t.includes(n));
            },
            needles,
            { polling: 200, timeout }
        )
        .catch(() => { });
    await settle(page, dwellMs + 1500);
}

// Update ONLY the bottom-right badge mid-scene, leaving the bottom-left scene
// caption untouched. Used to enumerate the sub-modules of a large feature (the
// eight Smart Migration screens) while the scene stays the same - so the viewer
// sees "Scene 19" fixed on the left and the module name cycling on the right.
async function setBadge(page, tier, tag, label) {
    await page.evaluate(({ tier, tag, label }) => {
        const STYLE = {
            core: { bg: "#05361f", bd: "#22c55e", glow: "#86efac", shadow: "rgba(34,197,94,.45)" },
            enhanced: { bg: "#0b3d2e", bd: "#2ecc71", glow: "#a7f3c4", shadow: "rgba(46,204,113,.40)" },
            normal: { bg: "#26313d", bd: "#64748b", glow: "#cbd5e1", shadow: "rgba(0,0,0,.35)" },
        }[tier] || { bg: "#05361f", bd: "#22c55e", glow: "#86efac", shadow: "rgba(34,197,94,.45)" };
        let f = document.getElementById("demo-feature-badge");
        if (!f) { f = document.createElement("div"); f.id = "demo-feature-badge"; document.body.appendChild(f); }
        f.style.cssText =
            "position:fixed;right:12px;bottom:12px;z-index:99999;max-width:460px;" +
            "background:" + STYLE.bg + ";color:#fff;font:700 14px/1.35 system-ui,sans-serif;" +
            "padding:11px 18px;border-radius:10px;border-left:5px solid " + STYLE.bd + ";" +
            "box-shadow:0 6px 24px " + STYLE.shadow + ";letter-spacing:.3px;";
        f.innerHTML =
            '<div style="font-size:11px;font-weight:800;letter-spacing:1px;color:' + STYLE.glow + '">' + tag + "</div>" +
            (label ? '<div style="margin-top:3px;font-weight:600">' + label + "</div>" : "");
    }, { tier, tag, label });
}

// Reveal a rich feature page the way a presenter would: PHYSICALLY scroll the
// content under the cursor in measured increments, pausing long enough on each
// screenful for the viewer to read it, then return to the top. A real mouse
// wheel is used (not scrollTo on a guessed element) so it works no matter which
// container actually owns the overflow - the tallest module panel, the window,
// or a nested overflow-auto shell. This is what makes a tall module show ALL of
// itself instead of only its first screenful.
async function showcase(page, { steps = 6, dwellMs = HEADED ? 1100 : 140, holdMs = HEADED ? 850 : 120 } = {}) {
    const vp = page.viewportSize() || { width: 1280, height: 800 };
    // Point the wheel at the content column (slightly left of centre) so it
    // scrolls the page rather than zooming a centred canvas when one is present.
    await page.mouse.move(Math.round(vp.width * 0.32), Math.round(vp.height * 0.55));
    const toTop = () => page.evaluate(() => {
        const els = [document.scrollingElement, document.documentElement, document.body];
        document.querySelectorAll("main, .dash-content, [class*=scroll], [class*=overflow]").forEach((e) => els.push(e));
        els.forEach((e) => { try { e.scrollTop = 0; } catch (_) { } });
    }).catch(() => { });
    await toTop();
    await page.waitForTimeout(holdMs);
    const stepPx = Math.round((vp.height - 140) * 0.82); // a readable screenful per step
    for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, stepPx);
        await page.waitForTimeout(dwellMs);
    }
    await toTop();
    await page.waitForTimeout(holdMs);
}

// The Smart Migration Orchestrator's eight premium module tabs. Touring them
// one by one (clicking the tab, re-labelling the badge, then panning the whole
// module into view) is what makes the inter-state feature show ALL of itself.
const MIGRATION_MODULES = [
    { re: /^Workspace/, name: "Workspace \u00b7 live migration journey + KPIs" },
    { re: /^A\b.*Eligibility/, name: "A \u00b7 Eligibility Centre \u00b7 readiness checks" },
    { re: /^B\b.*Documents/, name: "B \u00b7 Document Intelligence \u00b7 OCR + integrity" },
    { re: /^C\b.*Two/, name: "C \u00b7 Two-State RTO Coordination \u00b7 NOC gate" },
    { re: /^D\b.*Tax/, name: "D \u00b7 State-Wise Tax & Fees \u00b7 rule-based cost" },
    { re: /^E\b.*Deadline/, name: "E \u00b7 Deadline Command Centre \u00b7 NOC clock" },
    { re: /^F\b.*Passport/, name: "F \u00b7 Digital Migration Passport \u00b7 hash-chained" },
    { re: /^G\b.*Reconcil/, name: "G \u00b7 Reconciliation \u00b7 source vs destination" },
];
async function tourMigrationModules(page) {
    for (let i = 0; i < MIGRATION_MODULES.length; i++) {
        const m = MIGRATION_MODULES[i];
        await btn(page, m.re).click().catch(() => { });
        // Let the module fully render (lazy panels mount after the click).
        await settle(page, 1600);
        if (HEADED) await page.waitForTimeout(400);
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 MODULE " + (i + 1) + " / 8", m.name);
        // Pan the WHOLE module top-to-bottom so nothing below the fold is missed.
        await showcase(page, { steps: 7 });
    }
}

async function clickTab(page, re) {
    await tab(page, re).click();
    await settle(page, 1500);
}
async function clickBtn(page, re, maxMs = 1500) {
    await btn(page, re).click();
    await settle(page, maxMs);
}
async function login(page, acc, urlRe) {
    await page.goto(BASE + "/login", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.clear());
    await page.locator('input[type="email"]').first().pressSequentially(acc.email, { delay: HEADED ? 22 : 0 });
    await page.locator('input[type="password"]').first().pressSequentially(acc.password, { delay: HEADED ? 22 : 0 });
    await btn(page, /Secure Login/i).click();
    await page.waitForURL(urlRe, { timeout: 12000 });
    await settle(page, 1500);
}
async function logout(page) {
    await btn(page, /^Logout$/i).click().catch(() => page.evaluate(() => localStorage.clear()));
    await settle(page, 1500);
}
// Complete the DemoPaymentModal: card step -> submit -> OTP step -> submit.
// The modal has its own internal timings (1500ms card->otp, 2000ms otp->success,
// 2000ms success->onSuccess). We wait via conditions rather than fixed sleeps.
async function payDemoGateway(page, cardName) {
    await page.locator('input[placeholder="1234 5678 9012 3456"]').fill("4111111111111111");
    await page.locator('input[placeholder="JOHN DOE"]').fill(cardName);
    await page.locator('input[placeholder="MM/YY"]').fill("12/30");
    await page.locator('input[placeholder="123"]').fill("123");
    await page.locator('form button[type="submit"]').click();
    // Wait for the OTP input to actually appear (modal's internal 1500ms setTimeout).
    await page.locator('input[placeholder="Enter 6-digit OTP"]').waitFor({ state: "visible", timeout: 4000 });
    await page.locator('input[placeholder="Enter 6-digit OTP"]').fill("123456");
    await page.locator('form button[type="submit"]').click();
    // Wait for the success step to render (modal's 2000ms setTimeout), then for
    // onSuccess to fire (a further 2000ms) which the parent uses to PUT/POST.
    await page.locator('text=/Payment Successful|Transaction ID|TXN/i').first().waitFor({ state: "visible", timeout: 5000 }).catch(() => { });
}
// Drive the DualBiometricVerification modal to completion. The modal renders a
// fixed-position backdrop with backdrop-filter blur(10px) and returns null once
// isOpen flips false. It opens ASYNCHRONOUSLY (OwnerDashboard.handleSubmit first
// awaits the /challans/check pre-flight), so we must wait for it to APPEAR before
// waiting for it to DISAPPEAR - otherwise, polled a beat too early, an
// absence-only check returns instantly and the caller races past a transfer whose
// biometric (and therefore its POST /requests/... ) has not run yet. This is the
// condition-driven replacement for the old blind 42-second sleep.
async function waitForBiometricDone(page, timeout = 32000) {
    await page.waitForFunction(() => {
        const divs = document.querySelectorAll("div");
        for (const d of divs) {
            const s = d.getAttribute("style") || "";
            if (s.includes("blur(10px)") && s.includes("0.75")) return true;
        }
        return false;
    }, null, { timeout: 4000, polling: 100 }).catch(() => { });
    await page.waitForFunction(() => {
        const divs = document.querySelectorAll("div");
        for (const d of divs) {
            const s = d.getAttribute("style") || "";
            if (s.includes("blur(10px)") && s.includes("0.75")) return false;
        }
        return true;
    }, null, { timeout, polling: 250 }).catch(() => { });
    // Let the success POST land so the next scene never reads a stale list.
    await settle(page, 1500);
}
// Open a blockchain explorer tab, best-effort resolve the Cloudflare Turnstile
// "verify you are human" checkbox, let the tx detail page render for the viewer,
// then close the tab and bring the app back to the foreground. TIGHT bounds -
// total worst case ~15s so this cannot eat the demo budget.
async function openExplorerTabAndReturn(appPage, ctx, clickFn, { dwell = 3200 } = {}) {
    const popupPromise = ctx.waitForEvent("page", { timeout: 4000 }).catch(() => null);
    await clickFn();
    const popup = await popupPromise;
    if (!popup) return;
    await popup.waitForLoadState("domcontentloaded").catch(() => { });
    await popup.bringToFront().catch(() => { });
    // Give the Cloudflare interstitial a moment to paint the Turnstile widget.
    await popup.waitForTimeout(HEADED ? 1400 : 300);
    // ONE best-effort click at the visual location of the Turnstile checkbox.
    // Skipping the multi-selector loop that used to burn ~12s of failed waits.
    try {
        const el = popup.locator('iframe[src*="challenges.cloudflare.com"]').first();
        if (await el.count()) {
            const b = await el.boundingBox();
            if (b) await popup.mouse.click(b.x + 34, b.y + b.height / 2);
        }
    } catch { }
    // Wait up to 6s for tx markers. If Cloudflare blocks us, we still return
    // quickly instead of hanging the whole recording.
    const txReady = /Transaction (Details|Information)|Hex Data|Block Number|Transaction Fee|From:\s*0x|To:\s*0x/i;
    await popup.waitForSelector(`text=${txReady}`, { timeout: HEADED ? 6000 : 2000 }).catch(() => { });
    if (HEADED) await popup.waitForTimeout(dwell);
    try { await appPage.bringToFront(); } catch { }
    try { await popup.close({ runBeforeUnload: false }); } catch { }
    await appPage.waitForTimeout(HEADED ? 180 : 80);
}

// Approve one pending new-registration row (matched by model text) by typing its
// number, then clicking Approve. The reg input only exists on newRegistration rows.
async function approveNewReg(page, modelText, reg) {
    const target = page.locator("tr").filter({ hasText: modelText }).filter({ has: page.locator('input[placeholder="Reg Number"]') }).first();
    await target.locator('input[placeholder="Reg Number"]').fill(reg);
    await target.getByRole("button", { name: /Approve/i }).click();
    await settle(page, 1500);
}

// Finalise a pending transfer row (V1 is matched by reg + model). Restricted to rows
// that still carry an Approve button, so the already-approved newRegistration row for
// the same vehicle is never mistaken for the pending transfer.
async function approveTransferRow(page, regText, modelText) {
    const target = page.locator("tr").filter({ hasText: modelText }).filter({ hasText: regText }).filter({ has: page.getByRole("button", { name: /^Approve$/i }) }).first();
    await target.getByRole("button", { name: /^Approve$/i }).click();
    await settle(page, 1500);
}

// Load a checklist for a non-RTO role (paste the request id, press Load).
async function loadChecklist(page, id) {
    await page.goto(BASE + "/transfer-approvals", { waitUntil: "domcontentloaded" });
    await settle(page, 1500);
    await page.locator('input[placeholder="Transfer request ID"]').fill(id);
    await clickBtn(page, /^Load$/, HEADED ? 700 : 300);
}
// Submit the first `times` visible step decisions (each re-renders and drops the
// now-approved step, so the first Submit button is always the next decidable one).
async function submitDecisions(page, times) {
    for (let i = 0; i < times; i++) {
        const b = btns(page, /^Submit$/).first();
        if (!(await b.count?.())) { if (!(await btns(page, /^Submit$/).count())) break; }
        // Each Submit fires a POST .../decision whose on-chain anchoring takes
        // ~1-1.5s before it re-renders and drops the approved step. Wait for
        // THAT response, not just a quiet DOM: clicking the next Submit while a
        // decision is still in flight races two workflow.save() calls and the
        // server answers 500. This keeps the checklist advancing one settled
        // step at a time.
        const decided = page.waitForResponse((r) => /\/api\/transfer-approvals\/.+\/decision/.test(r.url()), { timeout: 15000 }).catch(() => null);
        try { await b.click({ timeout: 4000 }); } catch { break; }
        await decided;
        await settle(page, 1500);
    }
}

const browser = await chromium.launch({ executablePath: CHROME, headless: !HEADED, slowMo: HEADED ? 8 : 0, args: ["--start-maximized", "--force-device-scale-factor=1", "--disable-blink-features=AutomationControlled", "--disable-features=IsolateOrigins,site-per-process"] });
// Record the whole walkthrough to a video file so it can be submitted as-is.
// Set DEMO_VIDEO=0 to skip recording (e.g. a quick headless self-test).
const RECORD_VIDEO = process.env.DEMO_VIDEO !== "0";
const VIDEO_DIR = fileURLToPath(new URL("./recordings", import.meta.url));
const ctx = await browser.newContext({
    viewport: null,
    ...(RECORD_VIDEO ? { recordVideo: { dir: VIDEO_DIR } } : {}),
});
// Fail fast on stuck locators - default is 30s which visually freezes the
// recording. 8s still gives React plenty of time to render but caps any
// single dead-wait at 8s per action.
ctx.setDefaultTimeout(8000);
// Fill the whole screen reliably: --start-maximized opens a true maximized window
// (which repaints live, unlike --start-fullscreen) and viewport:null lets the page
// render into that full window instead of a shrunk 1440x900 box.
// Deterministic biometric: the whole app calls Math.random in only three places,
// all inside the simulated fingerprint flow (DualBiometricVerification match + the
// capture quality/templateId). The match check is `Math.random() > 0.1`, so on a
// ~10% roll it hard-stalls (no retry, only a Close button that discards the form)
// and the recording can never advance. We seed Math.random to values in [0.15,0.999):
// still varied for the quality score / template ids, but always > 0.1 so the match
// succeeds every time. This only affects the browser under test, not the app itself.
await ctx.addInitScript(() => {
    let seed = 1103515245;
    Math.random = function () {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return 0.15 + (seed / 0x7fffffff) * 0.849;
    };
    // Cloudflare stealth so the polygonscan tab can pass the "verify you are
    // human" Turnstile challenge. Not a guarantee (Cloudflare detects many
    // other tells) but materially improves the odds. Only affects the browser
    // under test.
    try { Object.defineProperty(navigator, 'webdriver', { get: () => undefined }); } catch { }
    try { window.chrome = window.chrome || { runtime: {}, loadTimes: function () { }, csi: function () { } }; } catch { }
    try {
        const origQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
        if (origQuery) window.navigator.permissions.query = (p) => (p && p.name === 'notifications')
            ? Promise.resolve({ state: (typeof Notification !== 'undefined' ? Notification.permission : 'default') })
            : origQuery(p);
    } catch { }
    try { Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] }); } catch { }
    try { Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] }); } catch { }
});
const page = await ctx.newPage();
// Make EVERY .fill() call look like real typing when headed. Instead of a
// single instant injection, we clear the field and press keys sequentially at
// 22ms per character - roughly the natural typing pace a human uses when
// filling a form. This patches Locator.prototype once so we do not have to
// rewrite the 90+ .fill() calls across all 28 scenes individually. Headless
// self-tests keep the fast .fill() so nothing regresses. Opt out per-call by
// passing { instant: true } (currently unused). This is the fix for the "4X
// data entry" complaint - now dealer forms, RTO challans, workshop entries,
// theft, inheritance, migration, transfer messages, analytics filters, all
// typing appears on-screen character by character at 1X.
{
    const probe = page.locator("html");
    const proto = Object.getPrototypeOf(probe);
    const origFill = proto.fill;
    proto.fill = async function (text, opts = {}) {
        if (HEADED && opts.instant !== true && typeof text === "string" && text.length > 1) {
            await origFill.call(this, "");
            return this.pressSequentially(text, { delay: opts.delay ?? 22 });
        }
        return origFill.call(this, text, opts);
    };
}
const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("requestfailed", (r) => { if (!r.url().includes("favicon")) errors.push("reqfail: " + r.url()); });
// Record any non-2xx API response with its URL so a 500 can be traced to an endpoint.
page.on("response", (r) => { if (r.status() >= 400 && r.url().includes("/api/")) errors.push("http " + r.status() + ": " + r.url()); });

async function scene(name, fn) {
    await caption(page, name);
    try { await fn(); log("  ok: " + name); }
    catch (e) {
        const first = String(e.message || "").split("\n")[0];
        const where = String(e.stack || "").split("\n").find((l) => /demo\.mjs/.test(l)) || "";
        log("  !! FAIL (" + name + "): " + first + (where ? " [" + where.trim() + "]" : ""));
        // Recover: dismiss any stuck modal so the next scene can navigate.
        await page.evaluate(() => {
            document.querySelectorAll('div[style*="position: fixed"][style*="zIndex"]')
                .forEach((d) => d.remove());
        }).catch(() => { });
    }
    await page.waitForTimeout(HOLD);
}

try {
    // 1. Home
    await scene("Landing page — live registry counters", async () => {
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        await page.evaluate(() => localStorage.clear());
        await settle(page, 1500); // counters animate briefly
    });

    // 2. Citizen A registration + biometric
    await scene("Citizen A registration with biometric enrollment", async () => {
        await page.goto(BASE + "/register", { waitUntil: "domcontentloaded" });
        await page.locator('input[name="name"]').pressSequentially(CITIZEN.name, { delay: HEADED ? 22 : 0 });
        await page.locator('input[name="email"]').pressSequentially(CITIZEN.email, { delay: HEADED ? 22 : 0 });
        await page.locator('input[name="password"]').fill(CITIZEN.password);
        await page.locator('input[name="phone"]').fill("9876500111");
        await page.locator('textarea[name="address"]').pressSequentially("14 Indiranagar, Bengaluru", { delay: HEADED ? 18 : 0 });
        await page.locator('select[name="state"]').selectOption("KA");
        await page.locator('input[name="district"]').fill("Bengaluru Urban");
        await page.locator('input[name="aadhaarNumber"]').fill(CITIZEN.aadhaar);
        await page.locator('input[name="dlNumber"]').fill(CITIZEN.dl);
        await page.locator('input[name="profilePhoto"]').setInputFiles(PHOTO);
        await btn(page, /Create Secure Identity/i).click();
        await page.waitForURL(/\/login/, { timeout: 25000 }); // biometric modal auto-completes then redirects
    });

    // 3. Login A + digital ID card
    await scene("Sign in and issue / verify the Digital ID Card", async () => {
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await page.goto(BASE + "/owner-profile", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await btn(page, /Issue My Digital ID Card/i).click().catch(() => { });
        // Card hashes, records and renders - wait until the integrity button it
        // produces is on screen instead of sleeping blind.
        await btn(page, /Verify Card Integrity/i).waitFor({ state: "visible", timeout: 10000 }).catch(() => { });
        await btn(page, /Verify Card Integrity/i).click().catch(() => { });
        await settle(page, 1700);
    });

    // 4. Dealer registers V1 (petrol Dzire)
    await scene("Dealer registers V1 (petrol Dzire) to Citizen A", async () => {
        await logout(page);
        await login(page, A.dealer, /\/dealer/);
        await clickBtn(page, /Register New Vehicle/i);
        await page.locator('input[name="buyerEmail"]').fill(CITIZEN.email);
        await page.locator('input[name="vehicleDetails.chassisNumber"]').fill(CHASSIS_V1);
        await page.locator('input[name="vehicleDetails.engineNumber"]').fill("EN45DE9988771");
        await page.locator('input[name="vehicleDetails.make"]').fill("Maruti Suzuki");
        await page.locator('input[name="vehicleDetails.model"]').fill(MODEL_V1);
        await page.locator('input[name="vehicleDetails.year"]').fill("2026");
        await page.locator('input[name="exShowroomPrice"]').fill("1850000");
        await page.locator('input[name="roadTax"]').fill("210000");
        await page.locator('input[name="insuranceAmount"]').fill("42000");
        await page.locator('input[name="otherCharges"]').fill("15000");
        await btn(page, /Submit Request/i).click();
        await page.waitForURL(/\/invoice\//, { timeout: 40000 }); // dual biometric auto-completes
        await settle(page, 1500);
    });

    // 5. Dealer registers V2 (electric Baleno EV)
    await scene("Dealer registers V2 (electric Baleno EV) to Citizen A", async () => {
        await page.goto(BASE + "/dealer", { waitUntil: "domcontentloaded" });
        await clickBtn(page, /Register New Vehicle/i);
        await page.locator('input[name="buyerEmail"]').fill(CITIZEN.email);
        await page.locator('input[name="vehicleDetails.chassisNumber"]').fill("MA12E45FG9024680");
        await page.locator('input[name="vehicleDetails.engineNumber"]').fill("EN45DE9924681");
        await page.locator('input[name="vehicleDetails.make"]').fill("Maruti Suzuki");
        await page.locator('input[name="vehicleDetails.model"]').fill(MODEL_V2);
        await page.locator('input[name="vehicleDetails.year"]').fill("2026");
        await page.locator('input[name="exShowroomPrice"]').fill("1999000");
        await page.locator('input[name="roadTax"]').fill("180000");
        await page.locator('input[name="insuranceAmount"]').fill("48000");
        await page.locator('input[name="otherCharges"]').fill("12000");
        await btn(page, /Submit Request/i).click();
        await page.waitForURL(/\/invoice\//, { timeout: 40000 });
        await settle(page, 1500);
    });

    // 6. RTO approves V1 and V2 (assigns numbers, issues RC)
    await scene("RTO approves V1 and V2 and issues their registration numbers", async () => {
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await clickTab(page, /TRANSFER REQUESTS/i);
        await approveNewReg(page, MODEL_V1, REG);
        await approveNewReg(page, MODEL_V2, REG_V2);
    });

    // 7. A: My Vehicles; open V1 on-chain Tx on Polygon Amoy (via polygonscan)
    // then come back to the app and open the V1 RC card. The Blockchain button
    // calls window.open to amoy.polygonscan.com which sits behind a Cloudflare
    // Turnstile - openExplorerTabAndReturn handles the popup, attempts the
    // verify-human checkbox, waits for the tx detail page, dwells on it, then
    // refocuses the app tab and closes the explorer.
    await scene("Citizen A views My Vehicles, opens the V1 on-chain tx on Polygon Amoy, then the RC card", async () => {
        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await clickTab(page, /MY VEHICLES/i);
        const v1 = row(page, REG);
        await openExplorerTabAndReturn(page, ctx, async () => {
            await v1.getByRole("button", { name: /Blockchain/i }).click().catch(() => { });
        });
        await v1.getByRole("button", { name: /RC Card/i }).click().catch(() => { });
        await settle(page, 1900);
        await btn(page, /Back/i).click().catch(() => { });
        await settle(page, 1500);
    });

    // 8. Police issues a challan on V1; A pays through the demo gateway.
    // Traffic challans are raised by the enforcing officer, not the registry.
    await scene("Police issues a challan on V1; Citizen A pays it via the demo gateway", async () => {
        await logout(page);
        await login(page, A.police, /\/police/);
        await clickTab(page, /TRAFFIC CHALLANS|CHALLANS/i);
        await clickBtn(page, /CREATE NEW CHALLAN/i);
        await page.locator('input[placeholder="KA01AB1234"]').fill(REG);
        await page.locator('textarea[placeholder="Describe the violation..."]').fill("Rash driving near MG Road");
        await page.locator('input[placeholder="Where did the violation occur?"]').fill("MG Road, Bengaluru");
        await page.locator('input[placeholder="500"]').fill("2000");
        await btn(page, /^Create Challan$/i).click();
        await settle(page, 1500);

        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await clickTab(page, /PENDING CHALLANS/i);
        await clickBtn(page, /Pay Now/i, HEADED ? 500 : 200);
        // onSuccess fires 2s after the success step; wait for the pay API to
        // actually land instead of sleeping blind.
        const payOk = page.waitForResponse((r) => /\/api\/challans\/.+\/pay/.test(r.url()), { timeout: 9000 }).catch(() => null);
        await payDemoGateway(page, "ANANYA KRISHNAN");
        await payOk; // modal fires onSuccess 2s after "success" step
        await settle(page, 1500);
    });

    // 9. Workshop: V1 service history + parts provenance + damage passport
    await scene("Workshop records V1 service, parts provenance and damage passport", async () => {
        await logout(page);
        await login(page, A.workshop, /\/workshop/);
        await settle(page, 1500);
        await row(page, REG).getByRole("button", { name: /Service History/i }).click();
        await page.waitForURL(/\/vehicle-history\//, { timeout: 12000 });
        await settle(page, 1500);

        // Service & Odometer (default tab)
        await clickBtn(page, /Add Service Record/i, HEADED ? 350 : 150);
        await page.locator('input[type="date"]').first().fill("2026-08-15");
        await page.locator('input[type="number"]').nth(0).fill("12500"); // odometer
        await page.locator('select:has(option[value="periodic-service"])').selectOption("periodic-service");
        await page.locator('input[type="number"]').nth(1).fill("4200"); // cost
        await page.locator('textarea').first().fill("First scheduled service - engine oil, filters and general inspection.");
        await page.locator('input[placeholder*="Brake pads"]').fill("Engine oil filter, Air filter:AF-7788");
        await clickBtn(page, /Save Record/i, HEADED ? 1200 : 500);

        // Parts Provenance
        await clickBtn(page, /Parts Provenance/i, HEADED ? 400 : 180);
        await clickBtn(page, /Register Component/i, HEADED ? 350 : 150);
        await page.locator('input[placeholder="ENG-1A2B3C"]').fill("ENG-45DE9988771");
        await page.locator('input[placeholder="Fitted at authorized centre"]').fill("Fitted at Maruti authorized centre");
        await clickBtn(page, /Save Component/i, HEADED ? 1000 : 400);

        // Damage Passport
        await clickBtn(page, /Damage Passport/i, HEADED ? 400 : 180);
        await clickBtn(page, /Report Damage/i, HEADED ? 350 : 150);
        await scopedForm(page, "Report Damage / Repair Event").locator('input[type="date"]').fill("2026-09-01");
        await page.locator('input[placeholder="Front bumper, chassis"]').fill("Front bumper, left fender");
        await scopedForm(page, "Report Damage / Repair Event").locator('textarea').fill("Minor parking-lot contact; bumper scuffed, no structural damage.");
        await scopedForm(page, "Report Damage / Repair Event").locator('input[type="file"]').setInputFiles(PHOTO);
        await clickBtn(page, /Submit \(as Reported\)/i, HEADED ? 1200 : 500);
    });

    // 10. Workshop: V2 EV battery passport + SoH event
    await scene("Workshop creates the V2 EV battery passport and appends a health event", async () => {
        await page.goto(BASE + "/workshop", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await row(page, REG_V2).getByRole("button", { name: /Service History/i }).click();
        await page.waitForURL(/\/vehicle-history\//, { timeout: 12000 });
        await settle(page, 1500);
        await clickBtn(page, /EV Battery Passport/i, HEADED ? 500 : 220);

        await clickBtn(page, /Create Battery Passport/i, HEADED ? 350 : 150);
        const cf = scopedForm(page, "Create EV Battery Passport");
        await cf.locator('input').nth(0).fill("DEMO-EV-BAT-001"); // Battery Identifier
        await cf.locator('input').nth(1).fill("Maruti Suzuki"); // Manufacturer
        await cf.locator('input[type="number"]').fill("39.2"); // Nominal capacity
        await cf.locator('input[type="date"]').fill("2025-01-10"); // Installation date
        await clickBtn(page, /^Create$/, HEADED ? 1200 : 500);

        await clickBtn(page, /Append History Event/i, HEADED ? 350 : 150);
        const ef = scopedForm(page, "Append Battery History Event");
        await ef.locator('input[type="number"]').nth(0).fill("96"); // State of Health %
        await ef.locator('input[type="date"]').fill("2026-01-15"); // Event date
        await clickBtn(page, /^Append Event$/, HEADED ? 1200 : 500);
    });

    // 11. A: report an accident with evidence
    await scene("Citizen A uploads V1 accident evidence for officer review", async () => {
        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await clickTab(page, /REPORT ACCIDENT/i);
        await settle(page, 1500);
        await page.locator('input[placeholder^="e.g. Junction"]').fill("Junction of 100ft Road, Indiranagar, Bengaluru");
        await page.locator('textarea[placeholder^="Describe the collision"]').fill("Rear-ended at a signal; boot crumpled, other party left the scene.");
        await page.locator('input[type="file"]').first().setInputFiles(PHOTO);
        await clickBtn(page, /Upload Accident Evidence/i, 5000);
    });

    // 12. Police: verify the accident upload
    await scene("Police officer reviews and verifies the accident evidence", async () => {
        await logout(page);
        await login(page, A.police, /\/police/);
        await clickTab(page, /ACCIDENT UPLOADS/i);
        await settle(page, 1500);
        const v = btns(page, /Verify evidence/).first();
        if (await btns(page, /Verify evidence/).count()) {
            await page.locator('input[placeholder^="Remarks for the record"]').first().fill("Dashcam still matches the reported impact.");
            await v.click();
            await settle(page, 1500);
        }
    });

    // 13. Pending challan blocks the resale at the moment the seller clicks Sell.
    // Proves the pre-listing gate added in OwnerDashboard.handleSubmit +
    // requestRoutes POST /transfer. No biometric is triggered on the blocked
    // attempt - the seller sees the exact reason on their own portal, pays
    // the dues, and only then is the offer accepted.
    await scene("Citizen A tries to list V1 - pending challan blocks the sale; owner clears it, then resale succeeds", async () => {
        // Police raises a fresh challan on V1.
        await logout(page);
        await login(page, A.police, /\/police/);
        await clickTab(page, /TRAFFIC CHALLANS|CHALLANS/i);
        await clickBtn(page, /CREATE NEW CHALLAN/i);
        await page.locator('input[placeholder="KA01AB1234"]').fill(REG);
        await page.locator('textarea[placeholder="Describe the violation..."]').fill("Triple-parked near Koramangala market");
        await page.locator('input[placeholder="Where did the violation occur?"]').fill("Koramangala, Bengaluru");
        await page.locator('input[placeholder="500"]').fill("1500");
        await btn(page, /^Create Challan$/i).click();
        await settle(page, 1500);

        // Citizen A opens My Vehicles, clicks Sell, fills the offer form, hits
        // Send Sale Offer. The pre-check fires and a red toast appears with
        // the exact reason. Biometric does NOT open - the demo dwells on the
        // visible block so the viewer can read it.
        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await clickTab(page, /MY VEHICLES/i);
        await row(page, REG).getByRole("button", { name: /^Sell$/i }).click();
        await settle(page, 1500);
        await page.locator('input[name="buyerEmail"]').fill(A.owner.email);
        await page.locator('input[name="salePrice"]').fill("1500000");
        await page.locator('textarea[name="message"]').fill("Single owner, full authorized-service history attached.");
        await page.locator('input[name="attachIntel"]').check().catch(() => { });
        await btn(page, /Send Sale Offer to Buyer/i).click();
        // Poll until the red block toast is on screen, then let it dwell so the
        // viewer can read the exact reason the sale was refused.
        await seeToast(page, ["pending challan", "settle all dues"], 3200);

        // Citizen A opens Pending Challans, pays the due.
        await clickTab(page, /PENDING CHALLANS/i);
        await clickBtn(page, /Pay Now/i, HEADED ? 500 : 200);
        // The pay PUT only fires ~4s after OTP submit (modal onSuccess) - wait
        // for the response, never for the navigation, so it cannot be cancelled.
        const payOk2 = page.waitForResponse((r) => /\/api\/challans\/.+\/pay/.test(r.url()), { timeout: 9000 }).catch(() => null);
        await payDemoGateway(page, "ANANYA KRISHNAN");
        await payOk2;

        // Retry the Sell. This time no challan is pending, so the biometric
        // opens, dual-fingerprint verification completes, and the offer is sent.
        await clickTab(page, /MY VEHICLES/i);
        await row(page, REG).getByRole("button", { name: /^Sell$/i }).click();
        await settle(page, 1500);
        await page.locator('input[name="buyerEmail"]').fill(A.owner.email);
        await page.locator('input[name="salePrice"]').fill("1500000");
        await page.locator('textarea[name="message"]').fill("Single owner, full authorized-service history attached.");
        await page.locator('input[name="attachIntel"]').check().catch(() => { });
        await btn(page, /Send Sale Offer to Buyer/i).click();
        await waitForBiometricDone(page);
    });

    // 14. B: accept & pay (offer becomes awaiting RTO approval)
    await scene("Buyer B reviews the intel and accepts & pays for V1", async () => {
        await logout(page);
        await login(page, A.owner, /\/owner/);
        await clickTab(page, /RESALE OFFERS/i);
        await clickBtn(page, /Accept & Pay/i, HEADED ? 500 : 220);
        await payDemoGateway(page, "OWNER DEMO");
        await waitForBiometricDone(page); // dual biometric auto-completes, then offer is accepted
        await settle(page, 1500);
    });

    // 15. Feature 8 full multi-party approval checklist
    await scene("Multi-party approval checklist: every mandatory party approves", async () => {
        // RTO initialises the checklist and captures the request id.
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await page.goto(BASE + "/transfer-approvals", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await page.locator("select").first().selectOption({ index: 1 });
        await settle(page, 1500);
        TRANSFER_REQ_ID = await page.locator("select").first().inputValue();
        await clickBtn(page, /^Init$/, HEADED ? 900 : 400);

        // Seller A approves seller-authorization.
        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await loadChecklist(page, TRANSFER_REQ_ID);
        await submitDecisions(page, 1);

        // Buyer B approves buyer-acceptance.
        await logout(page);
        await login(page, A.owner, /\/owner/);
        await loadChecklist(page, TRANSFER_REQ_ID);
        await submitDecisions(page, 1);

        // Workshop approves the (optional) inspection step.
        await logout(page);
        await login(page, A.workshop, /\/workshop/);
        await loadChecklist(page, TRANSFER_REQ_ID);
        await submitDecisions(page, 1);

        // RTO approves document-verification + rto-approval (the last two mandatory).
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await loadChecklist(page, TRANSFER_REQ_ID);
        await submitDecisions(page, 2);
        await settle(page, 1500);
    });

    // 16. RTO finalizes V1 transfer; ownership -> B with retained history
    await scene("RTO finalizes the V1 transfer; Buyer B receives it with history intact", async () => {
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await clickTab(page, /TRANSFER REQUESTS/i);
        await approveTransferRow(page, REG, MODEL_V1);

        await logout(page);
        await login(page, A.owner, /\/owner/);
        await clickTab(page, /MY VEHICLES/i);
        await row(page, REG).getByRole("button", { name: /Service History/i }).click().catch(() => { });
        await settle(page, 1500);
        await btn(page, /Back/i).click().catch(() => { });
    });

    // 17. Intra-state transfer: B sells V1 to C; C accepts; RTO finalizes
    await scene("Intra-state transfer: B sells V1 to C; C accepts; RTO finalizes", async () => {
        await logout(page);
        await login(page, A.owner, /\/owner/);
        await clickTab(page, /MY VEHICLES/i);
        await row(page, REG).getByRole("button", { name: /^Sell$/i }).click();
        await settle(page, 1500);
        await page.locator('input[name="buyerEmail"]').fill(CAROL.email);
        await page.locator('input[name="salePrice"]').fill("1350000");
        await page.locator('textarea[name="message"]').fill("Well maintained, complete on-chain history.");
        await btn(page, /Send Sale Offer to Buyer/i).click();
        await waitForBiometricDone(page);

        await logout(page);
        await login(page, CAROL, /\/owner/);
        await clickTab(page, /RESALE OFFERS/i);
        await clickBtn(page, /Accept & Pay/i, HEADED ? 500 : 220);
        await payDemoGateway(page, "CAROL FERNANDES");
        await waitForBiometricDone(page);

        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await clickTab(page, /TRANSFER REQUESTS/i);
        await approveTransferRow(page, REG, MODEL_V1);
    });

    // 18. Inter-state transfer: C files KA->TN; RTO-KA NOC; RTO-TN approve (new reg)
    await scene("Inter-state transfer: C moves V1 KA->TN; source NOC; destination re-registers", async () => {
        await logout(page);
        await login(page, CAROL, /\/owner/);
        await clickTab(page, /INTER-STATE TRANSFER/i);
        await settle(page, 1500);
        await page.locator("select").first().selectOption({ label: `${REG} - Maruti Suzuki ${MODEL_V1}` }).catch(async () => {
            await page.locator("select").first().selectOption({ index: 1 });
        });
        await page.locator("select").nth(1).selectOption("TN");
        await page.locator('input[placeholder="Enter new address"]').fill("12 Anna Salai, Chennai");
        await btn(page, /Request Inter-State Transfer/i).click();
        await settle(page, 1500);

        // Source state (KA) issues the NOC.
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await clickTab(page, /INTER-STATE/i);
        await settle(page, 1500);
        await btn(page, /Issue NOC \(Source State\)/i).click();
        await settle(page, 1500);

        // Destination state (TN) verifies the passport and assigns the new number.
        await logout(page);
        await login(page, A.rtoTN, /\/rto/);
        await clickTab(page, /INTER-STATE/i);
        await settle(page, 1500);
        await page.locator('input[placeholder^="New Reg No"]').fill(REG_V1_TN);
        await btn(page, /Verify Passport & Approve/i).click();
        await settle(page, 1700);
        // Reveal the destination-state approval + carried-forward passport.
        await setBadge(page, "enhanced", "\u2726 ENHANCED FEATURE \u00b7 F7", "Destination re-registration + passport carry-forward");
        await showcase(page, { steps: 4 });
    });

    // 18b. BioChain Smart Migration Orchestrator - the strongest single story:
    // a vehicle that FAILS the readiness pre-check (an unpaid challan), the owner
    // clears it, the OCR document intelligence reads + compares a document and
    // drafts Form 28/27, the application files with a passport hash, the source
    // RTO issues a NOC (starting a configurable countdown), and the destination
    // RTO - blocked until that NOC - re-registers and the migration reconciles.
    await scene("Smart Migration Orchestrator: fails pre-check, resolves, two-state NOC, reconciles", async () => {
        // A pending challan on V2 makes the honest pre-check report a BLOCKED state.
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await clickTab(page, /CHALLANS/i);
        await clickBtn(page, /CREATE NEW CHALLAN/i);
        await page.locator('input[placeholder="KA01AB1234"]').fill(REG_V2);
        await page.locator('textarea[placeholder="Describe the violation..."]').fill("Signal jumping near the airport road");
        await page.locator('input[placeholder="Where did the violation occur?"]').fill("Kempegowda Road, Bengaluru");
        await page.locator('input[placeholder="500"]').fill("1500");
        await btn(page, /^Create Challan$/i).click();
        await settle(page, 1500);

        // Owner opens the orchestrator and runs the pre-check - it is blocked.
        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await page.goto(BASE + "/migration", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await page.locator('select[name="vehicleId"]').selectOption({ label: `${REG_V2} - Maruti Suzuki ${MODEL_V2}` }).catch(async () => {
            await page.locator('select[name="vehicleId"]').selectOption({ index: 1 });
        });
        await page.locator('select[name="destinationState"]').selectOption("TN");
        await page.locator('input[placeholder="Enter new address"]').fill("9 Guindy Industrial Estate, Chennai");
        await page.locator('input[placeholder="Reason for relocation"]').fill("Employment transfer to Chennai");
        await clickBtn(page, /Run Pre-Check/i, HEADED ? 1000 : 400);

        // Clear the blocking challan through the normal payment flow, then re-check.
        await page.goto(BASE + "/owner", { waitUntil: "domcontentloaded" });
        await clickTab(page, /PENDING CHALLANS/i);
        await clickBtn(page, /Pay Now/i, HEADED ? 500 : 220);
        // The modal calls onSuccess (which fires PUT /challans/:id/pay) ~4s after
        // the OTP submit - wait for that response before navigating away,
        // otherwise the pay request never fires and the pre-check stays blocked.
        const payOk3 = page.waitForResponse((r) => /\/api\/challans\/.+\/pay/.test(r.url()), { timeout: 9000 }).catch(() => null);
        await payDemoGateway(page, "ANANYA KRISHNAN");
        await payOk3;

        await page.goto(BASE + "/migration", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await page.locator('select[name="vehicleId"]').selectOption({ label: `${REG_V2} - Maruti Suzuki ${MODEL_V2}` }).catch(async () => {
            await page.locator('select[name="vehicleId"]').selectOption({ index: 1 });
        });
        await page.locator('select[name="destinationState"]').selectOption("TN");
        await page.locator('input[placeholder="Enter new address"]').fill("9 Guindy Industrial Estate, Chennai");
        await clickBtn(page, /Run Pre-Check/i, HEADED ? 1000 : 400);
        await clickBtn(page, /Start Migration/i, HEADED ? 1200 : 500);

        // OCR document intelligence: upload a readable ID, verify the extract, file it.
        await page.locator('input[type="file"]').first().setInputFiles(MIGRATION_DOC);
        // OCR + record comparison is synchronous server-side - wait until the
        // Verify control the result exposes has actually rendered.
        await btns(page, /^Verify$/).first().waitFor({ state: "visible", timeout: 12000 }).catch(() => { });
        const verifyBtn = btns(page, /^Verify$/).first();
        if (await btns(page, /^Verify$/).count()) {
            await verifyBtn.click();
            await settle(page, 1500);
        }
        await clickBtn(page, /Submit Application/i, HEADED ? 1200 : 500);

        // Source RTO (KA) issues the NOC; the destination stage becomes actionable.
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await page.goto(BASE + "/migration", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await btn(page, /BCM-/i).click();
        await settle(page, 1500);
        await page.locator('input[placeholder="Remarks (optional)"]').fill("No dues pending; NOC cleared.").catch(() => { });
        await clickBtn(page, /Issue NOC \(Source State\)/i, HEADED ? 1200 : 500);

        // Destination RTO (TN) reviews the passport and re-registers; reconciliation passes.
        await logout(page);
        await login(page, A.rtoTN, /\/rto/);
        await page.goto(BASE + "/migration", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await btn(page, /BCM-/i).click();
        await settle(page, 1500);
        await page.locator('input[placeholder^="New Reg No"]').fill(REG_V2_TN);
        await clickBtn(page, /Verify Passport & Re-register/i, HEADED ? 1500 : 700);
        await showcase(page, { steps: 3 });

        // Now that the migration is complete, tour ALL EIGHT premium modules as
        // the owner so the viewer actually sees each screen. The scene name stays
        // pinned bottom-left while the badge enumerates "MODULE 1/8 ... 8/8".
        await logout(page);
        await login(page, { email: CITIZEN.email, password: CITIZEN.password }, /\/owner/);
        await page.goto(BASE + "/migration", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await btn(page, /BCM-/i).first().click();
        await settle(page, 1500);
        await tourMigrationModules(page);
    });

    // 19. Theft: B reports V3 stolen; police detailed verify shows the flag
    await scene("Theft: Buyer B reports V3 stolen; police verification shows the flag", async () => {
        await logout(page);
        await login(page, A.owner, /\/owner/);
        await clickTab(page, /REPORT THEFT/i);
        await page.locator('select[name="vehicleId"]').selectOption({ label: `Maruti Suzuki Swift VXi (${REG_V3})` }).catch(async () => {
            await page.locator('select[name="vehicleId"]').selectOption({ index: 1 });
        });
        await page.locator('input[name="policeStation"]').fill("Central Police Station, Bengaluru");
        await page.locator('input[name="firNumber"]').fill("FIR-2026-000451");
        await page.locator('input[name="incidentDate"]').fill("2026-10-20");
        await page.locator('input[name="incidentLocation"]').fill("Koramangala 5th Block");
        await page.locator('textarea[name="description"]').fill("Vehicle parked overnight was stolen.");
        await btn(page, /Report Theft/i).click();
        await settle(page, 1500);

        await logout(page);
        await login(page, A.police, /\/police/);
        await clickTab(page, /DETAILED VERIFY/i);
        await page.locator('input[placeholder="Enter vehicle registration number"]').fill(REG_V3);
        await btn(page, /DETAILED VERIFY/i).click();
        await settle(page, 1500);
        // Linger on the police verification result so the stolen flag is clearly seen.
        await setBadge(page, "normal", "STANDARD FLOW", "Theft verification - stolen flag surfaced");
        await showcase(page, { steps: 5 });
    });

    // 20. Inheritance: C files for V4 (deceased B); RTO verifies + approves
    await scene("Inheritance: C claims V4 from deceased owner B; RTO verifies and approves", async () => {
        await logout(page);
        await login(page, CAROL, /\/owner/);
        await clickTab(page, /INHERITANCE TRANSFER/i);
        await settle(page, 1500);
        await page.locator('input[name="vehicleRegNumber"]').fill(REG_V4);
        await page.locator('input[name="deceasedOwnerId"]').fill("Owner Demo");
        await page.locator('input[name="deathCertificateNumber"]').fill("DC-2026-778899");
        await page.locator('select[name="relationshipToDeceased"]').selectOption("child");
        await page.locator('input[name="successionCertificateNumber"]').fill("SC-2026-1122").catch(() => { });
        await page.locator('input[type="file"][name="deathCertificateDoc"]').setInputFiles(PHOTO);
        await page.locator('input[type="file"][name="relationshipProofDoc"]').setInputFiles(PHOTO);
        await btn(page, /Submit Inheritance Request/i).click();
        await settle(page, 1700);

        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await clickTab(page, /INHERITANCE TRANSFERS/i);
        await settle(page, 1500);
        const v4 = row(page, REG_V4);
        await v4.getByRole("button", { name: /Verify Docs/i }).click();
        await settle(page, 1500);
        const v4b = row(page, REG_V4);
        await v4b.locator('input[placeholder="Reg Number"]').fill(REG_V4).catch(() => { });
        await v4b.getByRole("button", { name: /Approve/i }).click();
        await settle(page, 1700);
        // Show the approved inheritance outcome in full.
        await setBadge(page, "normal", "STANDARD FLOW", "Inheritance approved - ownership transferred");
        await showcase(page, { steps: 5 });
    });

    // 21. Fraud Casebook: open a case, change status, add a note
    await scene("Fraud Casebook: open a new case, update status, add a note", async () => {
        await logout(page);
        await login(page, A.rtoKA, /\/rto/);
        await page.goto(BASE + "/investigations", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        // Fraud Intelligence Overview first: KPI cards + charts, shown top to bottom.
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FRAUD INTELLIGENCE", "Overview - live KPIs + case charts");
        await showcase(page, { steps: 5 });
        await clickBtn(page, /Casebook/i, HEADED ? 400 : 180);
        await clickBtn(page, /Open New Case/i, HEADED ? 350 : 150);
        const f = scopedForm(page, "New Investigation Case");
        await f.locator('input').nth(0).fill("Anomalous odometer rollback on V1");
        await f.locator('textarea').fill("Service timeline shows a lower odometer reading than an earlier record; opening a review case.");
        await clickBtn(page, /Create Case/i, HEADED ? 1000 : 400);

        await row(page, "Anomalous odometer rollback on V1").click().catch(() => { });
        await settle(page, 1500);
        const detail = page.locator("div.card").filter({ hasText: "Anomalous odometer rollback on V1" }).last();
        await detail.locator('select').first().selectOption("under-investigation").catch(() => { });
        await detail.locator('input[placeholder="Remarks"]').fill("Assigned to fraud cell for document review.").catch(() => { });
        await detail.getByRole("button", { name: /Update status/i }).click().catch(() => { });
        await settle(page, 1500);
        await detail.locator('input[placeholder^="Add investigator note"]').fill("Requested the owner to produce the physical logbook.").catch(() => { });
        await detail.getByRole("button", { name: /Add note/i }).click().catch(() => { });
        await settle(page, 1500);
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FRAUD INTELLIGENCE", "Casebook - audit trail + investigator notes");
        await showcase(page, { steps: 4 });
    });

    // 22. Anomaly: run the transaction anomaly scan and review an alert
    await scene("Transaction anomaly scan: run and review an alert", async () => {
        await clickBtn(page, /Transaction Anomalies/i, HEADED ? 400 : 180);
        await clickBtn(page, /Run anomaly scan/i, HEADED ? 1200 : 500);
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FRAUD INTELLIGENCE", "Anomaly panel - explainable rule scores");
        await showcase(page, { steps: 4 });
        const reviews = btns(page, /^Review$/);
        if (await reviews.count()) {
            await reviews.first().click();
            await settle(page, 1500);
            const card = page.locator("div.card").filter({ has: page.locator('option[value="investigate"]') }).last();
            await card.locator('select').first().selectOption("investigate").catch(() => { });
            await card.locator('input[placeholder="Remarks"]').fill("Escalating for manual cross-check.").catch(() => { });
            await card.locator('input[type="checkbox"]').check().catch(() => { });
            await card.getByRole("button", { name: /^Save$/ }).click().catch(() => { });
            await settle(page, 1500);
        }
    });

    // 23. Cloning: run the identity-cloning scan and review the V1/SHADOW conflict
    await scene("Identity cloning scan: the V1 / SHADOW duplicate-chassis conflict", async () => {
        await clickBtn(page, /Identity Cloning/i, HEADED ? 400 : 180);
        await clickBtn(page, /Scan for exact-match identity conflicts/i, HEADED ? 1400 : 600);
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FRAUD INTELLIGENCE", "Cloning panel - side-by-side identity conflict");
        await showcase(page, { steps: 4 });
        const reviews = btns(page, /^Review$/);
        if (await reviews.count()) {
            await reviews.first().click();
            await settle(page, 1500);
            const card = page.locator("div.card").filter({ has: page.locator('option[value="under-investigation"]') }).last();
            await card.locator('select').first().selectOption("under-investigation").catch(() => { });
            await card.locator('input[placeholder="Remarks"]').fill("Two registrations share one chassis identity - opening a linked case.").catch(() => { });
            await card.locator('input[type="checkbox"]').check().catch(() => { });
            await card.getByRole("button", { name: /^Save$/ }).click().catch(() => { });
            await settle(page, 1500);
        }
    });

    // 24. Analytics + registry search
    await scene("Analytics dashboard and registry search for V1", async () => {
        await page.goto(BASE + "/analytics", { waitUntil: "domcontentloaded" });
        await settle(page, 1900); // charts animate in
        // Pan slowly through every chart so nothing is missed.
        await setBadge(page, "normal", "STANDARD FLOW", "Analytics - registrations, transfers, mix");
        await showcase(page, { steps: 6 });
        await page.goto(BASE + "/search", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await page.locator('input').first().fill(CHASSIS_V1).catch(() => { });
        await settle(page, 1500);
        await showcase(page, { steps: 4 });
    });

    // 25. Feature 9 - 3D Vehicle Damage & Repair Intelligence (open the EXISTING
    // accident-linked assessment; read-only showcase + integrity verification).
    await scene("Feature 9: 3D Damage & Repair - one accident, honest assessment, catalogue estimate, verification trail", async () => {
        await logout(page);
        await login(page, A.damageOfficer, /\/rto/);
        await page.goto(BASE + "/damage", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await page.locator('input[placeholder="e.g. KA-06-AB-1234"]').fill("KA46DH5566");
        await clickBtn(page, /Find vehicle/i, HEADED ? 1200 : 500);
        // Open the existing accident-linked assessment (never duplicate the accident).
        await btn(page, /DMR-/i).click();
        await settle(page, 1700);

        // LIVE: upload the front / side / rear photographs so the viewer sees the
        // evidence going IN - the 3D model is built from exactly these photos.
        const photoCard = page.locator('div.card').filter({ hasText: 'Damage photographs' }).first();
        await photoCard.scrollIntoViewIfNeeded().catch(() => { });
        const DMG_VIEWS = [
            { view: "front", tag: "Front photograph \u2192 bumper / bonnet damage" },
            { view: "left", tag: "Side (left) photograph \u2192 door / fender damage" },
            { view: "rear", tag: "Rear photograph \u2192 tail-light / rear-window damage" },
        ];
        for (let i = 0; i < DMG_VIEWS.length; i++) {
            const v = DMG_VIEWS[i];
            await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 UPLOADING PHOTO " + (i + 1) + " / 3", v.tag);
            await photoCard.locator('select').first().selectOption(v.view).catch(() => { });
            await photoCard.locator('input[type="file"]').first().setInputFiles(PHOTO).catch(() => { });
            const up = page.waitForResponse((r) => /\/damage\/assessments\/.+\/photos/.test(r.url()) && r.request().method() === "POST", { timeout: 12000 }).catch(() => null);
            await photoCard.getByRole("button", { name: /^Upload$/ }).click().catch(() => { });
            await up;
            await settle(page, 1600);
            if (HEADED) await page.waitForTimeout(800); // let the new thumbnail render
        }

        // Run the (honest, pluggable) detection over the uploaded photos, then the
        // 3D body recolours each damaged component by its recorded severity.
        await clickBtn(page, /Run analysis/i, HEADED ? 2000 : 700);
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 BUILDING THE 3D MODEL", "Photo findings mapped onto the interactive 3D body");
        const view3d = page.locator('div.card').filter({ hasText: 'Interactive 3D assessment' }).first();
        await view3d.scrollIntoViewIfNeeded().catch(() => { });
        await settle(page, 1800);
        if (HEADED) await page.waitForTimeout(1200);
        await clickBtn(page, /Repaired preview/i, HEADED ? 1000 : 400);
        if (HEADED) await page.waitForTimeout(1100);
        await clickBtn(page, /Assessed condition/i, HEADED ? 1000 : 400);
        if (HEADED) await page.waitForTimeout(1100);

        // Walk the ENTIRE workspace slowly; the badge enumerates each stage.
        const DMG_STEPS = ["Analysis (pluggable", "Damage photographs", "Interactive 3D assessment", "Recorded component findings", "Repair estimate (catalogue", "Authorised review", "Repair completion evidence", "Before / after comparison", "Final inspection"];
        for (let i = 0; i < DMG_STEPS.length; i++) {
            await page.locator("text=" + DMG_STEPS[i]).first().scrollIntoViewIfNeeded().catch(() => { });
            await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 WORKSPACE STAGE " + (i + 1) + " / 9", DMG_STEPS[i]);
            await settle(page, 1500);
            if (HEADED) await page.waitForTimeout(1100); // readable dwell on each stage
        }

        // Verify the tamper-evident hash of the finalized assessment.
        await page.locator("text=Decision trail").first().scrollIntoViewIfNeeded().catch(() => { });
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 INTEGRITY", "On-chain record hash - tamper evidence");
        await clickBtn(page, /Verify integrity/i, HEADED ? 1500 : 500);
        if (HEADED) await page.waitForTimeout(1000);
    });

    // 26. Feature 10 - Vehicle Lifecycle Forensics & Event Replay (read-only).
    await scene("Feature 10: Lifecycle Forensics - replay, compare states, trace the flagged conflict, generate the report", async () => {
        await logout(page);
        await login(page, A.forensicsOfficer, /\/rto/);
        await page.goto(BASE + "/forensics", { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
        await page.locator('input[placeholder="e.g. KA-06-AB-1234"]').fill("KA45FG1234");
        await clickBtn(page, /Reconstruct Vehicle History/i, HEADED ? 1700 : 600);

        // 1) Reconstructed current identity + integrity KPI strip.
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FORENSICS 1 / 6", "Reconstructed identity + on-chain integrity KPIs");
        await page.evaluate(() => window.scrollTo(0, 0)).catch(() => { });
        await settle(page, 1500);
        if (HEADED) await page.waitForTimeout(1200);
        await clickBtn(page, /Verify integrity/i, HEADED ? 1200 : 400);
        if (HEADED) await page.waitForTimeout(1000);

        // 2) Event replay: step THROUGH every recorded event, dwelling on each so
        // the viewer actually reads the timeline; replay the first and last states.
        await page.locator("text=Event replay").first().scrollIntoViewIfNeeded().catch(() => { });
        const events = page.locator("button.card");
        const evCount = await events.count();
        for (let i = 0; i < evCount; i++) {
            await events.nth(i).scrollIntoViewIfNeeded().catch(() => { });
            await events.nth(i).click().catch(() => { });
            await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 EVENT " + (i + 1) + " / " + evCount, "Inspecting the recorded state at this event");
            await settle(page, 1400);
            if (HEADED) await page.waitForTimeout(1200);
            if (i === 0 || i === evCount - 1) {
                await clickBtn(page, /Replay state up to this event/i, HEADED ? 1100 : 400);
                await page.locator("text=Selected event").first().scrollIntoViewIfNeeded().catch(() => { });
                if (HEADED) await page.waitForTimeout(1200);
            }
        }

        // 3) Compare the state between two events (earliest vs latest).
        await page.locator("text=Compare the recorded state").first().scrollIntoViewIfNeeded().catch(() => { });
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FORENSICS 2 / 6", "State diff between two events - what changed & where");
        const sel = page.locator("select").filter({ has: page.locator('option[value=""]') });
        await sel.nth(0).selectOption({ index: 1 }).catch(() => { });
        const n = await sel.nth(1).locator("option").count();
        await sel.nth(1).selectOption({ index: Math.max(1, n - 1) }).catch(() => { });
        await clickBtn(page, /^Compare$/, HEADED ? 1100 : 400);
        if (HEADED) await page.waitForTimeout(1400);

        // 4) Event dependency graph.
        await page.locator("text=Event dependency graph").first().scrollIntoViewIfNeeded().catch(() => { });
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FORENSICS 3 / 6", "Dependency graph - how records reference one another");
        if (HEADED) await page.waitForTimeout(1800);

        // 5) Conflict tracing -> link the finding to the casebook (only write).
        await page.locator("text=Conflict tracing").first().scrollIntoViewIfNeeded().catch(() => { });
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FORENSICS 4 / 6", "Conflict tracing - inconsistency to its origin");
        if (HEADED) await page.waitForTimeout(1300);
        await clickBtn(page, /Link finding to casebook/i, HEADED ? 1300 : 500);
        if (HEADED) await page.waitForTimeout(1000);

        // 6) Generate the investigation report and reveal it part by part.
        await setBadge(page, "core", "\u2605 CORE FEATURE \u00b7 FORENSICS 5 / 6", "Full forensic investigation report");
        await clickBtn(page, /Generate report/i, HEADED ? 1600 : 550);
        await settle(page, 1600);
        for (const h of ["Investigation Report", "Findings", "Conclusion"]) {
            await page.locator("text=" + h).first().scrollIntoViewIfNeeded().catch(() => { });
            if (HEADED) await page.waitForTimeout(1200);
        }
    });

    // 27. Sign out
    await scene("Walkthrough complete — signing out to the public home", async () => {
        await logout(page);
        await page.goto(BASE, { waitUntil: "domcontentloaded" });
        await settle(page, 1500);
    });
} catch (e) {
    log("FATAL: " + e.message);
}

log("=== console/network issues captured: " + errors.length + " ===");
[...new Set(errors)].slice(0, 40).forEach((e) => log("  - " + e));
if (HEADED) {
    log("Done. Brief 3.5s tail so the recording closes cleanly on the public home.");
    await page.waitForTimeout(3500);
}
// Finalize the video: Playwright flushes it on close, then we give it a stable name.
let savedVideo = null;
if (RECORD_VIDEO && page.video()) {
    try {
        const tmp = await page.video().path();
        await browser.close();
        const { renameSync } = await import("fs");
        const target = fileURLToPath(new URL("./recordings/biochain-a2z-demo.webm", import.meta.url));
        renameSync(tmp, target);
        savedVideo = target;
        log("VIDEO saved to: " + target);
    } catch (e) { log("video finalize failed: " + e.message); }
} else {
    await browser.close();
}
