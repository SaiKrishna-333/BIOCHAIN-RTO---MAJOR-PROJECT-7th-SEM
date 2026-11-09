import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import api from "../services/api";
import { useAuth } from "../context/useAuth";
import ViewTransactionButton from "../components/ViewTransactionButton";
import DashboardLayout from "../components/DashboardLayout";
import { SectionCard, KpiCard, KpiStrip, StatusPill } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import { formatDateTime } from "../lib/display";

// Feature 8: Conditional Vehicle Transfer with Multi-Party Approval.
// A configurable, auditable approval checklist layered ON TOP of the existing
// transfer workflow. The on-chain registry is unchanged; the transfer stays
// pending until every mandatory step is approved. The backend returns
// `canDecide` (the step keys this user may act on) and re-validates every
// decision server-side - the UI never grants itself permission.

type ApiError = { response?: { data?: { message?: string } } };
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

interface Step {
  key: string;
  label: string;
  required: boolean;
  status: string;
  actorName?: string;
  actorRole?: string;
  decidedAt?: string;
  reason?: string;
  anchor?: { recordHash?: string; status?: string; txHash?: string | null };
}

interface Workflow {
  _id: string;
  regNumber?: string;
  steps: Step[];
  decisions?: {
    stepKey: string;
    previousStatus: string;
    newStatus: string;
    actorName?: string;
    at: string;
  }[];
  progress: {
    overall: string;
    mandatoryTotal: number;
    mandatoryApproved: number;
    percent: number;
  };
  workflowAnchor?: {
    recordHash?: string;
    status?: string;
    txHash?: string | null;
  };
}

interface TransferRequest {
  _id: string;
  type: string;
  status: string;
  vehicle?: { regNumber: string; make: string; model: string };
  seller?: { name: string };
  buyer?: { name: string };
}

export default function TransferApprovals() {
  const { user } = useAuth();
  const role = user?.role || "";
  const isRto = role === "rto" || role === "admin";

  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [requestId, setRequestId] = useState("");
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [canDecide, setCanDecide] = useState<string[]>([]);
  const [requestStatus, setRequestStatus] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [decision, setDecision] = useState({ decision: "approve", reason: "" });

  const loadTransfers = useCallback(async () => {
    if (!isRto) return [];
    const res = await api.get("/requests/all");
    return (res.data || []).filter(
      (r: TransferRequest) => r.type === "transfer",
    );
  }, [isRto]);

  useEffect(() => {
    let active = true;
    loadTransfers()
      .then((list) => {
        if (active) setRequests(list);
      })
      .catch(() => {
        /* non-RTO simply won't have the dropdown */
      });
    return () => {
      active = false;
    };
  }, [loadTransfers]);

  const viewWorkflow = async (id: string) => {
    if (!id.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const res = await api.get(`/transfer-approvals/${id.trim()}`);
      setExists(res.data.exists);
      setWorkflow(res.data.workflow || null);
      setCanDecide(res.data.canDecide || []);
      setRequestStatus(res.data.requestStatus || null);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load workflow."));
    }
  };

  const initWorkflow = async (id: string) => {
    if (!id.trim()) return;
    setError(null);
    setNotice(null);
    try {
      const res = await api.post(`/transfer-approvals/${id.trim()}/init`, {});
      setNotice("Approval checklist created.");
      setExists(true);
      setWorkflow(res.data.workflow);
      viewWorkflow(id);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to initialize workflow."));
    }
  };

  const decide = async (stepKey: string) => {
    if (!requestId.trim()) return;
    setError(null);
    try {
      const res = await api.post(
        `/transfer-approvals/${requestId.trim()}/steps/${stepKey}/decision`,
        { decision: decision.decision, reason: decision.reason || undefined },
      );
      setNotice(res.data.message);
      setDecision({ decision: "approve", reason: "" });
      setWorkflow(res.data.workflow);
      setCanDecide(
        res.data.workflow.steps
          .filter(
            (s: Step) => s.status !== "approved" && s.status !== "not_required",
          )
          .map((s: Step) => s.key),
      );
    } catch (err: unknown) {
      setError(apiMessage(err, "Decision failed."));
    }
  };

  const statusBadge = (s: string) => {
    const label =
      s === "approved"
        ? "Approved"
        : s === "rejected"
          ? "Rejected"
          : s === "not_required"
            ? "Not required"
            : s === "pending"
              ? "Pending"
              : "Not started";
    return <StatusPill status={s === "not started" ? null : s} label={label} />;
  };

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
            Multi-Party Transfer Approvals
          </h2>
          <Link to="/" className="btn btn-outline-secondary btn-sm">
            Back
          </Link>
        </div>

        <div
          className="alert alert-secondary"
          style={{ fontSize: "0.85rem", marginTop: 15 }}
        >
          This checklist supports the official transfer process. A transfer is
          only finalized once every <strong>mandatory</strong> step is approved.
          Every decision and the overall checklist are hashed and queued for
          their Polygon Amoy commitment - open any Tx button to see whether that
          step is already committed or still waiting for the anchoring fee.
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {notice && <div className="alert alert-info">{notice}</div>}

        <SectionCard
          title="Select a transfer request"
          style={{ marginBottom: 20 }}
        >
          {isRto && requests.length > 0 ? (
            <div className="row g-2" style={{ marginBottom: 12 }}>
              <div className="col-md-8">
                <select
                  className="form-control"
                  value={requestId}
                  onChange={(e) => {
                    setRequestId(e.target.value);
                    setWorkflow(null);
                    setExists(false);
                  }}
                >
                  <option value="">— choose a pending transfer —</option>
                  {requests.map((r) => (
                    <option key={r._id} value={r._id}>
                      {r.vehicle?.regNumber || r._id} — {r.vehicle?.make}{" "}
                      {r.vehicle?.model} ({r.status})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : (
            <p className="small text-muted">
              Paste a transfer request ID to load its checklist.
            </p>
          )}
          <div className="row g-2">
            <div className="col-md-8">
              <input
                className="form-control"
                placeholder="Transfer request ID"
                value={requestId}
                onChange={(e) => {
                  setRequestId(e.target.value);
                  setWorkflow(null);
                  setExists(false);
                }}
              />
            </div>
            <div className="col-md-2">
              <button
                className="btn btn-outline-primary"
                style={{ width: "100%" }}
                onClick={() => viewWorkflow(requestId)}
              >
                Load
              </button>
            </div>
            <div className="col-md-2">
              {isRto && (
                <button
                  className="btn btn-success"
                  style={{ width: "100%" }}
                  onClick={() => initWorkflow(requestId)}
                >
                  Init
                </button>
              )}
            </div>
          </div>
        </SectionCard>

        {exists && workflow && (
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <h5 style={{ margin: 0 }}>
                Checklist — {workflow.regNumber || "vehicle"}
              </h5>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <ViewTransactionButton
                  txHash={workflow.workflowAnchor?.txHash}
                  status={workflow.workflowAnchor?.status}
                  label="View Checklist Anchoring Tx"
                  className="btn btn-sm btn-outline-success"
                />
                <span
                  className={`badge ${
                    workflow.progress.overall === "complete"
                      ? "bg-success"
                      : workflow.progress.overall === "blocked"
                        ? "bg-danger"
                        : "bg-warning text-dark"
                  }`}
                >
                  {workflow.progress.overall} ·{" "}
                  {workflow.progress.mandatoryApproved}/
                  {workflow.progress.mandatoryTotal} mandatory (
                  {workflow.progress.percent}%)
                </span>
              </div>
            </div>
            {requestStatus && (
              <div style={{ fontSize: "0.85rem", color: "#777", marginTop: 4 }}>
                Transfer request status: <strong>{requestStatus}</strong>
                {requestStatus === "approved" || requestStatus === "rejected"
                  ? " (read-only)"
                  : ""}
              </div>
            )}

            <div style={{ margin: "14px 0" }}>
              <KpiStrip>
                <KpiCard
                  label="Overall"
                  value={workflow.progress.overall}
                  sub="checklist state"
                  accent={
                    workflow.progress.overall === "complete"
                      ? BIO.green
                      : workflow.progress.overall === "blocked"
                        ? BIO.red
                        : BIO.amber
                  }
                />
                <KpiCard
                  label="Mandatory Approved"
                  value={`${workflow.progress.mandatoryApproved}/${workflow.progress.mandatoryTotal}`}
                  sub="required steps cleared"
                  accent={BIO.blue}
                />
                <KpiCard
                  label="Steps Tracked"
                  value={workflow.steps.length}
                  sub="in this checklist"
                  accent={BIO.violet}
                />
              </KpiStrip>
              <div
                style={{
                  height: 10,
                  borderRadius: 999,
                  background: BIO.line,
                  marginTop: 14,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${workflow.progress.percent}%`,
                    background: BIO.green,
                    borderRadius: 999,
                    transition: "width .3s ease",
                  }}
                />
              </div>
            </div>

            {workflow.steps.map((s) => (
              <div
                key={s.key}
                className="card"
                style={{ padding: 12, marginBottom: 10 }}
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
                    {s.label}{" "}
                    {!s.required && (
                      <em style={{ color: "#999", fontSize: "0.8rem" }}>
                        (optional)
                      </em>
                    )}
                  </strong>
                  {statusBadge(s.status)}
                  {(s.anchor?.txHash || s.anchor?.status) && (
                    <ViewTransactionButton
                      txHash={s.anchor?.txHash}
                      status={s.anchor?.status}
                      label="Tx"
                      className="btn btn-sm btn-outline-success"
                    />
                  )}
                </div>
                {s.actorName && (
                  <div
                    style={{ fontSize: "0.82rem", color: "#666", marginTop: 4 }}
                  >
                    {s.actorName} {s.actorRole ? `[${s.actorRole}]` : ""}
                    {s.reason ? ` — ${s.reason}` : ""}
                  </div>
                )}
                {canDecide.includes(s.key) &&
                  requestStatus !== "approved" &&
                  requestStatus !== "rejected" && (
                    <div className="row g-2" style={{ marginTop: 8 }}>
                      <div className="col-md-4">
                        <select
                          className="form-control form-control-sm"
                          value={decision.decision}
                          onChange={(e) =>
                            setDecision({
                              ...decision,
                              decision: e.target.value,
                            })
                          }
                        >
                          <option value="approve">Approve</option>
                          <option value="reject">Reject</option>
                          <option value="not-required">Not required</option>
                        </select>
                      </div>
                      <div className="col-md-6">
                        <input
                          className="form-control form-control-sm"
                          placeholder="Reason (required to reject)"
                          value={decision.reason}
                          onChange={(e) =>
                            setDecision({ ...decision, reason: e.target.value })
                          }
                        />
                      </div>
                      <div className="col-md-2">
                        <button
                          className="btn btn-sm btn-primary"
                          style={{ width: "100%" }}
                          onClick={() => decide(s.key)}
                        >
                          Submit
                        </button>
                      </div>
                    </div>
                  )}
              </div>
            ))}

            {workflow.decisions && workflow.decisions.length > 0 && (
              <div
                style={{ marginTop: 10, fontSize: "0.82rem", color: "#555" }}
              >
                <strong>Audit trail (append-only):</strong>
                {workflow.decisions.map((d, i) => (
                  <div key={i} style={{ marginLeft: 8 }}>
                    • {formatDateTime(d.at)} — {d.stepKey}:{" "}
                    {d.previousStatus} to {d.newStatus}{" "}
                    {d.actorName ? `[${d.actorName}]` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {!exists &&
          requestId &&
          workflow === null &&
          notice === null &&
          error === null && (
            <p className="text-muted">
              No workflow loaded yet. Choose/paste a request and press Load (RTO
              can Init a checklist).
            </p>
          )}
      </div>
    </DashboardLayout>
  );
}
