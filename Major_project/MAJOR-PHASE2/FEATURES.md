# BioChain RTO — Industrial Feature Documentation

Every capability below is backed by a real Express route, a real MongoDB
collection and a real React console. Nothing in this document describes a
planned feature; each entry names the files that implement it.

# 1. Core Intelligence Modules (industry-level dashboards)

## 1.1 Smart Interstate Migration Orchestrator

Turns the conventional inter-state transfer into a dependency-ordered,
two-state workflow with full audit history.

| Layer   | Files                                               |
| ------- | --------------------------------------------------- |
| Console | `frontend/src/pages/SmartMigrationOrchestrator.tsx` |
| API     | `backend/src/routes/migrationRoutes.js`             |
| Model   | `backend/src/models/SmartMigration.js`              |
| Engine  | `backend/src/services/smartMigrationService.js`     |

Dashboard (all values computed live from `SmartMigration` documents):

- **KPI strip** — Total · In progress · Awaiting source RTO · Awaiting
  destination RTO · Completed · Open exceptions. Every card is clickable and
  filters the applications table.
- **Analytics** (`GET /api/migration/analytics`, RTO/admin): applications by
  month (12-month zero-filled), state-to-state migration trends (top 8 pairs),
  applications by workflow status, completed vs pending, and average processing
  duration derived from recorded `createdAt`/`updatedAt` dates. Clicking a pie
  wedge or a route bar filters the table; filter chips show the active filter.
- **Applications table** — searchable, sortable, paginated
  (`DataTable` from the shared design system) with migration ID, vehicle,
  route, status pill and a View action.

Workspace (opens on any record, three columns as specified):

- **Left — Vehicle & migration identity:** registration, make/model/year,
  chassis and engine numbers (popped from the live vehicle), current owner,
  source/destination state, migration ID, re-run pre-check.
- **Middle — Migration journey:** every stage rendered as a timeline with its
  status colour, timestamp (`startedAt`/`completedAt`), owning role and state
  RTO, and the officer's remarks.
- **Right — Alerts & required actions:** NOC deadline countdown (turns red at
  ≤3 days), missing documents from the cross-document audit, stages awaiting
  action, unresolved source-vs-destination inconsistencies, and failed
  readiness checks.

Premium module screens (A–G) — a module tab bar appears on any open record, so
the migration reads as one professional application rather than a single form.
Every screen renders from the data already returned by `GET /api/migration/:id`
(shared `components` in `frontend/src/lib/MigrationPremium.tsx`):

- **Dashboard card view** — `MigrationCardGrid` renders each application as a
  reusable card (ID, status pill, route, stage progress bar, current stage,
  last update); toggle between Cards and Table without losing chart filters.
- **A · Eligibility Centre** — `ComplianceGrid`: one verification card per
  readiness check with an expandable detail + verification source, then a
  Migration Readiness summary card (checks completed x/y, pending, recommendation).
- **B · Document Intelligence** — `DocumentSplitView`: document list on the
  left, extracted-field cards + integrity hash + OCR confidence + match /
  mismatch / needs-review observations on the right; upload + human verify.
- **C · Two-State RTO Coordination** — `TwoStateFlow`: an interactive React
  Flow diagram chaining source-side and destination-side stages with a labelled
  "NOC gate" edge; locked stages render grey. Officer approve/re-register actions
  stay role-gated underneath.
- **D · State-Wise Tax & Fee** — `CostBreakdown`: itemised cost cards + a fee-
  composition donut, always showing the rule source/effective date; no amount is
  invented when a rule is unavailable.
- **E · Deadline Command Centre** — `DeadlineCalendar`: a real month calendar
  marking NOC expiry, stage starts/completions and record updates from actual
  dates, with the live countdown banner.
- **F · Digital Migration Passport** — `PremiumPassport`: a designed navy
  identity card with vehicle identity, route, status, an access-controlled QR
  reference and the integrity-match badge (QR resolves to a verification page,
  never private data).
- **G · Reconciliation** — `ReconcileCompare`: source-vs-destination record
  cards, field-by-field match/mismatch/needs-confirmation cards, and exception
  cards routed for officer review (the source record is never edited to hide a
  mismatch).

Supporting screens wired end-to-end:

- Eligibility **pre-check** with per-check explanations (`/precheck`).
- **AI Document Intelligence** — OCR extraction cards with confidence,
  side-by-side comparison against the vehicle record, mismatch highlighting
  (never auto-accept), human verify/correct, and Form 28/27 auto-drafts with
  per-field provenance (`/documents`, `/verify`, `/reclassify`, `/doc-audit`).
- **Source RTO workflow** — approve/reject with remarks; NOC issuance starts
  the deadline clock.
- **Destination RTO workflow** — locked until the source NOC exists; passport
  verification then re-registration.
- **State-wise tax estimator** — prices come only from the maintained
  `STATE_MIGRATION_RULES` table, with rule source and effective date shown;
  unsupported cost heads are listed, never invented.
- **Vehicle Migration Passport** — hash-chained passport (`GET /:id/passport`) that
  the destination state re-verifies; integrity check shown explicitly.
- **Final reconciliation** — post-transfer comparison with exception routing
  and officer resolution (`/exceptions/resolve`).

Guarantee: a stage only advances when its dependencies are approved, and an
officer of one state can never act on the other state's stage. No button
click marks a real government approval complete — every decision is stored
with actor, role, remarks and timestamp in `eventHistory`.

## 1.2 3D Vehicle Damage & Repair Intelligence

An interactive damage-inspection application, not an accident form.

| Layer            | Files                                                    |
| ---------------- | -------------------------------------------------------- |
| Console          | `frontend/src/pages/DamageIntelligence.tsx`              |
| 3D viewer        | `frontend/src/components/VehicleDamageViewer.tsx`        |
| API              | `backend/src/routes/damageRoutes.js`                     |
| Models           | `DamageAssessment`, `DamageEvent`, `RepairCostCatalogue` |
| Analysis adapter | `backend/src/services/damageAnalysisService.js`          |

Workspace (nine labelled steps, each stating its honesty boundary):

1. **Analysis** — pluggable CV engine; with no endpoint configured the server
   returns _manual mode_ and produces no automated findings.
2. **Photographs & detection annotations** — multi-photo upload per view
   (front/rear/sides/close-up); findings genuinely linked to a frame render
   as annotation chips over the photo (component + confidence), clickable to
   jump to that part in the 3D model. No fabricated bounding boxes — the
   annotation layer only shows what the assessor or engine actually recorded.
3. **Interactive 3D assessment** — React Three Fiber vehicle with **25
   individually selectable component meshes**; drei `OrbitControls` for
   360° rotate / zoom / pan; preset cameras (Isometric/Front/Rear/Left/
   Right/Top); original-vs-highlighted toggle; severity colour ramp with a
   legend; unassessed parts stay neutral grey and are never shown as
   "undamaged"; unmapped findings are listed separately instead of being
   pretended onto the model.
4. **Recorded findings** — source (CV / manual / owner-reported), confidence,
   correction history (a correction never erases the original value).
5. **Repair estimate** — itemised strictly from the configurable
   `RepairCostCatalogue`; components without a configured price are flagged
   "no catalogue price", never given an invented number.
6. **Authorised review** — approve / reject / request-evidence, stored as
   distinct decision stages.
7. **Completion evidence** — workshop uploads real photographs and work summary.
8. **Before/after comparison** — damage photos vs completion evidence
   side-by-side, labelled as workshop-submitted until a passed inspection.
9. **Final inspection & verification** — verification requires a passed
   inspection _and_ attached evidence; a hash check proves only that the
   recorded assessment is unchanged, and the page says so.

## 1.3 Vehicle Lifecycle Forensics & Event Replay Engine

A read-only investigator console: it reconstructs, never rewrites.

| Layer   | Files                                      |
| ------- | ------------------------------------------ |
| Console | `frontend/src/pages/VehicleForensics.tsx`  |
| API     | `backend/src/routes/forensicsRoutes.js`    |
| Engine  | `backend/src/services/forensicsService.js` |

- **KPI strip** built from the live integrity summary: reconstructed events,
  on-chain anchored, hashed-only, no-proof, open findings.
- **Event replay** — every event from every collection (registration,
  transfers, challans, accidents, maintenance, battery cycles…) normalised
  into a sequenced ledger; click an event to see the full vehicle state it
  produced.
- **Before/after compare** — pick any two events; the engine diffs the
  reconstructed states and names the sequence that introduced each change.
- **Event Dependency Graph** — React Flow canvas (pan/zoom/minimap) with one
  node per event coloured by status and labelled edges showing what depends
  on what; clicking a node selects that event.
- **Inconsistency detection** — conflicts carry the disputed field, first
  appearance, involved and dependent events with plain-language explanations.
- **Report** — structured findings + `Print / Save PDF` (print isolation via
  a body class so only the report renders on paper).
- Integrity vocabulary is exact: a valid hash proves _unchanged since
  hashing_, never truthfulness; blockchain status is shown only after real
  verification.

## 1.4 Vehicle Identity & Fraud Intelligence Centre

Explainable rules first; every score carries its reasoning.

| Layer    | Files                                                 |
| -------- | ----------------------------------------------------- |
| Console  | `frontend/src/pages/FraudInvestigations.tsx`          |
| API      | `backend/src/routes/investigationRoutes.js`           |
| Services | `transactionAnomalyService`, `identityCloningService` |

- **Overview** (`GET /api/investigations/stats`): KPI cards — cases total /
  open / resolved, high-priority, anomalies pending review, identity
  conflicts — plus charts: cases by month, anomalies by severity (click a
  wedge to see the breakdown), conflicts by type.
- **Casebook** — full case lifecycle (create, assign, note, status transitions)
  with permission-controlled actions and a visible audit trail; a case can be
  linked to a forensics reconstruction.
- **Anomaly panel** — scans real transaction records and reports _why_ each
  anomaly was raised (rule, weight, evidence); risk bands Low…Critical are
  risk indications, never validated fraud probabilities.
- **Cloning panel** — side-by-side identity comparison (chassis/engine/reg
  conflicts across records) showing exactly which fields disagree and where
  each value was recorded.

# 2. Patent Feature Console (`/patent-features`)

`frontend/src/pages/PatentFeatures.tsx` drives the eight engines on
`backend/src/routes/patentFeaturesRoutes.js` live, with results rendered
exactly as returned (summary rows + raw payload):

1. **Biometric + DID Binding** — template hashing, DID creation, mismatch
   rejection (simulated templates, labelled as such).
2. **Explainable Fraud Scoring** — per-check weighted rule analysis of user
   behaviour and transactions.
3. **Multi-Authority Consensus** — no single click completes a high-impact
   action; approvals require the configured quorum.
4. **Lifecycle State Machine** — governed vehicle states; illegal transitions
   refused; police-only freeze path.
5. **Privacy-Preserving Ownership Verification** — role-aware answers without
   exposing identity numbers; hash-commitment ZKP demonstration (labelled).
6. **Cross-State Interoperability** — signed Vehicle Passport generation and
   re-verification (the engine behind the Migration Orchestrator's passport).
7. **Predictive Theft Detection** — factorised risk with every factor shown;
   auto-freeze execution restricted to police.
8. **Ownership Reputation** — transparent score with factor breakdown and
   badge lookup.

# 3. Integrated Vehicle Tabs

Reachable from Search → Vehicle History (`frontend/src/pages/VehicleHistory.tsx`),
each backed by its own routes in `vehicleIntelligenceRoutes.js`:

- **Service & Odometer** — workshop/RTO records with tamper-evident history
  and odometer-correction detection.
- **Parts Provenance** — part installations with source/invoice references and
  blockchain claims.
- **Damage Passport** — verified damage events fed by the 3D module.
- **EV Battery Passport** — cycle life, SOH trajectory and ownership trail.

Role consoles (ID card, dual biometric, accident evidence, challans,
inheritance, resale) each exist as full pages/components under
`frontend/src/pages` and `frontend/src/components` with dedicated routes.

# 4. Shared Foundations

- **Design system** — `frontend/src/lib/ui.tsx` (KpiCard/KpiStrip, DataTable
  with search/sort/paginate, SectionCard, StatusPill, loading/empty/error
  states) on tokens in `frontend/src/lib/ui-tokens.ts`; one visual language
  across all four consoles.
- **Charts** — recharts, click-to-filter everywhere analytics appear.
- **3D** — @react-three/fiber v9 + @react-three/drei v10.
- **Graph** — @xyflow/react v12 (React Flow).
- **Trust rules honoured platform-wide** — KPIs from real records only;
  AI/OCR output always shown with confidence and a human-correction path;
  prices/fees only from configured tables; blockchain status only after
  verification; every state-changing action permission-checked, role-scoped
  and audit-logged.

Run: `backend` `npm run dev` (MongoDB required) · `frontend` `npm run dev` ·
blockchain anchor: `hardhat node` + deploy per `blockchain/README` settings.
