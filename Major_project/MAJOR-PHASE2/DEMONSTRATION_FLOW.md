# BioChain RTO - Complete Demonstration Flow

## End-to-End User Journeys & Simulation Guide

---

## OVERVIEW

This document provides complete step-by-step flows for all user scenarios in BioChain RTO, designed for industrial demonstration with simulated components clearly marked.

**SIMULATION MODE**: Biometric and Document Upload are in DEMO/SIMULATION mode for presentation.

---

## USER ROLES & ACCESS

| Role               | Login Credentials               | Dashboard Access |
| ------------------ | ------------------------------- | ---------------- |
| **Dealer**         | dealer@biochain.com / dealer123 | Dealer Dashboard |
| **Owner (Buyer)**  | owner@biochain.com / owner123   | Owner Dashboard  |
| **Karnataka RTO**  | ka.rto@biochain.com / ka123     | RTO Dashboard    |
| **Tamil Nadu RTO** | tn.rto@biochain.com / tn123     | RTO Dashboard    |
| **Police**         | police@biochain.com / police123 | Police Dashboard |

---

## FLOW 1: NEW VEHICLE PURCHASE (Dealer → Owner)

### Step-by-Step Journey

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW 1: NEW VEHICLE PURCHASE                             │
│                    (Dealer sells to First Owner)                            │
└─────────────────────────────────────────────────────────────────────────────┘

PHASE 1: DEALER REGISTRATION (One-time setup)
═══════════════════════════════════════════════════════════════════════════════

Step 1.1: Dealer Registration
─────────────────────────────
Action: POST /api/auth/register
Payload: {
    "name": "ABC Motors",
    "email": "dealer@biochain.com",
    "password": "dealer123",
    "role": "dealer",
    "aadhaarNumber": "123456789012",
    "dlNumber": "KA0123456789",
    "dealerDetails": {
        "businessName": "ABC Motors Pvt Ltd",
        "gstin": "29ABCDE1234F1Z5",
        "tin": "12345678901",
        "showroomAddress": "123 Main Road, Bangalore",
        "phone": "9876543210",
        "licenseNumber": "DL-BLR-2024-001"
    }
}

[DEMO] Biometric: Fingerprint enrollment simulated
Result: Dealer gets DID (did:ethr:0x...), blockchain wallet created


PHASE 2: OWNER REGISTRATION (First-time buyer)
═══════════════════════════════════════════════════════════════════════════════

Step 2.1: Owner/Buyer Registration
──────────────────────────────────
Action: POST /api/auth/register
Payload: {
    "name": "Rajesh Kumar",
    "email": "owner@biochain.com",
    "password": "owner123",
    "role": "owner",
    "aadhaarNumber": "987654321098",
    "dlNumber": "KA9876543210"
}

[DEMO] Biometric: Fingerprint enrollment simulated
Result: Owner gets DID, can now buy vehicles


PHASE 3: VEHICLE SALE (Dealer initiates)
═══════════════════════════════════════════════════════════════════════════════

Step 3.1: Dealer Creates New Registration Request
─────────────────────────────────────────────────
Action: POST /api/requests/new-registration
Headers: Authorization: Bearer {dealer_token}
Payload: {
    "buyerEmail": "owner@biochain.com",
    "vehicleDetails": {
        "chassisNumber": "MH1234567890ABCD",
        "engineNumber": "EN9876543210",
        "make": "Maruti Suzuki",
        "model": "Swift",
        "year": 2024
    }
}

[DEMO] Document Upload: Dealer uploads invoice (simulated)
Action: POST /api/upload/vehicle-document/{vehicleId}
FormData: document=invoice.pdf, documentType="invoice"

Step 3.2: System Auto-Generates Invoice
───────────────────────────────────────
Action: GET /api/documents/invoice/{requestId}
Result: Digital invoice with dealer GSTIN, vehicle details, fees


PHASE 4: REAL-TIME NOTIFICATION TO RTO
═══════════════════════════════════════════════════════════════════════════════

Step 4.1: Notification Triggered
────────────────────────────────
Action: Automatic via notificationService
Channels:
  WebSocket: Real-time alert to all RTO officers
  Email: Sent to rto@biochain.com
  In-app: Appears in RTO dashboard

Notification Content:
{
    "type": "new_request",
    "title": "New Registration Request: Maruti Suzuki Swift",
    "message": "Dealer ABC Motors has submitted a new vehicle registration",
    "priority": "medium",
    "actionRequired": true
}


PHASE 5: RTO APPROVAL
═══════════════════════════════════════════════════════════════════════════════

Step 5.1: RTO Officer Reviews Request
─────────────────────────────────────
Action: GET /api/requests/all
RTO sees: Pending request from dealer for owner@biochain.com

Step 5.2: RTO Verifies Documents
────────────────────────────────
[DEMO] Document Verification: RTO views uploaded invoice
Action: GET /api/upload/vehicle-documents/{vehicleId}

Step 5.3: RTO Approves Request
──────────────────────────────
Action: POST /api/requests/{requestId}/approve
Payload: { "regNumber": "KA01AB1234" }

Backend Actions:
  1. Register vehicle on blockchain: registerVehicleOnChain()
  2. Store transfer record on IPFS
  3. Update vehicle status: currentOwner = Owner
  4. Create ownership history record
  5. Generate Digital RC

Step 5.4: Digital RC Generated
──────────────────────────────
Action: GET /api/documents/rc/{vehicleId}
Result: Digital Registration Certificate with QR code


PHASE 6: NOTIFICATION TO OWNER
═══════════════════════════════════════════════════════════════════════════════

Step 6.1: Owner Receives Approval Notification
──────────────────────────────────────────────
Channels:
  WebSocket: Real-time notification
  Email: "Registration Approved: KA01AB1234"
  SMS: "Your vehicle registration has been APPROVED"
  In-app: Notification in Owner dashboard

Step 6.2: Owner Views Digital RC
────────────────────────────────
Action: GET /api/documents/user-documents
Result: RC Certificate available for download


PHASE 7: BLOCKCHAIN RECORD
═══════════════════════════════════════════════════════════════════════════════

Blockchain Entry:
{
    "regNumber": "KA01AB1234",
    "chassisNumber": "MH1234567890ABCD",
    "currentOwner": "0x... (Owner's blockchain address)",
    "status": "active",
    "ownershipHistory": [{
        "from": "0x0 (Dealer)",
        "to": "0x... (Owner)",
        "timestamp": "2024-...",
        "reason": "new_registration",
        "biometricHash": "0x..."
    }]
}

IPFS Record Hash: QmXyz... (immutable document storage)


═══════════════════════════════════════════════════════════════════════════════
  FLOW 1 COMPLETE: Owner now has registered vehicle with Digital RC
═══════════════════════════════════════════════════════════════════════════════
```

---

## FLOW 2: VEHICLE RESALE (Owner A → Owner B)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW 2: VEHICLE RESALE                                   │
│                    (Second-hand Vehicle Transfer)                           │
└─────────────────────────────────────────────────────────────────────────────┘

PREREQUISITE: Owner A has vehicle KA01AB1234 (from Flow 1)


PHASE 1: NEW BUYER REGISTRATION
═══════════════════════════════════════════════════════════════════════════════

Step 1.1: New Owner (Buyer B) Registers
───────────────────────────────────────
Action: POST /api/auth/register
Payload: {
    "name": "Priya Sharma",
    "email": "buyer2@biochain.com",
    "password": "buyer2123",
    "role": "owner",
    "aadhaarNumber": "456789012345",
    "dlNumber": "KA4567890123"
}

[DEMO] Biometric: Fingerprint enrollment simulated


PHASE 2: SELLER INITIATES TRANSFER
═══════════════════════════════════════════════════════════════════════════════

Step 2.1: Owner A (Seller) Initiates Transfer
─────────────────────────────────────────────
Action: POST /api/requests/transfer
Headers: Authorization: Bearer {owner_a_token}
Payload: {
    "vehicleId": "vehicle_id_from_flow_1",
    "buyerEmail": "buyer2@biochain.com"
}

[DEMO] Biometric: Seller fingerprint verification simulated
Middleware: biometricRequired verifies seller identity

Step 2.2: System Validates Ownership
────────────────────────────────────
Check: vehicle.currentOwner == req.user.id (Owner A)
Result:  Valid, proceed with transfer request


PHASE 3: NOTIFICATION TO RTO
═══════════════════════════════════════════════════════════════════════════════

Step 3.1: Real-time Alert to RTO
────────────────────────────────
Channels:
  WebSocket: "New Transfer Request: KA01AB1234"
  Email: RTO officers notified
  In-app: Dashboard notification

Notification:
{
    "type": "transfer_request",
    "title": "Transfer Request: KA01AB1234",
    "message": "Owner Rajesh Kumar wants to transfer to Priya Sharma",
    "priority": "medium"
}


PHASE 4: RTO APPROVES TRANSFER
═══════════════════════════════════════════════════════════════════════════════

Step 4.1: RTO Reviews Transfer Request
──────────────────────────────────────
Action: GET /api/requests/all
RTO sees: Transfer request with seller and buyer details

Step 4.2: RTO Approves
──────────────────────
Action: POST /api/requests/{requestId}/approve
Payload: { "regNumber": "KA01AB1234" } (same number)

Backend Actions:
  1. Transfer on blockchain: transferOwnership()
     - Smart Contract checks: vehicle status != "stolen"
     - Records: from=OwnerA, to=OwnerB, reason="purchase"
  2. Store transfer record on IPFS
  3. Update vehicle.currentOwner = OwnerB
  4. Add to ownership history


PHASE 5: NOTIFICATIONS TO BOTH PARTIES
═══════════════════════════════════════════════════════════════════════════════

Step 5.1: Seller (Owner A) Notified
───────────────────────────────────
Message: "Transfer Approved: KA01AB1234. Vehicle successfully transferred."

Step 5.2: Buyer (Owner B) Notified
──────────────────────────────────
Message: "Transfer Approved: KA01AB1234. You are now the registered owner."
Channels: WebSocket + Email + SMS + In-app

Step 5.3: Transfer Certificate Generated
────────────────────────────────────────
Action: GET /api/documents/transfer-certificate/{requestId}
Result: Digital transfer certificate with both parties' DIDs


PHASE 6: BLOCKCHAIN UPDATE
═══════════════════════════════════════════════════════════════════════════════

Updated Blockchain Record:
{
    "regNumber": "KA01AB1234",
    "currentOwner": "0x... (Owner B's address)",
    "previousOwners": ["0x... (Owner A's address)"],
    "ownershipHistory": [
        { "from": "0x0", "to": "0x...A", "reason": "new_registration" },
        { "from": "0x...A", "to": "0x...B", "reason": "purchase" }
    ]
}


═══════════════════════════════════════════════════════════════════════════════
  FLOW 2 COMPLETE: Vehicle transferred from Owner A to Owner B
═══════════════════════════════════════════════════════════════════════════════
```

---

## FLOW 3: INHERITANCE TRANSFER (Deceased Owner → Legal Heir)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW 3: INHERITANCE TRANSFER                             │
│                    (Ownership after owner's death)                          │
└─────────────────────────────────────────────────────────────────────────────┘

PREREQUISITE: Owner B (Priya) has vehicle KA01AB1234


PHASE 1: LEGAL HEIR REGISTERS
═══════════════════════════════════════════════════════════════════════════════

Step 1.1: Family Member Registers as Legal Heir
───────────────────────────────────────────────
Action: POST /api/auth/register
Payload: {
    "name": "Rahul Sharma",
    "email": "heir@biochain.com",
    "password": "heir123",
    "role": "owner",
    "aadhaarNumber": "789012345678",
    "dlNumber": "KA7890123456"
}

Note: Rahul is Priya's brother (legal heir)


PHASE 2: LEGAL HEIR INITIATES CLAIM
═══════════════════════════════════════════════════════════════════════════════

Step 2.1: Legal Heir Submits Inheritance Request
────────────────────────────────────────────────
Action: POST /api/inheritance/request
Headers: Authorization: Bearer {heir_token}
Payload: {
    "vehicleId": "vehicle_id",
    "deceasedOwnerId": "priya_user_id",
    "deathCertificateNumber": "DC-2024-123456",
    "relationshipToDeceased": "Brother",
    "successionCertificateNumber": "SC-2024-789012",
    "courtOrderNumber": "CO-2024-345678"
}

[DEMO] Document Upload:
  - Death Certificate (DC-2024-123456)
  - Succession Certificate
  - Court Order
  - Relationship Proof
Action: POST /api/upload/inheritance-documents/{requestId}

[DEMO] Biometric: Legal heir fingerprint captured


PHASE 3: RTO VERIFICATION
═══════════════════════════════════════════════════════════════════════════════

Step 3.1: RTO Receives Inheritance Request
──────────────────────────────────────────
Notification: "Death Transfer Request for KA01AB1234"
Priority: HIGH (sensitive case)

Step 3.2: RTO Verifies Documents
────────────────────────────────
RTO checks:
  Death certificate authenticity
  Legal heir certificate validity
  Family relationship proof
  Court succession order

[DEMO] Document verification simulated

Step 3.3: RTO Generates Deceased Owner DID
──────────────────────────────────────────
Action: POST /api/did/deceased
Payload: {
    "originalOwnerId": "priya_user_id",
    "deathCertificateNumber": "DC-2024-123456"
}
Result: {
    "did": "did:biochain:deceased:abc123...",
    "status": "DECEASED",
    "deathCertificateNumber": "DC-2024-123456"
}


PHASE 4: RTO APPROVES INHERITANCE
═══════════════════════════════════════════════════════════════════════════════

Step 4.1: RTO Approves Transfer
───────────────────────────────
Action: PUT /api/inheritance/requests/{id}/approve
Payload: { "regNumber": "KA01AB1234" }

Backend Actions:
  1. Mark original owner as deceased in blockchain metadata
  2. Transfer ownership to legal heir
  3. Record transfer type: "inheritance"
  4. Attach legal documents (IPFS hashes)
  5. Generate new RC with special note

Smart Contract Logic:
IF (death_certificate_verified && legal_heir_verified) {
    vehicle.previousOwner = {
        did: "did:biochain:deceased:...",
        status: "DECEASED",
        deathDate: "2024-..."
    };
    vehicle.currentOwner = heirAddress;
    vehicle.transferHistory.push({
        type: "DEATH_TRANSFER",
        from: "Original Owner [Deceased]",
        to: "Legal Heir"
    });
}


PHASE 5: NOTIFICATION & NEW RC
═══════════════════════════════════════════════════════════════════════════════

Step 5.1: Legal Heir Notified
─────────────────────────────
Message: "Inheritance transfer approved. You are now the owner of KA01AB1234."

Step 5.2: New RC Generated
──────────────────────────
Special note on RC: "Transferred via legal heirship"
Previous owner: "[Deceased] Priya Sharma"
All legal documents attached as IPFS hashes


═══════════════════════════════════════════════════════════════════════════════
  FLOW 3 COMPLETE: Vehicle transferred to legal heir after owner's death
═══════════════════════════════════════════════════════════════════════════════
```

---

## FLOW 4: THEFT REPORTING & BLOCKING

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW 4: THEFT REPORTING                                  │
│                    (Instant vehicle blocking)                               │
└─────────────────────────────────────────────────────────────────────────────┘

PREREQUISITE: Rahul (Legal Heir) owns KA01AB1234


PHASE 1: OWNER REPORTS THEFT
═══════════════════════════════════════════════════════════════════════════════

Step 1.1: Owner Reports Vehicle Stolen
──────────────────────────────────────
Action: POST /api/theft/report
Headers: Authorization: Bearer {rahul_token}
Payload: {
    "vehicleId": "vehicle_id",
    "policeStation": "Bangalore Central Police Station",
    "firNumber": "FIR-2024-987654",
    "incidentDate": "2024-02-20",
    "incidentLocation": "MG Road, Bangalore",
    "description": "Vehicle stolen from parking lot"
}

[DEMO] Biometric: Owner fingerprint verification simulated
[DEMO] Document Upload: FIR copy uploaded


PHASE 2: INSTANT BLOCKING (Within 1 second)
═══════════════════════════════════════════════════════════════════════════════

Step 2.1: Blockchain Status Updated
───────────────────────────────────
Action: updateVehicleStatusOnChain("KA01AB1234", "stolen")
Result: Vehicle status changed to "STOLEN"

Smart Contract Rule Activated:
IF (vehicle.status == "stolen") {
    REJECT all transfer attempts;
    RETURN "ERROR - Vehicle is stolen, transfer BLOCKED";
}

Step 2.2: Vehicle Blocked in Database
─────────────────────────────────────
vehicle.status = "blocked"


PHASE 3: NATIONWIDE ALERTS (Multi-Channel)
═══════════════════════════════════════════════════════════════════════════════

Step 3.1: Real-time WebSocket Alerts
────────────────────────────────────
Emit to role:rto: "THEFT ALERT: KA01AB1234"
Emit to role:police: "THEFT ALERT: KA01AB1234"

Step 3.2: Email Notifications
─────────────────────────────
To all RTO officers: Theft alert email
To all Police officers: Theft alert email
To Owner: Confirmation email

Step 3.3: SMS Notifications
───────────────────────────
To RTO/Police: "  BIOCHAIN RTO ALERT: Vehicle KA01AB1234 reported STOLEN"

Step 3.4: In-app Notifications
──────────────────────────────
All RTO and Police dashboards show critical alert

Alert Message:
"Vehicle KA01AB1234 (Maruti Suzuki Swift) reported stolen.
FIR: FIR-2024-987654
Location: MG Road, Bangalore
   DO NOT PROCESS ANY TRANSFERS"


PHASE 4: POLICE VERIFICATION
═══════════════════════════════════════════════════════════════════════════════

Step 4.1: Police Officer Verifies Theft Report
──────────────────────────────────────────────
Action: GET /api/theft/reports
Police sees: Active theft report for KA01AB1234

Step 4.2: Police Updates Investigation Status
─────────────────────────────────────────────
Action: PUT /api/theft/reports/{id}
Payload: { "status": "under_investigation" }


PHASE 5: VEHICLE RECOVERY (Optional)
═══════════════════════════════════════════════════════════════════════════════

Step 5.1: Police Marks Vehicle Recovered
────────────────────────────────────────
Action: PUT /api/theft/reports/{id}
Payload: {
    "status": "recovered",
    "recoveryDate": "2024-02-25",
    "recoveryLocation": "Near Bus Stand, Bangalore"
}

Step 5.2: Blockchain Status Updated
───────────────────────────────────
Action: updateVehicleStatusOnChain("KA01AB1234", "active")
Result: Vehicle unblocked, transfers allowed

Step 5.3: Recovery Notifications Sent
─────────────────────────────────────
Owner receives: "  Your vehicle KA01AB1234 has been RECOVERED"


═══════════════════════════════════════════════════════════════════════════════
  FLOW 4 COMPLETE: Theft reported, vehicle blocked, alerts sent nationwide
═══════════════════════════════════════════════════════════════════════════════
```

---

## FLOW 5: POLICE VERIFICATION PORTAL

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    FLOW 5: POLICE VERIFICATION                              │
│                    (Real-time ownership check)                              │
└─────────────────────────────────────────────────────────────────────────────┘

SCENARIO: Police officer stops vehicle KA01AB1234 for verification


PHASE 1: OFFICER VERIFIES VEHICLE
═══════════════════════════════════════════════════════════════════════════════

Step 1.1: Police Officer Looks Up Vehicle
─────────────────────────────────────────
Action: GET /api/verification/vehicle/KA01AB1234
Headers: Authorization: Bearer {police_token}

Response:
{
    "regNumber": "KA01AB1234",
    "make": "Maruti Suzuki",
    "model": "Swift",
    "year": 2024,
    "status": "active",  // or "stolen"
    "isStolen": false,
    "currentOwner": {
        "name": "Rahul Sharma",
        "aadhaarNumber": "7890XXXX4567",
        "dlNumber": "KA78XXXX56"
    },
    "ownershipHistory": [
        { "from": "Dealer", "to": "Rajesh Kumar", "date": "...", "type": "new_registration" },
        { "from": "Rajesh Kumar", "to": "Priya Sharma", "date": "...", "type": "purchase" },
        { "from": "Priya Sharma [Deceased]", "to": "Rahul Sharma", "date": "...", "type": "inheritance" }
    ],
    "blockchainTxHash": "0x...",
    "blockchainOwner": "0x..."
}


PHASE 2: OFFICER VERIFIES PERSON
═══════════════════════════════════════════════════════════════════════════════

Step 2.1: Police Officer Looks Up Person by Aadhaar
───────────────────────────────────────────────────
Action: GET /api/verification/person/789012345678

Response:
{
    "person": {
        "name": "Rahul Sharma",
        "aadhaarNumber": "789012345678",
        "dlNumber": "KA7890123456"
    },
    "vehicles": [
        {
            "regNumber": "KA01AB1234",
            "make": "Maruti Suzuki",
            "model": "Swift",
            "status": "active"
        }
    ],
    "ownershipHistories": [...]
}


PHASE 3: BIOMETRIC VERIFICATION (Optional)
═══════════════════════════════════════════════════════════════════════════════

Step 3.1: Police Officer Uses Fingerprint to Identify
─────────────────────────────────────────────────────
[DEMO] Biometric: Officer scans person's fingerprint
Action: POST /api/police/lookup
Payload: { "userId": "rahul_user_id" }

[DEMO] System simulates fingerprint match
Result: Person identified as Rahul Sharma


═══════════════════════════════════════════════════════════════════════════════
  FLOW 5 COMPLETE: Police verified vehicle and owner in real-time
═══════════════════════════════════════════════════════════════════════════════
```

---

## DEMONSTRATION SCRIPT FOR INDUSTRIALISTS

### Pre-Demo Setup (5 minutes before)

```bash
# Terminal 1: Start MongoDB
mongod

# Terminal 2: (one-time) deploy the registry contract to Polygon Amoy
cd blockchain
npm install
npm run deploy        # prints the contract address; put it in backend/.env

# Terminal 3: Start Backend
cd backend
npm install           # If not done
npm run dev

# Terminal 4: Start Frontend
cd frontend
npm install           # If not done
npm run dev
```

The chain is the public Polygon Amoy testnet, so nothing has to be started locally
for it: the API talks to a public RPC node and every transaction link opens
amoy.polygonscan.com.

### Demo Flow (20 minutes total)

| Time  | Actor          | Action                       | Screen to Show                         |
| ----- | -------------- | ---------------------------- | -------------------------------------- |
| 0:00  | **Narrator**   | Introduction to BioChain RTO | Project Overview Slide                 |
| 2:00  | **Dealer**     | Register and login           | Dealer Registration Page               |
| 3:00  | **Owner A**    | Register as new user         | Owner Registration Page                |
| 4:00  | **Dealer**     | Sell vehicle to Owner A      | Dealer Dashboard → Create Request      |
| 5:00  | **System**     | Show real-time notification  | RTO Dashboard (split screen)           |
| 6:00  | **RTO**        | Approve request, assign RC   | RTO Dashboard → Approve                |
| 7:00  | **System**     | Show blockchain transaction  | Terminal showing tx hash               |
| 8:00  | **Owner A**    | View Digital RC              | Owner Dashboard → Documents            |
| 9:00  | **Narrator**   | Explain resale scenario      | Flow Diagram                           |
| 10:00 | **Owner B**    | Register as new buyer        | Registration Page                      |
| 11:00 | **Owner A**    | Initiate transfer to Owner B | Owner Dashboard → Transfer             |
| 12:00 | **System**     | Show notification to RTO     | RTO Dashboard Alert                    |
| 13:00 | **RTO**        | Approve transfer             | RTO Dashboard → Approve                |
| 14:00 | **System**     | Show updated blockchain      | Terminal showing transfer              |
| 15:00 | **Narrator**   | Explain inheritance scenario | Flow Diagram                           |
| 16:00 | **Legal Heir** | Submit inheritance claim     | Inheritance Form                       |
| 17:00 | **RTO**        | Verify and approve           | RTO Dashboard → Verify Docs            |
| 18:00 | **Narrator**   | Explain theft scenario       | Flow Diagram                           |
| 19:00 | **Owner**      | Report theft                 | Theft Report Form                      |
| 19:30 | **System**     | Show instant alerts          | Multiple screens showing notifications |
| 20:00 | **Police**     | Verify vehicle               | Police Dashboard → Lookup              |

### Key Talking Points

1. **Biometric Security**: "Every transaction requires fingerprint verification"
2. **Blockchain Immutability**: "Once recorded, ownership history cannot be altered"
3. **Real-time Alerts**: "Theft reports reach all RTOs and Police within seconds"
4. **Paperless**: "No more Form 29/30 - everything is digital"
5. **Transparency**: "Anyone can verify ownership on the blockchain"

---

## SIMULATION CONFIGURATION

### Current Simulation Mode (For Demo)

| Component           | Status     | Configuration                                                                              |
| ------------------- | ---------- | ------------------------------------------------------------------------------------------ |
| **Biometric**       | SIMULATION | No SDK path set; enrolment storage and consent gates are real                              |
| **Document Upload** | REAL       | Pinata, local IPFS daemon or the local content-addressed vault, SHA-256 re-checked on read |
| **Email**           | SIMULATION | Recorded in the server log, not sent, until SMTP credentials exist                         |
| **SMS**             | SIMULATION | Recorded in the server log, not sent, until Twilio credentials exist                       |
| **Blockchain**      | REAL       | Polygon Amoy testnet, contract 0x21F940c10FE9AbEA9eD67CE5689FBCa447701966                  |
| **Challan payment** | SIMULATION | Demo payment modal; no gateway is contacted                                                |

### Switch to Production (When Ready)

```bash
# Biometric SDK
BIOMETRIC_SDK_PROVIDER=digitalPersona
DIGITAL_PERSONA_SDK_PATH=C:\Program Files\DigitalPersona\SDK

# Email
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password

# SMS
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890

# IPFS
PINATA_API_KEY=your-pinata-key
PINATA_SECRET_KEY=your-pinata-secret
```

---

## API ENDPOINTS SUMMARY

### Authentication

- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login

### Vehicle Management

- `POST /api/requests/new-registration` - Dealer sells new vehicle
- `POST /api/requests/transfer` - Owner sells vehicle
- `GET /api/vehicles/my` - Get my vehicles

### RTO Operations

- `GET /api/requests/all` - View all pending requests
- `POST /api/requests/:id/approve` - Approve request
- `POST /api/requests/:id/reject` - Reject request

### Inheritance

- `POST /api/inheritance/request` - Submit inheritance claim
- `GET /api/inheritance/requests` - View inheritance requests
- `PUT /api/inheritance/requests/:id/approve` - Approve inheritance

### Theft Reporting

- `POST /api/theft/report` - Report vehicle stolen
- `GET /api/theft/reports` - View theft reports
- `PUT /api/theft/reports/:id` - Update theft status

### Police Verification

- `GET /api/verification/vehicle/:regNumber` - Verify vehicle
- `GET /api/verification/person/:identifier` - Verify person
- `POST /api/police/lookup` - Fingerprint lookup

### Documents

- `POST /api/upload/vehicle-document/:vehicleId` - Upload document
- `GET /api/upload/vehicle-documents/:vehicleId` - Get documents
- `GET /api/documents/rc/:vehicleId` - Get Digital RC

### Notifications

- `GET /api/notifications` - Get notifications
- `GET /api/notifications/unread` - Get unread notifications

### DID

- `GET /api/did/my-did` - Get my DID
- `GET /api/did/resolve/:did` - Resolve DID

---

## CHECKLIST FOR DEMO DAY

- [ ] MongoDB running
- [ ] Polygon Amoy RPC reachable (the API logs the connection at startup)
- [ ] Smart contract deployed and its address in `backend/.env`
- [ ] Backend server running (port 5000) and `/api/health` answering
- [ ] Frontend running (port 5173)
- [ ] Demo accounts seeded (`npm run seed:users` in backend)
- [ ] Demo intelligence data seeded (`npm run seed:intelligence`)
- [ ] Sample vehicle data ready
- [ ] Presentation slides prepared
- [ ] Backup plan (screenshots if live fails)

---

**END OF DOCUMENT**
