# BioChain RTO - Biometric and Blockchain Vehicle Lifecycle Management

A working replacement for the paper-and-counter RTO workflow: a citizen, a dealer,
a workshop, a police officer and an RTO officer all transact against the same
vehicle record, every action is tied to a fingerprint enrolment and a decentralized
identifier, and every record carries a SHA-256 content hash that is committed on
Polygon Amoy so nobody can quietly rewrite history.

It is modeled on what mParivahan does today and extends it in the places where the
existing system has no answer: who authorised a transfer, what happened to the car
between owners, whether a odometer reading or a part is genuine, and whether a
record still says what it said when it was written.

---

## 1. Stack

| Layer        | Choice                                                 | Port                      |
| ------------ | ------------------------------------------------------ | ------------------------- |
| Frontend     | React 19, TypeScript, Vite 7, React Router 7, Recharts | 5173                      |
| API          | Express 5, Mongoose 9, Socket.IO 4                     | 5000                      |
| Database     | MongoDB (`BioChainRTO`)                                | 27017                     |
| Contract     | Solidity `VehicleRegistry`, Hardhat                    | Polygon Amoy, chain 80002 |
| Chain access | ethers v6 against a public Amoy RPC                    | -                         |
| Runtime      | Node 22                                                | -                         |

The contract is deployed and its address is public:
`0x21F940c10FE9AbEA9eD67CE5689FBCa447701966` (explorer: amoy.polygonscan.com).

---

## 2. Run it

```bash
# 1. Database
mongod --dbpath <your data directory>

# 2. API
cd backend
copy .env.example .env        # then fill MONGO_URI, JWT_SECRET, WALLET_PRIVATE_KEY
npm install
npm start                     # or: npm run dev

# 3. Web app
cd ../frontend
copy .env.example .env
npm install
npm run dev                   # http://localhost:5173
```

MongoDB and the API are the only hard requirements. Every other integration
(Pinata IPFS, SMTP, Twilio, a hardware fingerprint SDK, a funded wallet) is
optional: when it is absent the feature says so on screen and in the response
instead of pretending to have worked.

To rebuild the registry contract from scratch:

```bash
cd blockchain
npm install
npm run compile
npm run deploy                # needs POLYGON_RPC_URL + WALLET_PRIVATE_KEY in blockchain/.env
```

---

## 3. Demo accounts

| Role             | Email                      | Password    | What to look at                                                         |
| ---------------- | -------------------------- | ----------- | ----------------------------------------------------------------------- |
| Owner            | `owner@biochain.com`       | `owner123`  | Vehicles held, transfer requests, Digital RC, accident evidence upload  |
| Owner (second)   | `owner2@biochain.com`      | `owner123`  | Receiving a transfer, inheritance claim as heir                         |
| Dealer           | `dealer@biochain.com`      | `dealer123` | New-vehicle sale, buyer acceptance, resale listing                      |
| Workshop         | `maruti.demo@workshop.com` | `demo123`   | Service, odometer, parts, damage and battery submissions (brand-locked) |
| RTO officer (KA) | `ka.rto@biochain.com`      | `ka123`     | Approvals, challans, inheritance, inter-state transfers                 |
| RTO officer (TN) | `tn.rto@biochain.com`      | `tn123`     | The same console from another state                                     |
| Police           | `police@biochain.com`      | `police123` | Roadside verification, theft reports, accident review, investigations   |

Seed or repair them at any time:

```bash
npm run seed:users          # accounts, DIDs, fingerprint enrolments
npm run seed:idcards        # digital identity cards
npm run seed:intelligence   # demo vehicles, service history, cases
```

All three are idempotent - they add what is missing and never delete live data.

---

## 4. Pages

`/` landing, `/login`, `/register` (ID document OCR pre-fills the form),
`/owner`, `/owner-profile`, `/dealer`, `/dealer-profile`, `/workshop`,
`/rto`, `/rto-setup`, `/rto-profile`, `/police`, `/police-profile`,
`/vehicle-history/:vehicleId`, `/documents`, `/rc-card/:vehicleId`,
`/invoice/:requestId`, `/search`, `/analytics`, `/investigations`,
`/transfer-approvals`.

Each dashboard is gated by role; an unauthorised path redirects to login.

---

## 5. What the system does

### Core RTO operations

- **New vehicle registration** - a dealer sells a vehicle, the buyer accepts, the
  RTO approves, and the vehicle is written to the `VehicleRegistry` contract. The
  approval produces a real transaction hash and a downloadable RC certificate.
- **Ownership transfer** - both parties authenticate with a fingerprint check
  before the request is filed; the RTO approves; ownership history is kept per
  transfer with its own chain reference.
- **Inter-state transfer** - a passport-style record moves a vehicle between two
  state officers, each with their own jurisdiction view.
- **Inheritance transfer** - the heir files with a death certificate and
  relationship proof; documents are stored content-addressed and re-verified on
  every read; the officer must view each document before verifying it.
- **Theft report and recovery** - reporting a theft blocks transfers immediately
  and pushes a critical alert to every RTO and police account, live over Socket.IO.
- **Owner accident evidence** - the owner uploads dashcam video or photos with the
  accident details and FIR or station; police and RTO stream the exact bytes back
  through the same content check, and re-check the uploader's fingerprint before
  the report is accepted.
- **Challan management** - issue, pay (demo payment), invoice, and settle.
- **Documents and Digital RC** - uploads land in Pinata, a local IPFS daemon or the
  built-in content-addressed vault, in that order of preference. Whatever holds the
  bytes, the SHA-256 is recomputed on read and a mismatch is refused.
- **Analytics** - registration, transfer, theft and challan trend charts for
  officers.

### Eight vehicle-intelligence features

1. **Verified service and odometer history** - only an affiliated workshop of the
   vehicle's own manufacturer may submit; a suspicious odometer jump is flagged,
   never silently accepted.
2. **Critical parts provenance** - serialised parts are tracked per vehicle with
   the workshop that fitted them.
3. **Fraud investigation casebook** - an officer opens a case on a vehicle,
   attaches evidence files, and every case record is hash-committed on chain.
4. **Transaction anomaly detection** - scoring over transfer velocity, ownership
   churn, odometer inconsistency and document mismatch; surfaced as leads, never as
   an auto-decision.
5. **Cross-record identity cloning detection** - finds two records claiming the same
   chassis or engine number.
6. **Damage and repair passport** - a cumulative, tamper-evident damage history a
   buyer can read.
7. **EV battery passport** - state-of-health records with their own anchor.
8. **Conditional multi-party transfer approval** - a configurable checklist that
   must be fully approved before a transfer can be finalised; the backend validates
   every state transition rather than trusting the UI.

### Identity and evidence layer

- Every account has a decentralized identifier (DID) with a resolvable document and
  a fingerprint enrolment stored in the `biometrictemplates` collection - durable,
  so a restart does not silently wipe identity.
- A finalized record is hashed with a canonical SHA-256 over its immutable content
  only. Status changes, officer notes and action arrays do not alter the hash, so a
  legitimate workflow step never looks like tampering.
- That hash is committed on Polygon Amoy and the anchor status is one of
  `hashed_only`, `pending`, `anchored` or `failed`, with a reason recorded whenever
  it is not `anchored`. Every "View Transaction" link points at a transaction that
  actually exists; anything unproven is labelled honestly and not linked.
- The integrity audit can re-verify all of it, including against the chain itself.

---

## 6. Verifying it yourself

### Test suites (run against a live API; each one cleans up after itself)

```bash
cd backend
npm test                 # A-to-Z sweep, every role and flow        81 checks
npm run test:features    # intelligence features 2-8 smoke test      34 checks
npm run test:documents   # document store without external IPFS      27 checks
npm run test:accidents   # accident evidence + officer review        48 checks
npm run test:idcard      # OCR, registration, digital ID card        23 checks
npm run test:intel       # intel requests, resale, approvals          27 checks
npm run test:intelligence # service and odometer history              16 checks
# or all seven in order:
npm run test:all
```

256 assertions, no failures, no manual fixture setup: the suites log in as the
demo accounts, exercise the endpoints, read uploaded bytes back and compare them
byte for byte, and delete every record they create.

### Integrity audit

```bash
npm run audit          # read-only report
npm run audit:fix      # repair what can be repaired without inventing anything
npm run audit:chain    # also ask a Polygon Amoy node to confirm every tx hash
```

Seven questions: do references resolve, do hashes still match, does every recorded
chain commitment exist on chain, does every stored document resolve and re-hash, is
anything orphaned, would a unique index be violated, and is any field the API
filters by unindexed. The chain pass fetches each transaction, checks that a
record's hash is really inside its input data (or that a vehicle entry called the
registry contract with the right registration number), certifies what it can and
withdraws what it cannot.

### Frontend gates

```bash
cd frontend
npm run lint    # clean
npm run build   # clean, type-checked, chunked
```

---

## 7. Configuration

`backend/.env.example` and `frontend/.env.example` list every variable with a note
on whether it is required. Required: `PORT`, `MONGO_URI`, `JWT_SECRET`. Chain:
`POLYGON_RPC_URL`, `CONTRACT_ADDRESS`, `WALLET_PRIVATE_KEY`,
`POLYGONSCAN_BASE_URL`. Optional: Pinata, SMTP, Twilio, biometric SDK paths.
Secrets are never committed; `.env` is ignored and the repository ships only the
examples.

---

## 8. Honest limits

A reviewer should read this section before judging anything.

- **The anchor wallet is not funded.** It holds about 0.0002 POL, which cannot pay
  Amoy's minimum priority fee for a commit. New records are therefore recorded as
  `pending` with the reason stored beside them. Top the wallet up from a testnet
  faucet and the next anchor pass commits them; nothing needs to be rewritten.
  Everything marked `anchored` in the current database has been confirmed by a node.
- **Committing a record hash uses transaction calldata, not a contract call.** The
  registry contract has no method for arbitrary records and no payable fallback, so
  a hash is published as the input data of a real transfer from the anchor wallet to
  itself. The content is publicly committed and independently checkable; it is not
  validated by contract logic.
- **The fingerprint match is a simulation.** The capture, enrolment storage,
  template pointers and consent gates are real; the comparison returns a 95%
  similarity by design. Point `BIOMETRIC_SDK_PROVIDER` and the matching SDK path at
  Secugen, Mantra, Morpho or DigitalPersona hardware and the same code path uses
  the device.
- **Document storage is decentralized only if Pinata or a local IPFS daemon is
  configured.** Otherwise bytes live in `backend/uploads/documents/`, content
  addressed and re-hashed on read - tamper-evident, but on one disk.
- **Email and SMS are logged, not sent**, until SMTP or Twilio credentials exist.
- **Challan payment is a demo flow.** No gateway is contacted and no money moves.
- **OCR quality depends on the photograph.** A blurry government ID returns partial
  fields; the citizen confirms or corrects them, and the image itself is never
  stored.
- An earlier version of this project committed a wallet private key and an API key
  in `.env`. Those files are out of version control now, but the values are still
  in git history: rotate the wallet key and revoke the API key before any real use.

---

## 9. Layout

```
backend/          Express API, models, services, audit, seeds, test suites
  src/routes/     21 route modules, mounted under /api
  src/models/     19 Mongoose models
  src/services/   23 services: blockchain, anchoring, DID, biometrics, storage, intelligence
  src/audit-database.js       integrity engine
frontend/         React app: pages, components, context, services
blockchain/       Hardhat project, VehicleRegistry.sol, deploy script
demo-seed/        standalone demo scripts for reviewers
```

Further reading, in the order that makes sense: `DEMONSTRATION_FLOW.md` (a
scenario-by-scenario walkthrough), `BIOMETRIC_VISUAL_FLOW.md` and
`BIOMETRIC_SIMULATION_GUIDE.md` (how the biometric path behaves), `TEST_WORKFLOW.md`
(how the suites fit together). `FIXES_APPLIED.md` and
`IMPLEMENTATION_COMPLETE.md` are dated snapshots of earlier phases - this README is
the current one.
