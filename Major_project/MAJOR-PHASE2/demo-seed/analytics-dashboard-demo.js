// Minimal demo-only analytics snapshot for presentation purposes.
// This file stays outside the live app and does not change the product code.

const analyticsDemo = {
  totalVehicles: 2480,
  activeTransfers: 14,
  pendingVerifications: 9,
  theftAlerts: 3,
  challansIssued: 178,
  status: 'demo-only',
};

console.log(JSON.stringify(analyticsDemo, null, 2));
