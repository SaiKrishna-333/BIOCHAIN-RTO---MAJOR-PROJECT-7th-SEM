// Minimal demo-only seed for presentation and smoke testing.
// Kept isolated from production logic.

const demoUsers = [
  { name: 'Dealer Demo', email: 'dealer@biochain.com', password: 'dealer123', role: 'dealer' },
  { name: 'Owner Demo', email: 'owner@biochain.com', password: 'owner123', role: 'owner' },
  { name: 'Karnataka RTO Demo', email: 'ka.rto@biochain.com', password: 'ka123', role: 'rto' },
];

console.log(JSON.stringify(demoUsers, null, 2));
