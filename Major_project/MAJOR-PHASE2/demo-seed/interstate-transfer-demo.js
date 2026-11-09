// Minimal isolated interstate transfer example.
// Kept separate from the live app.

const transferDemo = {
  requestId: 'ITR-2026-001',
  vehicle: 'KA-01-AB-1234',
  from: 'Karnataka',
  to: 'Tamil Nadu',
  status: 'approved',
  txHash: '0x7f9a4d2b8b0e3b7d6c1e2a3f4b5c6d7e8f9a0b1',
};

console.log(JSON.stringify(transferDemo, null, 2));
