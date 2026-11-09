import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import { isTxHash, txUrl } from "../services/blockchain";
import ViewTransactionButton from "../components/ViewTransactionButton";
import DashboardLayout from "../components/DashboardLayout";
import { formatDateTime, enumLabel } from "../lib/display";
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
import { KpiCard, KpiStrip, SectionCard, LoadingState } from "../lib/ui";
import { BIO, toneForStatus } from "../lib/ui-tokens";

// Officer console for the investigative feature family (/api/investigations):
// Feature 3 - Fraud Investigation Casebook
// Feature 4 - Transaction Anomaly Detection (explainable baseline model)
// Feature 5 - Identity Cloning Detector
// Nothing here auto-declares guilt, auto-blocks transfers, or edits records.

type ApiError = {
  response?: { data?: { message?: string; errors?: string[] } };
};
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

interface CaseRow {
  _id: string;
  caseRef: string;
  title: string;
  reason: string;
  priority: string;
  status: string;
  regNumber?: string;
  vehicle?: {
    _id: string;
    regNumber: string;
    make: string;
    model: string;
  } | null;
  assignedOfficer?: { name: string; role: string } | null;
  actions?: {
    action: string;
    detail: string;
    performerName?: string;
    performedAt: string;
  }[];
  notes?: { text: string; authorName?: string; createdAt: string }[];
  evidence?: {
    fileName: string;
    sha256: string;
    fileSize?: number;
    description?: string;
  }[];
  blockchainTxRefs?: { txHash: string; label?: string }[];
  anchor?: { recordHash?: string; status?: string; txHash?: string | null };
}

interface Anomaly {
  _id: string;
  alertType: string;
  subjectType: string;
  subjectLabel?: string;
  riskIndicator: number;
  severity: string;
  explanation: string;
  contributingFactors?: { factor: string; detail?: string; weight?: number }[];
  ruleBasedScore?: number;
  reviewStatus: string;
  modelVersion: string;
}

interface Conflict {
  _id: string;
  conflictType: string;
  identifierValue: string;
  rawValues?: string[];
  regNumbers?: string[];
  reviewStatus: string;
  reviewRemarks?: string;
  vehicles?: string[];
}

const TABS = [
  { id: "cases", label: "Casebook" },
  { id: "anomaly", label: "Transaction Anomalies" },
  { id: "cloning", label: "Identity Cloning" },
] as const;

const CASE_STATUSES = [
  "open",
  "under-review",
  "action-required",
  "resolved",
  "closed",
];

export default function FraudInvestigations() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("cases");

  return (
    <DashboardLayout>
      <div className="container" style={{ marginTop: 30, marginBottom: 40 }}>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
          }}
        >
          <h2 style={{ color: "#2c3e50", margin: 0 }}>
            Vehicle Intelligence Console
          </h2>
          <Link to="/" className="btn btn-outline-secondary btn-sm">
            Back
          </Link>
        </div>

        <div
          className="d-flex gap-2"
          style={{ margin: "20px 0", flexWrap: "wrap" }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
          These tools surface <strong>indicators for human review</strong>. They
          do not auto-declare fraud, do not auto-block transfers, and never
          modify existing records.
        </div>

        <FraudOverview />

        {tab === "cases" && <Casebook />}
        {tab === "anomaly" && <AnomalyPanel />}
        {tab === "cloning" && <CloningPanel />}
      </div>
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------------------
// Fraud Intelligence Centre overview - KPI strip + live analytics, aggregated
// by GET /investigations/stats. Informational: the panels below are the
// actionable surfaces; nothing here asserts fraud.
// ---------------------------------------------------------------------------
type OverviewStats = {
  cases: { total: number; open: number; resolved: number; closed: number; highPriority: number; byMonth: { label: string; count: number }[] };
  anomalies: { total: number; pendingReview: number; avgRisk: number | null; bySeverity: { name: string; count: number }[] };
  conflicts: { total: number; pendingReview: number; byType: { name: string; count: number }[] };
};
function FraudOverview() {
  const [s, setS] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    api
      .get("/investigations/stats")
      .then((r) => alive && setS(r.data))
      .catch(() => {})
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  if (loading) return <SectionCard title="Fraud Intelligence Centre" subtitle="Loading platform overview…"><LoadingState /></SectionCard>;
  if (!s) return null;

  return (
    <div style={{ margin: "18px 0 22px" }}>
      <KpiStrip>
        <KpiCard label="Total investigations" value={s.cases.total} accent={BIO.blue} />
        <KpiCard label="Active (open) cases" value={s.cases.open} accent={BIO.violet} sub="Awaiting officer action" />
        <KpiCard label="High-priority cases" value={s.cases.highPriority} accent={BIO.red} sub="High / critical urgency" />
        <KpiCard label="Anomaly alerts" value={s.anomalies.total} accent={BIO.amber} sub={`${s.anomalies.pendingReview} pending review`} />
        <KpiCard label="Identity conflicts" value={s.conflicts.total} accent={BIO.red} sub={`${s.conflicts.pendingReview} pending review`} />
        <KpiCard label="Resolved cases" value={s.cases.resolved} accent={BIO.green} />
      </KpiStrip>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))", gap: 18, marginTop: 18 }}>
        <SectionCard title="Investigations opened" subtitle="Last 6 months">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={s.cases.byMonth}>
              <CartesianGrid strokeDasharray="3 3" stroke={BIO.line} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={26} />
              <Tooltip />
              <Bar dataKey="count" name="Cases" fill={BIO.blue} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard
          title="Anomaly alerts by severity"
          subtitle={s.anomalies.avgRisk != null ? `Avg risk indicator: ${s.anomalies.avgRisk}/100` : undefined}
        >
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Tooltip />
              <Pie
                data={s.anomalies.bySeverity.map((x) => ({ name: enumLabel(x.name), value: x.count, sev: x.name }))}
                dataKey="value"
                nameKey="name"
                outerRadius={78}
                label={(e) => `${(e as unknown as { value?: number }).value ?? ""}`}
              >
                {s.anomalies.bySeverity.map((x) => (
                  <Cell key={x.name} fill={toneForStatus(x.name)} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </SectionCard>

        <SectionCard title="Identity conflicts by type" subtitle="Duplicate chassis / engine / reg matches">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={s.conflicts.byType} layout="vertical" margin={{ left: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BIO.line} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} tickFormatter={(v) => enumLabel(String(v))} />
              <Tooltip formatter={(v) => [v, "Conflicts"]} labelFormatter={(l) => enumLabel(String(l))} />
              <Bar dataKey="count" fill={BIO.red} radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </SectionCard>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature 3: Casebook
// ---------------------------------------------------------------------------
function Casebook() {
  const [cases, setCases] = useState<CaseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseRow | null>(null);

  const [form, setForm] = useState({
    title: "",
    reason: "",
    priority: "medium",
    vehicleId: "",
  });
  const [noteText, setNoteText] = useState("");
  const [statusEdit, setStatusEdit] = useState({
    status: "under-review",
    remarks: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get("/investigations/cases");
      setCases(res.data.cases || []);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load cases."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const createCase = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.post("/investigations/cases", {
        ...form,
        vehicleId: form.vehicleId || undefined,
      });
      setNotice(res.data.message);
      setShowForm(false);
      setForm({ title: "", reason: "", priority: "medium", vehicleId: "" });
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(
        errs ? errs.join(" ") : apiMessage(err, "Failed to create case."),
      );
    }
  };

  const openCase = async (id: string) => {
    setError(null);
    try {
      const res = await api.get(`/investigations/cases/${id}`);
      setDetail(res.data.case);
      setOpenId(id);
      setStatusEdit({ status: res.data.case.status, remarks: "" });
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to open case."));
    }
  };

  const changeStatus = async () => {
    if (!openId) return;
    try {
      await api.patch(`/investigations/cases/${openId}/status`, statusEdit);
      openCase(openId);
    } catch (err: unknown) {
      setError(apiMessage(err, "Status change failed."));
    }
  };

  const addNote = async () => {
    if (!openId || !noteText.trim()) return;
    try {
      await api.post(`/investigations/cases/${openId}/notes`, {
        text: noteText,
      });
      setNoteText("");
      openCase(openId);
    } catch (err: unknown) {
      setError(apiMessage(err, "Note failed."));
    }
  };

  const priorityBadge = (p: string) => {
    const map: Record<string, string> = {
      low: "secondary",
      medium: "info",
      high: "warning",
      critical: "danger",
    };
    return <span className={`badge bg-${map[p] || "secondary"}`}>{p}</span>;
  };

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <div style={{ marginBottom: 15 }}>
        {!showForm ? (
          <button className="btn btn-success" onClick={() => setShowForm(true)}>
            + Open New Case
          </button>
        ) : (
          <form onSubmit={createCase} className="card" style={{ padding: 20 }}>
            <h5>New Investigation Case</h5>
            <div className="row g-3">
              <div className="col-md-6">
                <label>Title *</label>
                <input
                  className="form-control"
                  required
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="col-md-3">
                <label>Priority</label>
                <select
                  className="form-control"
                  value={form.priority}
                  onChange={(e) =>
                    setForm({ ...form, priority: e.target.value })
                  }
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>
              <div className="col-md-3">
                <label>Vehicle ID (optional)</label>
                <input
                  className="form-control"
                  placeholder="Mongo _id"
                  value={form.vehicleId}
                  onChange={(e) =>
                    setForm({ ...form, vehicleId: e.target.value })
                  }
                />
              </div>
              <div className="col-12">
                <label>Reason for review *</label>
                <textarea
                  className="form-control"
                  required
                  rows={2}
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </div>
            </div>
            <div style={{ marginTop: 15 }}>
              <button type="submit" className="btn btn-primary">
                Create Case
              </button>{" "}
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {loading ? (
        <p>Loading cases…</p>
      ) : cases.length === 0 ? (
        <div className="alert alert-secondary">No investigation cases yet.</div>
      ) : (
        <table className="table table-hover" style={{ cursor: "pointer" }}>
          <thead>
            <tr>
              <th>Ref</th>
              <th>Title</th>
              <th>Vehicle</th>
              <th>Priority</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c) => (
              <tr key={c._id} onClick={() => openCase(c._id)}>
                <td>
                  <code>{c.caseRef}</code>
                </td>
                <td>{c.title}</td>
                <td>{c.regNumber || "—"}</td>
                <td>{priorityBadge(c.priority)}</td>
                <td>
                  <span className="badge bg-light text-dark border">
                    {c.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {detail && (
        <div
          className="card"
          style={{
            padding: 20,
            marginTop: 20,
            borderLeft: "4px solid #16437e",
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
            <h5 style={{ margin: 0 }}>
              {detail.caseRef} — {detail.title}
            </h5>
            <ViewTransactionButton
              txHash={detail.anchor?.txHash}
              status={detail.anchor?.status}
              label="View Case Anchoring Tx"
              className="btn btn-sm btn-outline-success"
            />
            <button
              className="btn btn-sm btn-outline-secondary"
              onClick={() => {
                setOpenId(null);
                setDetail(null);
                load();
              }}
            >
              Close
            </button>
          </div>
          <p style={{ marginTop: 8 }}>{detail.reason}</p>
          <div style={{ fontSize: "0.9rem", color: "#555" }}>
            Status: <strong>{detail.status}</strong> · Priority:{" "}
            {priorityBadge(detail.priority)}
            {detail.assignedOfficer ? (
              <> · Assigned: {detail.assignedOfficer.name}</>
            ) : null}
          </div>

          <div className="row g-2" style={{ marginTop: 12 }}>
            <div className="col-md-3">
              <select
                className="form-control form-control-sm"
                value={statusEdit.status}
                onChange={(e) =>
                  setStatusEdit({ ...statusEdit, status: e.target.value })
                }
              >
                {CASE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div className="col-md-6">
              <input
                className="form-control form-control-sm"
                placeholder="Remarks"
                value={statusEdit.remarks}
                onChange={(e) =>
                  setStatusEdit({ ...statusEdit, remarks: e.target.value })
                }
              />
            </div>
            <div className="col-md-3">
              <button
                className="btn btn-sm btn-primary"
                style={{ width: "100%" }}
                onClick={changeStatus}
              >
                Update status
              </button>
            </div>
          </div>

          <div className="row g-2" style={{ marginTop: 10 }}>
            <div className="col-md-9">
              <input
                className="form-control form-control-sm"
                placeholder="Add investigator note…"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <button
                className="btn btn-sm btn-outline-primary"
                style={{ width: "100%" }}
                onClick={addNote}
              >
                Add note
              </button>
            </div>
          </div>

          {detail.notes && detail.notes.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Notes</strong>
              {detail.notes.map((n, i) => (
                <div key={i} style={{ fontSize: "0.85rem", marginLeft: 8 }}>
                  • {n.text} <em style={{ color: "#888" }}>— {n.authorName}</em>
                </div>
              ))}
            </div>
          )}

          {detail.actions && detail.actions.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong>Action timeline (append-only)</strong>
              {detail.actions.map((a, i) => (
                <div
                  key={i}
                  style={{ fontSize: "0.82rem", marginLeft: 8, color: "#555" }}
                >
                  • {formatDateTime(a.performedAt)} — {a.action}:{" "}
                  {a.detail} {a.performerName ? `[${a.performerName}]` : ""}
                </div>
              ))}
            </div>
          )}

          {detail.blockchainTxRefs && detail.blockchainTxRefs.length > 0 && (
            <div style={{ marginTop: 12, fontSize: "0.82rem" }}>
              <strong>Linked blockchain txs:</strong>{" "}
              {detail.blockchainTxRefs.map((t, i) =>
                isTxHash(t.txHash) ? (
                  <a
                    key={i}
                    href={txUrl(t.txHash)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="badge bg-light text-dark border"
                    style={{ marginRight: 6, textDecoration: "underline" }}
                    title={t.label || "Open in Polygon Amoy explorer"}
                  >
                    {t.label || `${t.txHash.slice(0, 14)}…`}
                  </a>
                ) : (
                  <span
                    key={i}
                    className="badge bg-light text-dark border"
                    style={{ marginRight: 6 }}
                    title={t.txHash}
                  >
                    {t.label || `${String(t.txHash).slice(0, 14)}…`}
                  </span>
                ),
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature 4: Transaction Anomaly Detection
// ---------------------------------------------------------------------------
function AnomalyPanel() {
  const [alerts, setAlerts] = useState<Anomaly[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState({
    reviewStatus: "reviewed",
    remarks: "",
    openCase: false,
  });
  const [reviewFor, setReviewFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/investigations/anomaly/alerts");
      setAlerts(res.data.alerts || []);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load alerts."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runScan = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await api.post("/investigations/anomaly/scan");
      setNotice(
        `Scan complete. ${res.data.created ?? 0} new alert(s). ${res.data.note || ""}`,
      );
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Scan failed."));
    }
  };

  const saveReview = async (id: string) => {
    try {
      const res = await api.patch(
        `/investigations/anomaly/alerts/${id}/review`,
        review,
      );
      setReviewFor(null);
      setReview({ reviewStatus: "reviewed", remarks: "", openCase: false });
      setNotice(
        res.data.createdCase
          ? `Alert reviewed; case ${res.data.createdCase.caseRef} opened.`
          : "Alert reviewed.",
      );
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Review failed."));
    }
  };

  const sevBadge = (s: string) => {
    const map: Record<string, string> = {
      low: "secondary",
      medium: "warning",
      high: "danger",
    };
    return <span className={`badge bg-${map[s] || "secondary"}`}>{s}</span>;
  };

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      <button
        className="btn btn-primary"
        onClick={runScan}
        style={{ marginBottom: 15 }}
      >
        Run anomaly scan
      </button>

      {loading ? (
        <p>Loading alerts…</p>
      ) : alerts.length === 0 ? (
        <div className="alert alert-secondary">
          No anomaly alerts yet. Run a scan.
        </div>
      ) : (
        alerts.map((a) => (
          <div
            key={a._id}
            className="card"
            style={{ padding: 15, marginBottom: 12 }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <strong>
                {a.alertType} — {a.subjectLabel || a.subjectType}
              </strong>
              <span>
                {sevBadge(a.severity)}{" "}
                <span className="badge bg-dark">risk {a.riskIndicator}</span>
              </span>
            </div>
            <p style={{ margin: "8px 0 4px", fontSize: "0.9rem" }}>
              {a.explanation}
            </p>
            {a.contributingFactors && a.contributingFactors.length > 0 && (
              <ul style={{ fontSize: "0.82rem", color: "#555" }}>
                {a.contributingFactors.map((f, i) => (
                  <li key={i}>
                    {f.factor}
                    {f.detail ? `: ${f.detail}` : ""}
                    {f.weight != null ? ` (weight ${f.weight})` : ""}
                  </li>
                ))}
              </ul>
            )}
            <div style={{ fontSize: "0.8rem", color: "#888" }}>
              Model: {a.modelVersion} · Rule-based score:{" "}
              {a.ruleBasedScore ?? "n/a"} · Status:{" "}
              <strong>{a.reviewStatus}</strong>
            </div>
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm btn-outline-primary"
                onClick={() => setReviewFor(reviewFor === a._id ? null : a._id)}
              >
                {reviewFor === a._id ? "Close" : "Review"}
              </button>
            </div>
            {reviewFor === a._id && (
              <div className="card" style={{ padding: 12, marginTop: 8 }}>
                <div className="row g-2">
                  <div className="col-md-4">
                    <select
                      className="form-control form-control-sm"
                      value={review.reviewStatus}
                      onChange={(e) =>
                        setReview({ ...review, reviewStatus: e.target.value })
                      }
                    >
                      <option value="reviewed">Reviewed</option>
                      <option value="false-positive">False positive</option>
                      <option value="investigate">Investigate</option>
                      <option value="pending">Pending</option>
                    </select>
                  </div>
                  <div className="col-md-5">
                    <input
                      className="form-control form-control-sm"
                      placeholder="Remarks"
                      value={review.remarks}
                      onChange={(e) =>
                        setReview({ ...review, remarks: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <button
                      className="btn btn-sm btn-primary"
                      style={{ width: "100%" }}
                      onClick={() => saveReview(a._id)}
                    >
                      Save
                    </button>
                  </div>
                  {review.reviewStatus === "investigate" && (
                    <div className="col-12">
                      <label className="small">
                        <input
                          type="checkbox"
                          checked={review.openCase}
                          onChange={(e) =>
                            setReview({ ...review, openCase: e.target.checked })
                          }
                        />{" "}
                        Open a linked casebook entry
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Feature 5: Identity Cloning Detector
// ---------------------------------------------------------------------------
function CloningPanel() {
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [review, setReview] = useState({
    reviewStatus: "under-investigation",
    remarks: "",
    openCase: true,
  });
  const [reviewFor, setReviewFor] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/investigations/cloning/conflicts");
      setConflicts(res.data.conflicts || []);
      setNote(res.data.note);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load conflicts."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runScan = async () => {
    setError(null);
    setNotice(null);
    try {
      const res = await api.post("/investigations/cloning/scan");
      setNotice(
        `Scan complete. ${res.data.conflictsFound ?? res.data.created ?? 0} conflict(s) recorded.`,
      );
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Scan failed."));
    }
  };

  const saveReview = async (id: string) => {
    try {
      const res = await api.patch(
        `/investigations/cloning/conflicts/${id}/review`,
        review,
      );
      setReviewFor(null);
      setReview({
        reviewStatus: "under-investigation",
        remarks: "",
        openCase: true,
      });
      setNotice(
        res.data.createdCase
          ? `Conflict reviewed; case ${res.data.createdCase.caseRef} opened.`
          : "Conflict reviewed.",
      );
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Review failed."));
    }
  };

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}
      {note && (
        <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
          {note}
        </div>
      )}

      <button
        className="btn btn-primary"
        onClick={runScan}
        style={{ marginBottom: 15 }}
      >
        Scan for exact-match identity conflicts
      </button>

      {loading ? (
        <p>Loading conflicts…</p>
      ) : conflicts.length === 0 ? (
        <div className="alert alert-secondary">
          No identity conflicts recorded. Run a scan.
        </div>
      ) : (
        conflicts.map((c) => (
          <div
            key={c._id}
            className="card"
            style={{
              padding: 15,
              marginBottom: 12,
              borderLeft: "4px solid var(--color-danger)",
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
              <strong>{c.conflictType}</strong>
              <span className="badge bg-light text-dark border">
                {c.reviewStatus}
              </span>
            </div>
            <div style={{ fontSize: "0.9rem", marginTop: 6 }}>
              Identifier: <code>{c.identifierValue}</code>
            </div>
            {c.regNumbers && c.regNumbers.length > 0 && (
              <div style={{ fontSize: "0.88rem" }}>
                Across records:{" "}
                {c.regNumbers.map((r, i) => (
                  <span
                    key={i}
                    className="badge bg-warning text-dark"
                    style={{ marginRight: 6 }}
                  >
                    {r}
                  </span>
                ))}
              </div>
            )}
            {c.rawValues && c.rawValues.length > 0 && (
              <div style={{ fontSize: "0.8rem", color: "#777", marginTop: 4 }}>
                Raw values: {c.rawValues.join(" | ")}
              </div>
            )}
            <div style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm btn-outline-danger"
                onClick={() => setReviewFor(reviewFor === c._id ? null : c._id)}
              >
                {reviewFor === c._id ? "Close" : "Review"}
              </button>
            </div>
            {reviewFor === c._id && (
              <div className="card" style={{ padding: 12, marginTop: 8 }}>
                <div className="row g-2">
                  <div className="col-md-5">
                    <select
                      className="form-control form-control-sm"
                      value={review.reviewStatus}
                      onChange={(e) =>
                        setReview({ ...review, reviewStatus: e.target.value })
                      }
                    >
                      <option value="under-investigation">
                        Under investigation
                      </option>
                      <option value="legitimate-correction">
                        Legitimate correction
                      </option>
                      <option value="false-positive">False positive</option>
                      <option value="resolved">Resolved</option>
                      <option value="unreviewed">Unreviewed</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <input
                      className="form-control form-control-sm"
                      placeholder="Remarks"
                      value={review.remarks}
                      onChange={(e) =>
                        setReview({ ...review, remarks: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-3">
                    <button
                      className="btn btn-sm btn-danger"
                      style={{ width: "100%" }}
                      onClick={() => saveReview(c._id)}
                    >
                      Save
                    </button>
                  </div>
                  {review.reviewStatus === "under-investigation" && (
                    <div className="col-12">
                      <label className="small">
                        <input
                          type="checkbox"
                          checked={review.openCase}
                          onChange={(e) =>
                            setReview({ ...review, openCase: e.target.checked })
                          }
                        />{" "}
                        Open a linked casebook entry
                      </label>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
