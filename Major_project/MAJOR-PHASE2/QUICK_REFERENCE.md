# BioChain RTO - 8 Patent Features Quick Reference

## System Status

  **Server:** Running on port 5000
  **Database:** MongoDB Connected
  **Blockchain:** Initialized
  **All Features:** Active

---

## Feature Overview

| #   | Feature                          | Status    | API Base Path                             |
| --- | -------------------------------- | --------- | ----------------------------------------- |
| 1   | Biometric + DID Binding          |  Active | `/api/patent-features/biometric-*`        |
| 2   | AI Fraud Detection               |  Active | `/api/patent-features/fraud/*`            |
| 3   | Multi-Authority Consensus        |  Active | `/api/patent-features/consensus/*`        |
| 4   | Vehicle Lifecycle State Machine  |  Active | `/api/patent-features/lifecycle/*`        |
| 5   | Privacy-Preserving Verification  |  Active | `/api/patent-features/privacy/*`          |
| 6   | Cross-State RTO Interoperability |  Active | `/api/patent-features/interoperability/*` |
| 7   | Predictive Theft Detection       |  Active | `/api/patent-features/theft/*`            |
| 8   | Ownership Reputation Score       |  Active | `/api/patent-features/reputation/*`       |

---

## Quick API Testing

### Test 1: Check Server Health

```bash
curl http://localhost:5000/
```

**Expected Response:** `{"message": "BioChain RTO API is running"}`

---

### Test 2: Generate Biometric Hash (Feature 1)

```bash
curl -X POST http://localhost:5000/api/patent-features/biometric/hash \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"biometricTemplate": "test_fingerprint_data_12345"}'
```

---

### Test 3: Analyze Fraud Risk (Feature 2)

```bash
curl -X POST http://localhost:5000/api/patent-features/fraud/analyze-transaction \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "vehicleId": "VEHICLE_ID_HERE",
    "sellerId": "SELLER_ID_HERE",
    "buyerId": "BUYER_ID_HERE"
  }'
```

---

### Test 4: Check Vehicle Transfer Eligibility (Feature 4)

```bash
curl -X GET http://localhost:5000/api/patent-features/lifecycle/VEHICLE_ID/can-transfer \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### Test 5: Privacy-Preserving Ownership Verification (Feature 5)

```bash
curl -X GET http://localhost:5000/api/patent-features/privacy/verify/VEHICLE_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### Test 6: Generate Vehicle Passport for Cross-State Transfer (Feature 6)

```bash
curl -X GET http://localhost:5000/api/patent-features/interoperability/passport/VEHICLE_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### Test 7: Analyze Theft Risk (Feature 7)

```bash
curl -X GET http://localhost:5000/api/patent-features/theft/risk/VEHICLE_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

### Test 8: Calculate Reputation Score (Feature 8)

```bash
curl -X GET http://localhost:5000/api/patent-features/reputation/USER_ID \
  -H "Authorization: Bearer YOUR_TOKEN"
```

---

## Service Files Reference

```
backend/src/services/
├── enhancedBiometricDIDService.js      → Feature 1: Biometric + DID
├── fraudDetectionService.js            → Feature 2: AI Fraud Detection
├── consensusProtocolService.js         → Feature 3: Multi-Authority Consensus
├── vehicleLifecycleService.js          → Feature 4: Lifecycle State Machine
├── privacyPreservingVerification.js    → Feature 5: Privacy Verification
├── crossStateInteroperability.js       → Feature 6: Cross-State Protocol
├── predictiveTheftDetection.js         → Feature 7: Theft Detection
└── ownershipReputationService.js       → Feature 8: Reputation Score
```

---

## Common Use Cases

### Use Case 1: Vehicle Transfer with All Features

```javascript
// 1. Check if vehicle can be transferred (Feature 4)
GET /api/patent-features/lifecycle/{vehicleId}/can-transfer

// 2. Analyze transaction for fraud (Feature 2)
POST /api/patent-features/fraud/analyze-transaction
{
  "vehicleId": "...",
  "sellerId": "...",
  "buyerId": "..."
}

// 3. Check seller reputation (Feature 8)
GET /api/patent-features/reputation/{sellerId}

// 4. Create consensus request (Feature 3)
POST /api/patent-features/consensus/create
{
  "vehicleId": "...",
  "sellerId": "...",
  "buyerId": "...",
  "type": "transfer"
}

// 5. Record approvals (Feature 3)
POST /api/patent-features/consensus/{requestId}/approve
{
  "authority": "seller",
  "signature": "...",
  "biometricHash": "..."
}
```

---

### Use Case 2: Theft Report & Auto-Freeze

```javascript
// 1. File theft report (existing endpoint)
POST / api / theft / report;

// 2. Auto-freeze triggers automatically (Feature 7)
// System detects theft report and freezes vehicle

// 3. Check theft risk (Feature 7)
GET / api / patent - features / theft / risk / { vehicleId };

// 4. Verify vehicle is blocked (Feature 4)
GET / api / patent - features / lifecycle / { vehicleId } / state;
```

---

### Use Case 3: Cross-State Transfer

```javascript
// 1. Generate vehicle passport (Feature 6)
GET /api/patent-features/interoperability/passport/{vehicleId}

// 2. Create inter-state transfer (Feature 6)
POST /api/patent-features/interoperability/transfer
{
  "vehicleId": "...",
  "fromState": "MH",
  "toState": "KA",
  "newRegNumber": "KA01AB1234",
  "buyerId": "...",
  "sellerId": "..."
}

// 3. Approvals from both state RTOs (Feature 3)
POST /api/patent-features/interoperability/transfer/{transferId}/approve
{
  "approverRole": "origin_rto"
}

// 4. Sync data with destination state (Feature 6)
POST /api/patent-features/interoperability/sync/{vehicleId}
{
  "targetState": "KA"
}
```

---

### Use Case 4: Privacy-Preserving Police Check

```javascript
// Police officer checks vehicle ownership without seeing personal data

// Option 1: By Vehicle ID (Feature 5)
GET /api/patent-features/privacy/verify/{vehicleId}
// Returns: { ownershipValid: true, ownershipStatus: "VERIFIED_OWNER" }

// Option 2: By Registration Number (Feature 5)
GET /api/patent-features/privacy/verify-by-reg/MH01AB1234

// Option 3: Generate Zero-Knowledge Proof (Feature 5)
POST /api/patent-features/privacy/zkp/generate/{vehicleId}
{
  "ownerDID": "did:biochain:owner:..."
}
```

---

## Error Handling

All API endpoints return standardized error responses:

```json
{
  "error": "Error message here"
}
```

**Common Errors:**

- `401 Unauthorized` - Missing or invalid token
- `403 Forbidden` - Insufficient role permissions
- `404 Not Found` - Resource doesn't exist
- `500 Internal Server Error` - Server error

---

## Authentication

All endpoints require JWT token in Authorization header:

```bash
-H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**Role-Based Access:**

- Some endpoints restricted to `rto` role
- Some endpoints restricted to `police` role
- Most endpoints available to all authenticated users

---

## Testing with Postman

1. Import base URL: `http://localhost:5000`
2. Set Authorization: `Bearer {token}`
3. Test endpoints in any order
4. Check response status codes

---

## Monitoring & Debugging

### Check Server Logs

```bash
# Server logs show feature usage
tail -f backend/logs/server.log
```

### Database Queries

```javascript
// Check consensus requests
db.requests.find({ consensus: { $exists: true } });

// Check state change history
db.vehicles.find({ stateChangeHistory: { $exists: true } });
```

---

## Integration Checklist

-  All services created
-  All routes registered
-  Models updated (Request, Vehicle)
-  Server starts without errors
-  No existing code broken
-  Authentication applied
-  Role-based access control

---

## Support

For issues or questions:

1. Check server logs
2. Verify authentication token
3. Ensure MongoDB is running
4. Check blockchain service status

---

**Last Updated:** 2026-04-27
**Version:** 1.0.0
**Status:** Production Ready
