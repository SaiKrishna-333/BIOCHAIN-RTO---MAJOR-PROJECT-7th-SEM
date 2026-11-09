// recon.mjs - headless ground-truth dump of each role's dashboard controls.
// Run: node tools/recon.mjs   (writes tools/recon-out.txt)
import { chromium } from "playwright-core";
import { writeFileSync } from "fs";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5173";
const OUT = [];
const say = (s) => { OUT.push(s); };

const ACCOUNTS = [
    { role: "dealer", email: "dealer@biochain.com", password: "dealer123" },
    { role: "rto", email: "ka.rto@biochain.com", password: "ka123" },
    { role: "police", email: "police@biochain.com", password: "police123" },
    { role: "workshop", email: "maruti.demo@workshop.com", password: "demo123" },
    { role: "owner", email: "owner@biochain.com", password: "owner123" },
];

async function dumpFields(page, tag) {
    const data = await page.evaluate(() => {
        const pick = (el) => ({
            tag: el.tagName.toLowerCase(),
            type: el.getAttribute("type") || "",
            name: el.getAttribute("name") || "",
            ph: el.getAttribute("placeholder") || "",
            aria: el.getAttribute("aria-label") || "",
            text: (el.innerText || el.value || "").trim().slice(0, 60),
        });
        const visible = (el) => el.offsetParent !== null;
        return {
            tabs: [...document.querySelectorAll(".tab-btn")].filter(visible).map((b) => b.innerText.trim()),
            buttons: [...document.querySelectorAll("button")].filter(visible).map(pick).filter((b) => b.text),
            inputs: [...document.querySelectorAll("input,textarea,select")].filter(visible).map(pick),
            headings: [...document.querySelectorAll("h1,h2,h3,h4,h5")].filter(visible).map((h) => h.innerText.trim()).filter(Boolean),
        };
    });
    say(`\n--- ${tag} ---`);
    say("TABS: " + JSON.stringify(data.tabs));
    say("HEADINGS: " + JSON.stringify(data.headings));
    say("BUTTONS: " + JSON.stringify(data.buttons.map((b) => b.text)));
    say("FIELDS: " + JSON.stringify(data.inputs.map((i) => ({ n: i.name, t: i.type, p: i.ph, a: i.aria }))));
}

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
const page = await ctx.newPage();

for (const acc of ACCOUNTS) {
    try {
        await page.goto(BASE + "/login", { waitUntil: "networkidle" });
        await page.evaluate(() => localStorage.clear());
        await page.locator('input[type="email"]').first().fill(acc.email);
        await page.locator('input[type="password"]').first().fill(acc.password);
        await page.getByRole("button", { name: /Secure Login/i }).click();
        await page.waitForURL(/\/(dealer|rto|police|workshop|owner)/, { timeout: 8000 }).catch(() => { });
        await page.waitForTimeout(1500);
        say("\n\n================ " + acc.role.toUpperCase() + "  url=" + page.url() + " ================");
        await dumpFields(page, acc.role + " default");
        const tabCount = await page.locator(".tab-btn:visible").count();
        for (let i = 0; i < tabCount; i++) {
            const label = (await page.locator(".tab-btn:visible").nth(i).innerText()).trim();
            await page.locator(".tab-btn:visible").nth(i).click().catch(() => { });
            await page.waitForTimeout(900);
            await dumpFields(page, acc.role + " tab[" + label + "]");
        }
    } catch (e) {
        say("\n!! " + acc.role + " recon error: " + e.message);
    }
}

await browser.close();
writeFileSync(new URL("./recon-out.txt", import.meta.url), OUT.join("\n"));
console.log("RECON DONE, lines=" + OUT.length);
