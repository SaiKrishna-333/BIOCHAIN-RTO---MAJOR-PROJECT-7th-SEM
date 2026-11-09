// A-to-Z runtime smoke test: log in as every demo role and hit the exact
// endpoints the (premium-upgraded) dashboards call. Prints PASS/FAIL per call.
const BASE = "http://localhost:5000/api";

const accounts = {
    owner: { email: "owner@biochain.com", password: "owner123" },
    rto: { email: "ka.rto@biochain.com", password: "ka123" },
    police: { email: "police@biochain.com", password: "police123" },
    dealer: { email: "dealer@biochain.com", password: "dealer123" },
    workshop: { email: "maruti.demo@workshop.com", password: "demo123" },
};

// endpoints each premium page loads on mount (path -> role)
const checks = {
    owner: ["/vehicles/my", "/requests/my-invoices", "/challans/pending"],
    rto: ["/requests/all", "/inheritance/requests", "/theft/reports", "/analytics/overview", "/analytics/vehicle-status"],
    police: ["/theft/reports", "/analytics/overview"],
    dealer: ["/requests/my-requests"],
    workshop: ["/vehicle-intelligence/my-brand-vehicles"],
};

let failures = 0;
const results = [];

async function login(role) {
    const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(accounts[role]),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.token) {
        throw new Error(`login failed (${res.status}): ${body.message || JSON.stringify(body).slice(0, 120)}`);
    }
    return body.token;
}

async function get(path, token) {
    const res = await fetch(`${BASE}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${text.slice(0, 140)}`);
    // cheap shape check: report payload size so we know it's real data
    return `${text.length} bytes`;
}

for (const [role, paths] of Object.entries(checks)) {
    let token;
    try {
        token = await login(role);
        results.push(`PASS  auth/login            as ${role}`);
    } catch (e) {
        results.push(`FAIL  auth/login            as ${role} -> ${e.message}`);
        failures++;
        continue;
    }
    for (const p of paths) {
        try {
            const size = await get(p, token);
            results.push(`PASS  GET ${p.padEnd(38)} as ${role} [${size}]`);
        } catch (e) {
            results.push(`FAIL  GET ${p.padEnd(38)} as ${role} -> ${e.message}`);
            failures++;
        }
    }
}

console.log(results.join("\n"));
console.log(failures === 0 ? `\nALL API CHECKS PASSED (${results.length} calls)` : `\n${failures} FAILURE(S) of ${results.length} calls`);
process.exit(failures === 0 ? 0 : 1);
