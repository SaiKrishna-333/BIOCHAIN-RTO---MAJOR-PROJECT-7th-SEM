// seed-id-cards.js
// Issues a Digital ID Card for each demo user so their profile opens on a
// finished, on-chain-anchored card instead of the empty "issue" state.
// Run: node --env-file=.env src/seed-id-cards.js (backend must be running)
import axios from "axios";

const API = "http://localhost:5000/api";
const DEMO = [
    ["owner@biochain.com", "owner123"],
    ["owner2@biochain.com", "owner123"],
    ["dealer@biochain.com", "dealer123"],
    ["ka.rto@biochain.com", "ka123"],
    ["tn.rto@biochain.com", "tn123"],
    ["police@biochain.com", "police123"],
    ["maruti.demo@workshop.com", "demo123"],
];

let okCount = 0, skipCount = 0, failCount = 0;
for (const [email, password] of DEMO) {
    try {
        const { data: login } = await axios.post(`${API}/auth/login`, { email, password });
        const hdr = { headers: { Authorization: `Bearer ${login.token}` } };
        const { data } = await axios.post(`${API}/id-card/me`, {}, hdr);
        const c = data.card;
        const tx = c.anchor?.txHash;
        console.log(` ISSUED  ${email} -> ${c.cardNumber} v${c.version} | tx ${tx ? tx.slice(0, 18) + "..." : "(pending, DB hash intact)"}`);
        okCount++;
    } catch (err) {
        if (err.response?.status === 401) {
            console.log(` SKIPPED ${email}: login failed (not seeded?)`);
            skipCount++;
        } else {
            console.log(` FAILED  ${email}: ${err.response?.data?.message || err.message}`);
            failCount++;
        }
    }
}
console.log(`\n=== Digital ID Cards: ${okCount} issued, ${skipCount} skipped, ${failCount} failed ===`);
