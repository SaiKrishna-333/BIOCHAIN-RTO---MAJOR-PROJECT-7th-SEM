// SmartMigrationOrchestrator.tsx
// BioChain Smart Migration Orchestrator console.
//
// One screen that turns the conventional inter-state transfer into an intelligent,
// dependency-ordered, auditable migration: a readiness pre-check, OCR document
// intelligence with Form 28/27 drafts, a two-state RTO coordination tracker, a
// configurable (clearly-labelled) tax estimate, a NOC deadline countdown, the
// consolidated migration passport, and post-transfer reconciliation with exception
// routing. Owners start and follow a migration; RTO officers act only on the stage
// their own state owns, and the destination stage is not actionable until the source
// NOC is recorded. Nothing here claims a government integration or an official tax -
// estimates and simulated officer decisions are labelled as such.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/useAuth";
import DashboardLayout from "../components/DashboardLayout";
import { formatDate, formatMoney, enumLabel } from "../lib/display";
import { notify } from "../lib/notify";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
  PieChart,
  Pie,
} from "recharts";
import {
  KpiCard,
  KpiStrip,
  DataTable,
  StatusPill,
  SectionCard,
  type Column,
} from "../lib/ui";
import { BIO, toneForStatus } from "../lib/ui-tokens";
import {
  MigrationCardGrid,
  TwoStateFlow,
  DeadlineCalendar,
  PremiumPassport,
  ComplianceGrid,
  ReconcileCompare,
  CostBreakdown,
  DocumentSplitView,
} from "../lib/MigrationPremium";

// Module navigation for the orchestrator. "workspace" is the default 3-column
// identity/journey/alerts view; the rest are the seven premium module screens.
const MODULE_TABS: { id: string; label: string }[] = [
  { id: "workspace", label: "Workspace" },
  { id: "precheck", label: "A · Eligibility" },
  { id: "documents", label: "B · Documents" },
  { id: "workflow", label: "C · Two-State RTO" },
  { id: "tax", label: "D · Tax & Fees" },
  { id: "deadlines", label: "E · Deadlines" },
  { id: "passport", label: "F · Passport" },
  { id: "reconciliation", label: "G · Reconciliation" },
];

// Every API failure is read through this shape, so the reason the server gave is
// shown instead of axios' generic status text.
type ApiError = { response?: { data?: { message?: string } } };
const errMessage = (err: unknown, fallback: string): string => {
  const e = err as ApiError;
  return e?.response?.data?.message || fallback;
};

type Check = {
  key: string;
  label: string;
  result: "passed" | "warning" | "blocked" | "needs_review";
  detail?: string;
  sourceLabel?: string;
};
type Stage = {
  key: string;
  title: string;
  description?: string;
  ownerRole?: string | null;
  ownerState?: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string;
  actorName?: string | null;
  remarks?: string | null;
};
type Doc = {
  name: string;
  category: string;
  reviewStatus: string;
  ocrConfidence?: number;
  integrityHash?: string;
  discrepancies?: string[];
  observations?: string[];
  extracted?: { name?: string; state?: string; documentType?: string };
};
type Cost = {
  label?: string;
  destinationRoadTax?: number | null;
  registrationFee?: number | null;
  estimatedTotal?: number | null;
  ruleSource?: string;
  ruleEffectiveDate?: string;
  unsupported?: string[];
};
type Exception = {
  field: string;
  sourceValue: string;
  destinationValue: string;
  severity: string;
  message?: string;
  resolved?: boolean;
};
type Migration = {
  _id: string;
  migrationId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  vehicle?: {
    _id: string;
    regNumber: string;
    make: string;
    model?: string;
    year?: number;
    chassisNumber?: string;
    engineNumber?: string;
  };
  owner?: { name: string; email: string; _id?: string } | string;
  origin: { stateCode: string; stateName: string; regNumber: string };
  destination: {
    stateCode: string;
    stateName: string;
    newRegNumber?: string;
    newAddress?: string;
  };
  readiness?: {
    verdict: string;
    summary: string;
    recommendation: string;
    checks: Check[];
  };
  costEstimate?: Cost;
  deadline?: {
    expiresAt?: string;
    daysRemaining?: number;
    validityDays?: number;
    nextAction?: string;
  };
  passport?: { passportId?: string; hash?: string };
  stages: Stage[];
  documents: Doc[];
  documentAudit?: {
    status?: string;
    missing?: string[];
    lines?: { topic?: string; verdict?: string; detail?: string }[];
    auditedAt?: string;
  } | null;
  formDrafts?: { checklist?: string[] };
  reconciliation?: { verdict: string; notes?: string };
  exceptions?: Exception[];
  eventHistory?: {
    at: string;
    action: string;
    actorRole?: string;
    note?: string;
  }[];
};
type PreCheck = {
  verdict: string;
  summary: string;
  recommendation: string;
  checks: Check[];
  originState?: string;
  costEstimate?: Cost;
};
type Stats = {
  total?: number;
  blocked?: number;
  inProgress?: number;
  completed?: number;
  exceptions?: number;
};
type PassportResponse = {
  passport: Record<string, unknown>;
  passportHash: string;
  storedHash?: string | null;
  matches?: boolean | null;
};
type ListVehicle = {
  _id: string;
  regNumber: string;
  make: string;
  model?: string;
};
type Analytics = {
  totalMigrations: number;
  byMonth: { key: string; label: string; count: number }[];
  statePairs: { from: string; to: string; label: string; count: number }[];
  statusDist: { status: string; count: number }[];
  completion: {
    completed: number;
    inProgress: number;
    rejected: number;
    blocked: number;
  };
  avgDurationDays: number | null;
};

const CHECK_COLOR: Record<string, string> = {
  passed: "role-rto",
  warning: "role-dealer",
  blocked: "role-reject",
  needs_review: "role-owner",
};
const STAGE_BADGE: Record<string, string> = {
  approved: "role-rto",
  completed: "role-rto",
  rejected: "role-reject",
  locked: "role-dealer",
  under_review: "role-owner",
  submitted: "role-owner",
  documents_required: "role-dealer",
};
// The moment a stage last moved, for the journey timeline.
const stageTime = (s: Stage): string => s.completedAt || s.startedAt || "";
const VERDICT_COLOR: Record<string, string> = {
  ready: "role-rto",
  consistent: "role-rto",
  conditional: "role-dealer",
  warning: "role-dealer",
  needs_review: "role-owner",
  blocked: "role-reject",
  exception: "role-reject",
};

export default function SmartMigrationOrchestrator() {
  const { api, user } = useAuth();
  const role = user?.role;
  const myState = user?.rtoDetails?.stateCode;

  const [stats, setStats] = useState<Stats>({});
  const [vehicles, setVehicles] = useState<ListVehicle[]>([]);
  const [states, setStates] = useState<{ code: string; name: string }[]>([]);
  const [form, setForm] = useState({
    vehicleId: "",
    destinationState: "",
    newAddress: "",
    vehicleCategory: "private",
    relocationReason: "",
  });
  const [precheck, setPrecheck] = useState<PreCheck | null>(null);
  const [list, setList] = useState<Migration[]>([]);
  const [selected, setSelected] = useState<Migration | null>(null);
  const [busy, setBusy] = useState(false);
  const [newReg, setNewReg] = useState("");
  const [remarks, setRemarks] = useState("");
  const [passport, setPassport] = useState<PassportResponse | null>(null);
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [routeFilter, setRouteFilter] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [moduleTab, setModuleTab] = useState<string>("workspace");
  const [listView, setListView] = useState<"cards" | "table">("cards");

  const loadStats = useCallback(async () => {
    try {
      const r = await api.get("/migration/stats/overview");
      setStats(r.data);
    } catch {
      /* the KPI strip is decoration; never blocks the page */
    }
  }, [api]);

  // Charts are an RTO/admin view; owners see their own list, not platform-wide
  // analytics, so the request is skipped entirely for them.
  const loadAnalytics = useCallback(async () => {
    if (role !== "rto" && role !== "admin") return;
    try {
      const r = await api.get("/migration/analytics");
      setAnalytics(r.data);
    } catch {
      /* analytics are additive; a failure never blocks the console */
    }
  }, [api, role]);

  const loadList = useCallback(async () => {
    try {
      const path =
        role === "owner" ? "/migration/my-migrations" : "/migration/queue";
      const r = await api.get(path);
      const rows: Migration[] = r.data || [];
      setList(rows);
      // Keep the open detail in sync, so an approval refreshes the tracker at once.
      setSelected((cur) =>
        cur && rows.some((x) => x._id === cur._id)
          ? rows.find((x) => x._id === cur._id) || cur
          : cur,
      );
    } catch (err: unknown) {
      notify(errMessage(err, "Could not load migrations"), "error");
    }
  }, [api, role]);

  useEffect(() => {
    loadStats();
    loadList();
    loadAnalytics();
    (async () => {
      try {
        const s = await api.get("/inter-state/states");
        setStates(s.data || []);
        if (role === "owner") {
          const v = await api.get("/vehicles/my");
          setVehicles(v.data || []);
        }
      } catch {
        /* a missing list only empties a dropdown */
      }
    })();
  }, [role, api, loadStats, loadList, loadAnalytics]);

  const openDetail = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const r = await api.get(`/migration/${id}`);
        setSelected(r.data);
      } catch (err: unknown) {
        notify(errMessage(err, "Could not open migration"), "error");
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const runPreCheck = async () => {
    if (!form.vehicleId || !form.destinationState) {
      notify("Choose a vehicle and a destination state first.", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post("/migration/precheck", {
        vehicleId: form.vehicleId,
        destinationState: form.destinationState,
      });
      setPrecheck(r.data);
    } catch (err: unknown) {
      notify(errMessage(err, "Pre-check failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const startMigration = async () => {
    setBusy(true);
    try {
      const r = await api.post("/migration/create", form);
      notify(`Migration ${r.data.migration.migrationId} started.`, "success");
      setPrecheck(null);
      setForm({
        vehicleId: "",
        destinationState: "",
        newAddress: "",
        vehicleCategory: "private",
        relocationReason: "",
      });
      await Promise.all([loadList(), loadStats()]);
      await openDetail(r.data.migration._id);
    } catch (err: unknown) {
      notify(errMessage(err, "Could not start migration"), "error");
    } finally {
      setBusy(false);
    }
  };

  const recheck = async (id: string) => {
    setBusy(true);
    try {
      const r = await api.post(`/migration/${id}/recheck`, {});
      const fresh: Migration =
        r.data.migration || (await api.get(`/migration/${id}`)).data;
      setSelected(fresh);
      notify(
        `Pre-check now: ${enumLabel(r.data.verdict)}.`,
        r.data.verdict === "blocked" ? "error" : "success",
      );
      await loadList();
    } catch (err: unknown) {
      notify(errMessage(err, "Re-check failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const uploadDoc = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selected) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("document", file);
      fd.append("category", "address");
      fd.append("name", file.name);
      await api.post(`/migration/${selected._id}/documents`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      notify("Document read by OCR and compared with the record.", "success");
      await openDetail(selected._id);
    } catch (err: unknown) {
      notify(errMessage(err, "Upload failed"), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const verifyDoc = async (index: number) => {
    if (!selected) return;
    setBusy(true);
    try {
      await api.post(
        `/migration/${selected._id}/documents/${index}/verify`,
        {},
      );
      notify("Document verified.", "success");
      await openDetail(selected._id);
    } catch (err: unknown) {
      notify(errMessage(err, "Verification failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const submitApplication = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.post(
        `/migration/${selected._id}/submit-application`,
        {},
      );
      setSelected(r.data.migration);
      notify("Application filed with the source RTO.", "success");
      await Promise.all([loadList(), loadStats()]);
    } catch (err: unknown) {
      notify(errMessage(err, "Submit failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const sourceApprove = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.post(`/migration/${selected._id}/source-approve`, {
        remarks,
      });
      setSelected(r.data.migration);
      notify("NOC issued; the destination stage is now actionable.", "success");
      setRemarks("");
      await Promise.all([loadList(), loadStats()]);
    } catch (err: unknown) {
      notify(errMessage(err, "NOC failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const destinationApprove = async () => {
    if (!selected) return;
    if (!newReg) {
      notify("Enter the new registration number.", "error");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post(
        `/migration/${selected._id}/destination-approve`,
        { newRegNumber: newReg, remarks },
      );
      setSelected(r.data.migration);
      notify(
        r.data.migration.reconciliation?.verdict === "consistent"
          ? "Migration completed and reconciled."
          : `Re-registered; ${r.data.migration.exceptions?.length || 0} exception(s) to review.`,
        "success",
      );
      setNewReg("");
      setRemarks("");
      await Promise.all([loadList(), loadStats()]);
    } catch (err: unknown) {
      notify(errMessage(err, "Destination approval failed"), "error");
    } finally {
      setBusy(false);
    }
  };

  const viewPassport = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.get(`/migration/${selected._id}/passport`);
      setPassport(r.data);
    } catch (err: unknown) {
      notify(errMessage(err, "Could not build the passport"), "error");
    } finally {
      setBusy(false);
    }
  };

  const resolveException = async (index: number) => {
    if (!selected) return;
    setBusy(true);
    try {
      const r = await api.post(
        `/migration/${selected._id}/exceptions/${index}/resolve`,
        { note: "Reviewed and cleared by officer" },
      );
      setSelected(r.data.migration);
      notify("Exception cleared.", "success");
    } catch (err: unknown) {
      notify(errMessage(err, "Could not resolve the exception"), "error");
    } finally {
      setBusy(false);
    }
  };

  const downloadReport = () => {
    if (!selected) return;
    const m = selected;
    const lines = [
      "BioChain Smart Migration Report",
      "Migration ID: " + m.migrationId,
      `Vehicle: ${m.origin?.regNumber} (${m.vehicle?.make} ${m.vehicle?.model || ""})`,
      `Route: ${m.origin?.stateName} -> ${m.destination?.stateName}`,
      "Status: " + enumLabel(m.status),
      "",
      `Readiness: ${enumLabel(m.readiness?.verdict || "n/a")} - ${m.readiness?.summary || ""}`,
      ...(m.readiness?.checks || []).map(
        (c) => `  - ${c.label}: ${enumLabel(c.result)} (${c.detail || ""})`,
      ),
      "",
      "Estimated cost (an estimate, not an official demand):",
      `  Destination road tax: ${m.costEstimate?.destinationRoadTax ?? "not configured"}`,
      `  Registration fee: ${m.costEstimate?.registrationFee ?? "not configured"}`,
      `  Estimated total: ${m.costEstimate?.estimatedTotal ?? "not configured"}`,
      `  Rule source: ${m.costEstimate?.ruleSource || "n/a"}`,
      "",
      `Passport integrity hash: ${m.passport?.hash || "not generated"}`,
      m.deadline?.expiresAt
        ? `NOC expires: ${m.deadline.expiresAt} (${m.deadline.daysRemaining} day(s))`
        : "",
      "Reconciliation: " + enumLabel(m.reconciliation?.verdict || "pending"),
      ...(m.exceptions || []).map(
        (x) =>
          `  ! ${x.field}: ${x.sourceValue} vs ${x.destinationValue} (${x.resolved ? "resolved" : "open"})`,
      ),
      "",
      "Audit trail:",
      ...(m.eventHistory || []).map(
        (ev) =>
          `  ${formatDate(ev.at)} - ${ev.action}${ev.note ? `: ${ev.note}` : ""}`,
      ),
    ];
    const blob = new Blob([lines.filter(Boolean).join("\n")], {
      type: "text/plain",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${m.migrationId}-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const canSource =
    !!selected &&
    !!myState &&
    selected.origin?.stateCode === myState &&
    ["submitted", "source_under_review"].includes(selected.status);
  const canDest =
    !!selected &&
    !!myState &&
    selected.destination?.stateCode === myState &&
    selected.status === "noc_issued";

  // Counts derived from the live status distribution, so "Awaiting …" KPIs read
  // real per-stage backlog instead of a single coarse "in progress" number.
  const statusCount = (keys: string[]) =>
    (analytics?.statusDist || [])
      .filter((s) => keys.includes(s.status))
      .reduce((a, b) => a + b.count, 0);
  const awaitingSource = statusCount(["submitted", "source_under_review"]);
  const awaitingDest = statusCount(["noc_issued", "destination_under_review"]);

  // Chart clicks filter the same list the table renders, so a segment and a
  // table row can never disagree.
  const visibleList = useMemo(() => {
    let out = list;
    if (statusFilter) out = out.filter((m) => m.status === statusFilter);
    if (routeFilter)
      out = out.filter(
        (m) =>
          m.origin?.stateName === routeFilter.from &&
          m.destination?.stateName === routeFilter.to,
      );
    return out;
  }, [list, statusFilter, routeFilter]);

  const activeFilter = !!statusFilter || !!routeFilter;
  const clearFilters = () => {
    setStatusFilter(null);
    setRouteFilter(null);
  };

  const migrationColumns: Column<Migration>[] = [
    {
      key: "migrationId",
      header: "Migration",
      value: (m) => m.migrationId,
      render: (m) => (
        <button
          className="btn btn-secondary btn-sm"
          onClick={() => openDetail(m._id)}
        >
          {m.migrationId}
        </button>
      ),
    },
    {
      key: "route",
      header: "Route",
      value: (m) =>
        `${m.origin?.stateCode ?? ""}→${m.destination?.stateCode ?? ""}`,
      render: (m) =>
        `${m.origin?.regNumber ?? ""} → ${m.destination?.stateCode ?? ""}`,
    },
    {
      key: "vehicle",
      header: "Vehicle",
      value: (m) => `${m.vehicle?.make ?? ""} ${m.vehicle?.model ?? ""}`,
      render: (m) => `${m.vehicle?.make ?? ""} ${m.vehicle?.model ?? ""}`,
    },
    {
      key: "status",
      header: "Status",
      value: (m) => m.status,
      render: (m) => (
        <StatusPill status={m.status} label={enumLabel(m.status)} />
      ),
    },
  ];

  return (
    <DashboardLayout
      title="Smart Migration Orchestrator"
      subtitle="Intelligent inter-state vehicle migration, two-state coordination and reconciliation."
    >
      {/* What this console can and cannot claim, stated once where it is used. */}
      <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
        No government system is connected here. RTO decisions are recorded by
        signed-in officers, cost figures are labelled estimates from a
        configurable rule table, and identity checks read only what BioChain
        actually holds - an unavailable record is shown as “needs review”, never
        as passed.
      </div>

      <KpiStrip>
        <KpiCard
          label="Total migrations"
          value={stats.total ?? 0}
          accent={BIO.blue}
          hint="Clear all filters"
          active={activeFilter}
          onClick={clearFilters}
        />
        <KpiCard
          label="In progress"
          value={stats.inProgress ?? 0}
          accent={BIO.violet}
          hint="Active, not yet completed"
        />
        <KpiCard
          label="Awaiting source RTO"
          value={awaitingSource}
          sub="NOC not yet issued"
          accent={BIO.amber}
        />
        <KpiCard
          label="Awaiting destination RTO"
          value={awaitingDest}
          sub="Re-registration pending"
          accent={BIO.amber}
        />
        <KpiCard
          label="Blocked"
          value={stats.blocked ?? 0}
          accent={BIO.red}
          hint="Click to show only blocked pre-checks"
          active={statusFilter === "precheck_blocked"}
          onClick={() =>
            setStatusFilter(
              statusFilter === "precheck_blocked" ? null : "precheck_blocked",
            )
          }
        />
        <KpiCard
          label="Completed"
          value={stats.completed ?? 0}
          accent={BIO.green}
          hint="Click to show only completed migrations"
          active={statusFilter === "completed"}
          onClick={() =>
            setStatusFilter(statusFilter === "completed" ? null : "completed")
          }
        />
        <KpiCard
          label="Exceptions"
          value={stats.exceptions ?? 0}
          accent={BIO.red}
        />
      </KpiStrip>

      {busy && <p style={{ color: "var(--color-text-muted)" }}>Working…</p>}

      {role === "owner" && (
        <div className="card" style={{ padding: 16, marginBottom: 18 }}>
          <h4 style={{ marginTop: 0 }}>Start a new migration</h4>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))",
              gap: 10,
            }}
          >
            <select
              name="vehicleId"
              value={form.vehicleId}
              onChange={(e) => setForm({ ...form, vehicleId: e.target.value })}
            >
              <option value="">Select vehicle…</option>
              {vehicles.map((v) => (
                <option
                  key={v._id}
                  value={v._id}
                >{`${v.regNumber} - ${v.make} ${v.model || ""}`}</option>
              ))}
            </select>
            <select
              name="destinationState"
              value={form.destinationState}
              onChange={(e) =>
                setForm({ ...form, destinationState: e.target.value })
              }
            >
              <option value="">Destination state…</option>
              {states.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              name="newAddress"
              placeholder="Enter new address"
              value={form.newAddress}
              onChange={(e) => setForm({ ...form, newAddress: e.target.value })}
            />
            <input
              name="relocationReason"
              placeholder="Reason for relocation"
              value={form.relocationReason}
              onChange={(e) =>
                setForm({ ...form, relocationReason: e.target.value })
              }
            />
          </div>
          <div
            style={{
              display: "flex",
              gap: 10,
              marginTop: 12,
              flexWrap: "wrap",
            }}
          >
            <button
              className="btn btn-primary"
              onClick={runPreCheck}
              disabled={busy}
            >
              Run Pre-Check
            </button>
            {precheck && (
              <button
                className="btn btn-success"
                onClick={startMigration}
                disabled={busy}
              >
                Start Migration
              </button>
            )}
          </div>

          {precheck && (
            <div style={{ marginTop: 16 }}>
              <p>
                Vehicle migration readiness:{" "}
                <span
                  className={`role-badge ${VERDICT_COLOR[precheck.verdict] || "role-dealer"}`}
                >
                  {enumLabel(precheck.verdict)}
                </span>
              </p>
              <p
                style={{
                  fontSize: "0.9rem",
                  color: "var(--color-text-secondary)",
                }}
              >
                {precheck.summary}
              </p>
              <p style={{ fontSize: "0.9rem" }}>
                <strong>System recommendation:</strong>{" "}
                {precheck.recommendation}
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Check</th>
                    <th>Result</th>
                    <th>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {precheck.checks.map((c) => (
                    <tr key={c.key}>
                      <td>{c.label}</td>
                      <td>
                        <span className={`role-badge ${CHECK_COLOR[c.result]}`}>
                          {enumLabel(c.result)}
                        </span>
                      </td>
                      <td style={{ fontSize: "0.85rem" }}>
                        {c.detail}
                        {c.sourceLabel ? ` — ${c.sourceLabel}` : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {precheck.costEstimate && (
                <div
                  style={{
                    marginTop: 10,
                    fontSize: "0.85rem",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  <strong>Estimated destination cost:</strong>{" "}
                  {precheck.costEstimate.estimatedTotal != null
                    ? `Rs ${formatMoney(precheck.costEstimate.estimatedTotal)}`
                    : "not available for this state"}{" "}
                  <em>({precheck.costEstimate.label})</em>
                  <div>
                    Rule source: {precheck.costEstimate.ruleSource} · effective{" "}
                    {precheck.costEstimate.ruleEffectiveDate}
                  </div>
                  {(precheck.costEstimate.unsupported || []).map((u, i) => (
                    <div key={i} style={{ color: "#b91c1c" }}>
                      ⚠ {u}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {analytics && (role === "rto" || role === "admin") && (
        <SectionCard
          title="Migration analytics"
          subtitle={
            <>
              Aggregated live from {analytics.totalMigrations} migration record
              {analytics.totalMigrations === 1 ? "" : "s"}. Click a status wedge
              or a route bar to filter the table below. Avg time to complete:{" "}
              <strong>{analytics.avgDurationDays ?? "—"}</strong> day(s).
            </>
          }
          style={{ marginBottom: 18 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
              gap: 18,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: BIO.slate,
                  marginBottom: 6,
                }}
              >
                Applications by month
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={analytics.byMonth}>
                  <CartesianGrid strokeDasharray="3 3" stroke={BIO.line} />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                    width={28}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    name="Applications"
                    fill={BIO.blue}
                    radius={[3, 3, 0, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: BIO.slate,
                  marginBottom: 6,
                }}
              >
                Applications by workflow status
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Tooltip />
                  <Pie
                    data={analytics.statusDist.map((s) => ({
                      name: enumLabel(s.status),
                      value: s.count,
                      status: s.status,
                    }))}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    label={(entry) =>
                      `${(entry as unknown as { value?: number }).value ?? ""}`
                    }
                    onClick={(entry) => {
                      const x = entry as unknown as {
                        status?: string;
                        payload?: { status?: string };
                      };
                      const st = x.status ?? x.payload?.status;
                      if (st) setStatusFilter(statusFilter === st ? null : st);
                    }}
                  >
                    {analytics.statusDist.map((s) => (
                      <Cell
                        key={s.status}
                        fill={toneForStatus(s.status)}
                        cursor="pointer"
                        stroke={statusFilter === s.status ? BIO.ink : "#fff"}
                        strokeWidth={statusFilter === s.status ? 2 : 1}
                      />
                    ))}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div>
              <div
                style={{
                  fontSize: "0.82rem",
                  fontWeight: 700,
                  color: BIO.slate,
                  marginBottom: 6,
                }}
              >
                State-to-state migration trends
              </div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart
                  data={analytics.statePairs}
                  layout="vertical"
                  margin={{ left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke={BIO.line} />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="category"
                    dataKey="label"
                    width={130}
                    tick={{ fontSize: 10 }}
                  />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    name="Migrations"
                    fill={BIO.violet}
                    radius={[0, 3, 3, 0]}
                    cursor="pointer"
                    onClick={(entry) => {
                      const p =
                        (
                          entry as unknown as {
                            payload?: { from?: string; to?: string };
                          }
                        )?.payload ??
                        (entry as unknown as { from?: string; to?: string });
                      if (p?.from && p?.to) {
                        setRouteFilter(
                          routeFilter &&
                            routeFilter.from === p.from &&
                            routeFilter.to === p.to
                            ? null
                            : { from: p.from, to: p.to },
                        );
                      }
                    }}
                  >
                    {analytics.statePairs.map((p, i) => (
                      <Cell
                        key={i}
                        fill={BIO.violet}
                        stroke={
                          routeFilter &&
                          routeFilter.from === p.from &&
                          routeFilter.to === p.to
                            ? BIO.ink
                            : "#fff"
                        }
                        strokeWidth={
                          routeFilter &&
                          routeFilter.from === p.from &&
                          routeFilter.to === p.to
                            ? 2
                            : 1
                        }
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </SectionCard>
      )}

      <SectionCard
        title={role === "owner" ? "My migrations" : "Migration queue"}
        subtitle="Select an application to open its migration workspace and the seven module screens."
        style={{ marginBottom: 18 }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {activeFilter && (
              <>
                <span style={{ fontSize: "0.82rem", color: BIO.slate }}>
                  Filtered by:
                </span>
                {statusFilter && (
                  <StatusPill
                    status={statusFilter}
                    label={enumLabel(statusFilter)}
                  />
                )}
                {routeFilter && (
                  <span className="role-badge role-dealer">
                    {routeFilter.from} → {routeFilter.to}
                  </span>
                )}
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={clearFilters}
                >
                  Clear
                </button>
              </>
            )}
          </div>
          <div
            className="btn-group btn-group-sm"
            role="group"
            aria-label="View mode"
          >
            <button
              className={`btn btn-sm ${listView === "cards" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setListView("cards")}
            >
              Cards
            </button>
            <button
              className={`btn btn-sm ${listView === "table" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setListView("table")}
            >
              Table
            </button>
          </div>
        </div>
        {listView === "cards" ? (
          <MigrationCardGrid
            migrations={visibleList}
            onOpen={(id) => {
              openDetail(id);
              setModuleTab("workspace");
            }}
          />
        ) : (
          <DataTable<Migration>
            rows={visibleList}
            columns={migrationColumns}
            rowKey={(m) => m._id}
            onRowClick={(m) => {
              openDetail(m._id);
              setModuleTab("workspace");
            }}
            searchPlaceholder="Search migration, route or vehicle…"
            emptyTitle="No migrations to show"
            emptyHint={
              activeFilter
                ? "No records match the active chart filter."
                : undefined
            }
          />
        )}
      </SectionCard>

      {/* Module navigation — one shared record, seven dedicated premium screens. */}
      {selected && (
        <div
          style={{
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
            marginBottom: 14,
          }}
        >
          {MODULE_TABS.map((t) => (
            <button
              key={t.id}
              className={`btn btn-sm ${moduleTab === t.id ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setModuleTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {selected && moduleTab !== "workspace" && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 18,
            borderLeft: "4px solid var(--color-cyan-dark)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              marginBottom: 12,
            }}
          >
            <h4 style={{ margin: 0 }}>
              {selected.migrationId} — {selected.origin?.regNumber} →{" "}
              {selected.destination?.stateName}
            </h4>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn btn-secondary btn-sm"
                onClick={downloadReport}
              >
                Export report
              </button>
              {role === "owner" && (
                <button
                  className="btn btn-secondary btn-sm"
                  onClick={() => recheck(selected._id)}
                  disabled={busy}
                >
                  Re-run pre-check
                </button>
              )}
            </div>
          </div>

          {moduleTab === "precheck" && (
            <ComplianceGrid
              checks={selected.readiness?.checks || []}
              verdict={selected.readiness?.verdict}
              summary={selected.readiness?.summary}
              recommendation={selected.readiness?.recommendation}
            />
          )}

          {moduleTab === "documents" && (
            <DocumentSplitView
              documents={selected.documents || []}
              role={role}
              fileRef={fileRef}
              onUpload={uploadDoc}
              onVerify={verifyDoc}
              busy={busy}
            />
          )}

          {moduleTab === "workflow" && (
            <div>
              <strong style={{ fontSize: "0.9rem" }}>
                Two-state coordination — the destination stage stays locked
                until the source NOC is recorded.
              </strong>
              <div style={{ marginTop: 10 }}>
                <TwoStateFlow migration={selected} />
              </div>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  marginTop: 14,
                }}
              >
                {role === "owner" &&
                  ["ready_to_apply", "precheck_blocked"].includes(
                    selected.status,
                  ) && (
                    <button
                      className="btn btn-primary"
                      onClick={submitApplication}
                      disabled={busy}
                    >
                      Submit Application
                    </button>
                  )}
                {canSource && (
                  <>
                    <input
                      placeholder="Remarks (optional)"
                      value={remarks}
                      onChange={(e) => setRemarks(e.target.value)}
                      style={{ flex: "1 1 200px" }}
                    />
                    <button
                      className="btn btn-success"
                      onClick={sourceApprove}
                      disabled={busy}
                    >
                      Issue NOC (Source State)
                    </button>
                  </>
                )}
                {canDest && (
                  <>
                    <input
                      placeholder="New Reg No (e.g. TN-01-AB-1234)"
                      value={newReg}
                      onChange={(e) => setNewReg(e.target.value)}
                      style={{ maxWidth: 220 }}
                    />
                    <button
                      className="btn btn-success"
                      onClick={destinationApprove}
                      disabled={busy}
                    >
                      Verify Passport &amp; Re-register
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {moduleTab === "tax" && (
            <SectionCard
              title="State-wise tax & fee estimate"
              subtitle="Figures come from a configurable demonstration rule table, not an official state demand. Where no verified rule exists, no amount is shown."
            >
              <CostBreakdown cost={selected.costEstimate} />
            </SectionCard>
          )}

          {moduleTab === "deadlines" && (
            <DeadlineCalendar migration={selected} />
          )}

          {moduleTab === "passport" && (
            <div>
              <div style={{ marginBottom: 10 }}>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={viewPassport}
                  disabled={busy}
                >
                  {selected.passport?.hash
                    ? "Re-verify passport integrity"
                    : "Generate migration passport"}
                </button>
              </div>
              <PremiumPassport
                migration={selected}
                passportHash={passport?.passportHash}
                matches={passport?.matches}
              />
              {!selected.passport?.passportId && (
                <div
                  className="alert alert-secondary"
                  style={{ marginTop: 10, fontSize: "0.82rem" }}
                >
                  No passport has been generated for this migration yet. Use the
                  button above — it builds the passport from the vehicle's
                  existing lifecycle records.
                </div>
              )}
            </div>
          )}

          {moduleTab === "reconciliation" && (
            <div>
              <ReconcileCompare migration={selected} />
              {(selected.exceptions || []).some((e) => !e.resolved) &&
                (role === "rto" || role === "admin") && (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    {selected.exceptions!.map((e, i) =>
                      !e.resolved ? (
                        <button
                          key={i}
                          className="btn btn-sm btn-secondary"
                          onClick={() => resolveException(i)}
                          disabled={busy}
                        >
                          Clear “{e.field}”
                        </button>
                      ) : null,
                    )}
                  </div>
                )}
            </div>
          )}
        </div>
      )}

      {selected && moduleTab === "workspace" && (
        <div
          className="card"
          style={{
            padding: 16,
            marginBottom: 18,
            borderLeft: "4px solid var(--color-cyan-dark)",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <h4 style={{ margin: 0 }}>
              {selected.migrationId} — {selected.origin?.regNumber} →{" "}
              {selected.destination?.stateName}
            </h4>
            <button
              className="btn btn-secondary btn-sm"
              onClick={downloadReport}
            >
              Download migration report
            </button>
          </div>
          <p style={{ fontSize: "0.9rem" }}>
            Status:{" "}
            <span
              className={`role-badge ${selected.status === "completed" ? "role-rto" : "role-dealer"}`}
            >
              {enumLabel(selected.status)}
            </span>
          </p>

          {/* Spec-shaped workspace: identity | journey | alerts & actions. */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))",
              gap: 16,
              marginTop: 14,
            }}
          >
            {/* LEFT — vehicle & migration identity (all from the live record) */}
            <div
              style={{
                background: "rgba(0,0,0,0.025)",
                borderRadius: 10,
                padding: 12,
              }}
            >
              <strong style={{ fontSize: "0.9rem" }}>
                Vehicle & migration identity
              </strong>
              <table style={{ fontSize: "0.82rem", marginTop: 6 }}>
                <tbody>
                  <tr>
                    <td>Migration ID</td>
                    <td>{selected.migrationId}</td>
                  </tr>
                  <tr>
                    <td>Registration</td>
                    <td>{selected.origin?.regNumber}</td>
                  </tr>
                  <tr>
                    <td>Vehicle</td>
                    <td>
                      {[
                        selected.vehicle?.make,
                        selected.vehicle?.model,
                        selected.vehicle?.year,
                      ]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                  </tr>
                  <tr>
                    <td>Chassis no.</td>
                    <td style={{ wordBreak: "break-all" }}>
                      {selected.vehicle?.chassisNumber || "not on record"}
                    </td>
                  </tr>
                  <tr>
                    <td>Engine no.</td>
                    <td style={{ wordBreak: "break-all" }}>
                      {selected.vehicle?.engineNumber || "not on record"}
                    </td>
                  </tr>
                  <tr>
                    <td>Current owner</td>
                    <td>
                      {typeof selected.owner === "object"
                        ? selected.owner?.name || "—"
                        : "—"}
                    </td>
                  </tr>
                  <tr>
                    <td>From</td>
                    <td>{selected.origin?.stateName}</td>
                  </tr>
                  <tr>
                    <td>To</td>
                    <td>
                      {selected.destination?.stateName}
                      {selected.destination?.newRegNumber
                        ? ` · ${selected.destination.newRegNumber}`
                        : ""}
                    </td>
                  </tr>
                </tbody>
              </table>
              {role === "owner" && (
                <button
                  className="btn btn-secondary btn-sm"
                  style={{ marginTop: 6 }}
                  onClick={() => recheck(selected._id)}
                  disabled={busy}
                >
                  Re-run pre-check
                </button>
              )}
            </div>

            {/* MIDDLE — visual migration journey with per-stage facts */}
            <div>
              <strong style={{ fontSize: "0.9rem" }}>Migration journey</strong>
              <ol style={{ listStyle: "none", padding: 0, margin: "8px 0 0" }}>
                {selected.stages.map((s, i) => (
                  <li
                    key={s.key}
                    style={{
                      position: "relative",
                      paddingLeft: 22,
                      paddingBottom: 12,
                      borderLeft:
                        i < selected.stages.length - 1
                          ? "2px solid #dbe4ee"
                          : "2px solid transparent",
                    }}
                  >
                    <span
                      style={{
                        position: "absolute",
                        left: -6,
                        top: 2,
                        width: 10,
                        height: 10,
                        borderRadius: "50%",
                        background: toneForStatus(s.status),
                        display: "inline-block",
                      }}
                    />
                    <div style={{ fontSize: "0.86rem" }}>
                      <strong>
                        {i + 1}. {s.title}
                      </strong>{" "}
                      <span
                        className={`role-badge ${STAGE_BADGE[s.status] || "role-owner"}`}
                      >
                        {enumLabel(s.status)}
                      </span>
                    </div>
                    <div
                      style={{
                        fontSize: "0.76rem",
                        color: "var(--color-text-muted)",
                        marginTop: 2,
                      }}
                    >
                      {s.ownerState ? `${s.ownerState} RTO · ` : ""}
                      {s.ownerRole
                        ? `${enumLabel(s.ownerRole)} owns this stage`
                        : "system-owned"}
                      {stageTime(s) ? ` · ${formatDate(stageTime(s))}` : ""}
                      {s.actorName ? ` · ${s.actorName}` : ""}
                    </div>
                    {s.remarks ? (
                      <div style={{ fontSize: "0.76rem", marginTop: 2 }}>
                        “{s.remarks}”
                      </div>
                    ) : null}
                  </li>
                ))}
              </ol>
            </div>

            {/* RIGHT — alerts and required actions, computed from real state */}
            <div>
              <strong style={{ fontSize: "0.9rem" }}>
                Alerts & required actions
              </strong>
              <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                {selected.deadline?.expiresAt ? (
                  <div
                    className="alert"
                    style={{
                      padding: "6px 10px",
                      fontSize: "0.82rem",
                      marginBottom: 0,
                      background:
                        (selected.deadline.daysRemaining ?? 99) <= 3
                          ? "#fde8e8"
                          : "#fff7e6",
                      border:
                        (selected.deadline.daysRemaining ?? 99) <= 3
                          ? "1px solid #feb2b2"
                          : "1px solid #fbd38d",
                    }}
                  >
                    <strong>NOC deadline</strong>{" "}
                    {formatDate(selected.deadline.expiresAt)} ·{" "}
                    {selected.deadline.daysRemaining} day(s) remaining.
                    <div>{selected.deadline.nextAction}</div>
                  </div>
                ) : null}
                {(selected.documentAudit?.missing || []).length > 0 && (
                  <div
                    className="alert alert-secondary"
                    style={{
                      padding: "6px 10px",
                      fontSize: "0.82rem",
                      marginBottom: 0,
                    }}
                  >
                    <strong>Missing documents:</strong>{" "}
                    {selected.documentAudit!.missing!.join(", ")}
                  </div>
                )}
                {(() => {
                  const pendingStages = selected.stages.filter(
                    (s) =>
                      [
                        "pending",
                        "submitted",
                        "under_review",
                        "documents_required",
                      ].includes(s.status) && s.status !== "locked",
                  );
                  return pendingStages.length ? (
                    <div
                      className="alert alert-secondary"
                      style={{
                        padding: "6px 10px",
                        fontSize: "0.82rem",
                        marginBottom: 0,
                      }}
                    >
                      <strong>Awaiting action:</strong>{" "}
                      {pendingStages
                        .map(
                          (s) =>
                            `${s.title}${s.ownerState ? ` (${s.ownerState} RTO)` : ""}`,
                        )
                        .join("; ")}
                    </div>
                  ) : null;
                })()}
                {(selected.exceptions || []).filter((x) => !x.resolved).length >
                  0 && (
                  <div
                    className="alert"
                    style={{
                      padding: "6px 10px",
                      fontSize: "0.82rem",
                      marginBottom: 0,
                      background: "#fde8e8",
                    }}
                  >
                    <strong>Inconsistent vehicle details:</strong>{" "}
                    {selected
                      .exceptions!.filter((x) => !x.resolved)
                      .map(
                        (x) =>
                          `${x.field} (${x.sourceValue} vs ${x.destinationValue})`,
                      )
                      .join("; ")}
                  </div>
                )}
                {selected.readiness?.checks
                  ?.filter((c) => c.result !== "passed")
                  .map((c) => (
                    <div
                      key={c.key}
                      className="alert alert-secondary"
                      style={{
                        padding: "6px 10px",
                        fontSize: "0.82rem",
                        marginBottom: 0,
                      }}
                    >
                      <span className={`role-badge ${CHECK_COLOR[c.result]}`}>
                        {enumLabel(c.result)}
                      </span>{" "}
                      <strong>{c.label}</strong> — {c.detail}
                    </div>
                  ))}
                {!(
                  selected.deadline?.expiresAt ||
                  (selected.documentAudit?.missing || []).length ||
                  selected.stages.some((s) =>
                    [
                      "pending",
                      "submitted",
                      "under_review",
                      "documents_required",
                    ].includes(s.status),
                  ) ||
                  (selected.exceptions || []).some((x) => !x.resolved) ||
                  selected.readiness?.checks?.some((c) => c.result !== "passed")
                ) && (
                  <div
                    className="alert alert-secondary"
                    style={{
                      padding: "6px 10px",
                      fontSize: "0.82rem",
                      marginBottom: 0,
                    }}
                  >
                    No open exceptions or deadlines on this migration.
                  </div>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: 12 }}>
            <strong>Document intelligence</strong>
            {role === "owner" && (
              <div style={{ marginTop: 6 }}>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={uploadDoc}
                />
                <div
                  style={{
                    fontSize: "0.8rem",
                    color: "var(--color-text-muted)",
                  }}
                >
                  Uploads are read with OCR and compared against the vehicle
                  record. Drafts are prepared only — nothing is signed or filed
                  on your behalf, and a human verdict is always required.
                </div>
              </div>
            )}
            <ul style={{ fontSize: "0.85rem" }}>
              {(selected.documents || []).map((d, i) => (
                <li key={i}>
                  {d.name} <em>({d.category})</em> —{" "}
                  <span
                    className={`role-badge ${d.reviewStatus === "verified" ? "role-rto" : d.reviewStatus === "unreadable" ? "role-reject" : "role-dealer"}`}
                  >
                    {enumLabel(d.reviewStatus)}
                  </span>
                  {d.ocrConfidence != null
                    ? ` · OCR confidence ${d.ocrConfidence}%`
                    : ""}
                  {(d.observations || []).map((o, k) => (
                    <div key={k} style={{ color: "var(--color-text-muted)" }}>
                      • {o}
                    </div>
                  ))}
                  {(d.discrepancies || []).map((x, k) => (
                    <div key={k} style={{ color: "#b91c1c" }}>
                      ⚠ {x}
                    </div>
                  ))}
                  {role === "owner" && d.reviewStatus === "read" && (
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ marginLeft: 8 }}
                      onClick={() => verifyDoc(i)}
                      disabled={busy}
                    >
                      Verify
                    </button>
                  )}
                </li>
              ))}
              {!selected.documents?.length && (
                <li style={{ color: "var(--color-text-muted)" }}>
                  No documents uploaded yet.
                </li>
              )}
            </ul>
            {selected.formDrafts?.checklist?.length ? (
              <details style={{ fontSize: "0.85rem" }}>
                <summary>
                  Application document checklist and Form 28 / 27 drafts
                </summary>
                <ul>
                  {selected.formDrafts.checklist.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              marginTop: 14,
            }}
          >
            {role === "owner" &&
              ["ready_to_apply", "precheck_blocked"].includes(
                selected.status,
              ) && (
                <button
                  className="btn btn-primary"
                  onClick={submitApplication}
                  disabled={busy}
                >
                  Submit Application
                </button>
              )}
            {canSource && (
              <>
                <input
                  placeholder="Remarks (optional)"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  style={{ flex: "1 1 200px" }}
                />
                <button
                  className="btn btn-success"
                  onClick={sourceApprove}
                  disabled={busy}
                >
                  Issue NOC (Source State)
                </button>
              </>
            )}
            {canDest && (
              <>
                <input
                  placeholder="New Reg No (e.g. TN-01-AB-1234)"
                  value={newReg}
                  onChange={(e) => setNewReg(e.target.value)}
                  style={{ maxWidth: 220 }}
                />
                <button
                  className="btn btn-success"
                  onClick={destinationApprove}
                  disabled={busy}
                >
                  Verify Passport &amp; Re-register
                </button>
              </>
            )}
            <button
              className="btn btn-secondary"
              onClick={viewPassport}
              disabled={busy}
            >
              View migration passport
            </button>
          </div>

          {selected.reconciliation &&
            selected.reconciliation.verdict !== "pending" && (
              <div style={{ marginTop: 14 }}>
                <strong>Migration reconciliation</strong>:{" "}
                <span
                  className={`role-badge ${selected.reconciliation.verdict === "consistent" ? "role-rto" : "role-reject"}`}
                >
                  {enumLabel(selected.reconciliation.verdict)}
                </span>
                <p
                  style={{
                    fontSize: "0.85rem",
                    color: "var(--color-text-secondary)",
                  }}
                >
                  {selected.reconciliation.notes}
                </p>
                {(selected.exceptions || []).length > 0 && (
                  <table>
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Source record</th>
                        <th>Destination record</th>
                        <th>Severity</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.exceptions || []).map((x, i) => (
                        <tr key={i}>
                          <td>{x.field}</td>
                          <td>{x.sourceValue}</td>
                          <td>{x.destinationValue}</td>
                          <td>
                            <span
                              className={`role-badge ${x.severity === "critical" ? "role-reject" : "role-dealer"}`}
                            >
                              {x.severity}
                            </span>
                          </td>
                          <td>
                            {x.resolved ? (
                              "resolved"
                            ) : role === "rto" || role === "admin" ? (
                              <button
                                className="btn btn-secondary btn-sm"
                                onClick={() => resolveException(i)}
                                disabled={busy}
                              >
                                Resolve
                              </button>
                            ) : (
                              "awaiting officer"
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

          {passport && (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                background: "rgba(0,0,0,0.03)",
                borderRadius: 8,
              }}
            >
              <strong>Migration passport</strong>
              {passport.matches != null && (
                <p style={{ fontSize: "0.85rem" }}>
                  Integrity check:{" "}
                  {passport.matches
                    ? "the recomputed hash matches the stored reference"
                    : "the recomputed hash does NOT match the stored reference"}
                </p>
              )}
              <pre
                style={{
                  fontSize: "0.75rem",
                  overflowX: "auto",
                  maxHeight: 280,
                }}
              >
                {JSON.stringify(passport.passport, null, 2)}
              </pre>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <strong>Audit trail</strong>
            <ul
              style={{
                fontSize: "0.8rem",
                color: "var(--color-text-secondary)",
              }}
            >
              {(selected.eventHistory || [])
                .slice()
                .reverse()
                .slice(0, 12)
                .map((ev, i) => (
                  <li key={i}>
                    {formatDate(ev.at)} — {ev.action}
                    {ev.actorRole ? ` (${ev.actorRole})` : ""}
                    {ev.note ? `: ${ev.note}` : ""}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </DashboardLayout>
  );
}
