// VehicleForensics.tsx
// Vehicle Lifecycle Forensics & Event Replay Engine console.
//
// An investigator searches a registration number, reconstructs the recorded sequence
// of events, clicks each event to compare the vehicle state before and after it, and
// traces an inconsistency to the event and evidence where it first appeared, along
// with the later records that depend on it. A valid hash proves only that recorded
// data is unchanged since hashing - never that it is truthful or roadworthy.
import { useCallback, useState } from "react";
import api from "../services/api";
import DashboardLayout from "../components/DashboardLayout";
import ViewTransactionButton from "../components/ViewTransactionButton";
import { formatDate, formatDateTime, roleLabel } from "../lib/display";
import { notify } from "../lib/notify";
import { KpiCard, KpiStrip, SectionCard } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

type Actor = { id?: string; name?: string; role?: string } | null;
type Change = {
  field: string;
  previousValue: string | null;
  newValue: string | null;
};
type Evidence = {
  label: string;
  present: boolean;
  reference?: string | null;
  sha256?: string | null;
};
type Approval = {
  required: boolean;
  present: boolean;
  reference?: string | null;
  note?: string | null;
};
type Integrity = {
  available: boolean;
  recordHash?: string | null;
  status?: string | null;
  txHash?: string | null;
  network?: string | null;
  anchoredAt?: string | null;
  note?: string | null;
};
type EventItem = {
  id: string;
  sequence: number;
  eventType: string;
  occurredAt: string;
  title: string;
  summary: string;
  actor: Actor;
  changes: Change[];
  evidence: Evidence[];
  approval: Approval;
  status: string;
  source: { collection: string; id: string };
  integrity: Integrity;
};
type Conflict = {
  type: string;
  severity: string;
  title: string;
  detail: string;
  disputedField?: string | null;
  disputedValue?: string | null;
  previousValue?: string | null;
  firstAppearedEventId?: string | null;
  firstAppearedSequence?: number | null;
  involvedEventIds: string[];
  dependentEventIds: string[];
};
type Replay = {
  vehicle: {
    id: string;
    regNumber: string;
    make: string;
    model: string;
    year: number;
    status: string;
  };
  currentIdentity: {
    engineNumber: string;
    chassisNumber: string;
    regNumber: string;
  };
  events: EventItem[];
  conflicts: Conflict[];
  dependencyGraph?: {
    nodes: {
      id: string;
      type: string;
      title: string;
      sequence: number;
      status: string;
    }[];
    edges: { from: string; to: string; relation: string }[];
  };
  integritySummary: {
    anchored: number;
    pending: number;
    hashedOnly: number;
    noProof: number;
    total: number;
  };
  disclaimer: string;
};

type VehicleState = {
  owner: string | null;
  engineNumber: string | null;
  chassisNumber: string | null;
  regNumber: string | null;
  odometerKm: string | null;
  theftStatus: string | null;
  challanStatus: string | null;
  assessmentStatus: string | null;
};
type CompareResult = {
  from: { sequence: number; title: string; state: VehicleState };
  to: { sequence: number; title: string; state: VehicleState };
  differences: {
    field: string;
    earlierValue: string | null;
    laterValue: string | null;
    introducedBySequence: number | null;
  }[];
  note: string;
};

type ApiError = { response?: { data?: { message?: string } } };
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

const STATUS_COLOR: Record<string, string> = {
  recorded: "#1e5aa8",
  approved: "#2f855a",
  verified: "#2f855a",
  "needs-review": "#b7791f",
  pending: "#b7791f",
  conflict: "#c53030",
};

const statusBadge = (status: string) => {
  const color = STATUS_COLOR[status] || "#4a5568";
  const label =
    status === "needs-review"
      ? "Needs review"
      : status.charAt(0).toUpperCase() + status.slice(1);
  return (
    <span
      className="badge"
      style={{ background: color, color: "#fff", textTransform: "none" }}
    >
      {label}
    </span>
  );
};

export default function VehicleForensics() {
  const [reg, setReg] = useState("");
  const [recon, setRecon] = useState<Replay | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<Record<string, unknown> | null>(
    null,
  );
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [stateAt, setStateAt] = useState<{
    event: { sequence: number; title: string; occurredAt: string };
    state: VehicleState;
  } | null>(null);
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [linkedCase, setLinkedCase] = useState<{
    caseRef: string;
    created: boolean;
  } | null>(null);

  const reconstruct = useCallback(async (registration: string) => {
    setLoading(true);
    setError(null);
    setIntegrity(null);
    setReport(null);
    setStateAt(null);
    setCompare(null);
    setLinkedCase(null);
    setFromId("");
    setToId("");
    try {
      const res = await api.get(
        `/forensics/replay-by-reg/${encodeURIComponent(registration.trim())}`,
      );
      setRecon(res.data as Replay);
      setSelectedId(null);
    } catch (err: unknown) {
      setRecon(null);
      setError(apiMessage(err, "Could not reconstruct the vehicle history."));
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reg.trim()) {
      setError("Enter a registration number to reconstruct.");
      return;
    }
    reconstruct(reg);
  };

  const verifyIntegrity = async () => {
    if (!recon) return;
    try {
      const res = await api.post(
        `/forensics/verify-integrity/${recon.vehicle.id}`,
      );
      setIntegrity(res.data as Record<string, unknown>);
      notify("Integrity recomputed from the recorded hashes.", "info");
    } catch (err: unknown) {
      notify(apiMessage(err, "Integrity check failed."), "error");
    }
  };

  const generateReport = async () => {
    if (!recon) return;
    try {
      const res = await api.get(`/forensics/report/${recon.vehicle.id}`);
      setReport((res.data as { report: Record<string, unknown> }).report);
    } catch (err: unknown) {
      notify(apiMessage(err, "Report generation failed."), "error");
    }
  };

  // Replay the recorded state up to one event. Fields never recorded come back
  // null and are shown as "not recorded", never filled in.
  const replayTo = async (eventId: string) => {
    if (!recon) return;
    try {
      const res = await api.get(`/forensics/state-at/${recon.vehicle.id}`, {
        params: { eventId },
      });
      const d = res.data as {
        event: { sequence: number; title: string; occurredAt: string };
        state: VehicleState;
      };
      setStateAt({ event: d.event, state: d.state });
      setSelectedId(eventId);
    } catch (err: unknown) {
      notify(apiMessage(err, "Could not replay to that event."), "error");
    }
  };

  const doCompare = async () => {
    if (!recon || !fromId || !toId) {
      notify("Choose two events to compare.", "info");
      return;
    }
    try {
      const res = await api.get(`/forensics/compare/${recon.vehicle.id}`, {
        params: { from: fromId, to: toId },
      });
      setCompare(res.data as CompareResult);
    } catch (err: unknown) {
      notify(apiMessage(err, "Could not compare the two states."), "error");
    }
  };

  // The one permitted write: attach a finding to the investigation casebook.
  const linkCase = async (conflict: Conflict) => {
    if (!recon) return;
    try {
      const res = await api.post(`/forensics/link-case/${recon.vehicle.id}`, {
        conflict,
      });
      const d = res.data as { caseRef: string; created: boolean };
      setLinkedCase({ caseRef: d.caseRef, created: d.created });
      notify(
        d.created
          ? `Opened case ${d.caseRef} from this finding.`
          : `Added the finding to case ${d.caseRef}.`,
        "success",
      );
    } catch (err: unknown) {
      notify(apiMessage(err, "Could not link the finding to a case."), "error");
    }
  };

  const selected = recon?.events.find((ev) => ev.id === selectedId) || null;

  return (
    <DashboardLayout
      title="Vehicle Lifecycle Forensics & Event Replay"
      subtitle="Reconstruct the recorded sequence, compare states over time, and trace inconsistencies to their origin."
    >
      <div className="container" style={{ marginTop: 10, marginBottom: 40 }}>
        <form
          onSubmit={handleSearch}
          className="card"
          style={{ padding: 20, marginBottom: 20 }}
        >
          <div className="row g-2 align-items-end">
            <div className="col-md-5">
              <label style={{ fontWeight: 600 }}>
                Vehicle registration number
              </label>
              <input
                className="form-control"
                placeholder="e.g. KA-06-AB-1234"
                value={reg}
                onChange={(e) => setReg(e.target.value)}
              />
            </div>
            <div className="col-md-3">
              <button
                className="btn btn-primary"
                type="submit"
                disabled={loading}
                style={{ width: "100%" }}
              >
                {loading ? "Reconstructing…" : "Reconstruct Vehicle History"}
              </button>
            </div>
          </div>
        </form>

        {error && <div className="alert alert-danger">{error}</div>}

        {recon && (
          <>
            <div className="card" style={{ padding: 16, marginBottom: 18 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 12,
                }}
              >
                <div>
                  <h5 style={{ margin: 0, color: "#1e5aa8" }}>
                    {recon.vehicle.regNumber} — {recon.vehicle.make}{" "}
                    {recon.vehicle.model} ({recon.vehicle.year})
                  </h5>
                  <div
                    style={{ fontSize: "0.9rem", color: "#555", marginTop: 4 }}
                  >
                    Latest record: engine{" "}
                    <strong>{recon.currentIdentity.engineNumber || "—"}</strong>{" "}
                    · chassis{" "}
                    <strong>
                      {recon.currentIdentity.chassisNumber || "—"}
                    </strong>{" "}
                    · status <strong>{recon.vehicle.status}</strong>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    alignItems: "center",
                  }}
                >
                  <span className="badge bg-light text-dark border">
                    {recon.events.length} events
                  </span>
                  <span
                    className={`badge ${recon.conflicts.length ? "bg-warning text-dark" : "bg-success"}`}
                  >
                    {recon.conflicts.length} to review
                  </span>
                  <button
                    className="btn btn-sm btn-outline-primary"
                    onClick={verifyIntegrity}
                  >
                    Verify integrity
                  </button>
                  <button
                    className="btn btn-sm btn-outline-dark"
                    onClick={generateReport}
                  >
                    Generate report
                  </button>
                </div>
              </div>
            </div>

            {recon.conflicts.length > 0 && (
              <div className="alert alert-warning" style={{ marginBottom: 18 }}>
                <strong>Conflict tracing</strong>
                <ul style={{ margin: "8px 0 0", paddingLeft: 20 }}>
                  {recon.conflicts.map((c, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <strong>{c.title}</strong> (
                      {c.severity === "needs-review"
                        ? "needs review"
                        : "for information"}
                      )<div style={{ fontSize: "0.88rem" }}>{c.detail}</div>
                      <button
                        className="btn btn-sm btn-outline-danger"
                        style={{ marginTop: 4 }}
                        onClick={() => linkCase(c)}
                      >
                        Link finding to casebook
                      </button>
                      {c.dependentEventIds?.length > 0 && (
                        <div style={{ fontSize: "0.85rem", color: "#7a5b00" }}>
                          Later records that depend on this value:{" "}
                          {c.dependentEventIds
                            .map(
                              (id) =>
                                recon.events.find((e) => e.id === id)?.sequence,
                            )
                            .filter(Boolean)
                            .join(", ")}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Compare two recorded states + dependency graph */}
            <div
              className="card"
              style={{ padding: 16, marginBottom: 18, background: "#f7fafc" }}
            >
              <h6 style={{ color: "#2c3e50" }}>
                Compare the recorded state between two events
              </h6>
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  flexWrap: "wrap",
                  alignItems: "flex-end",
                }}
              >
                <div style={{ minWidth: 220 }}>
                  <label style={{ fontSize: "0.8rem" }}>From event</label>
                  <select
                    className="form-select form-select-sm"
                    value={fromId}
                    onChange={(e) => setFromId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {recon.events.map((e) => (
                      <option key={e.id} value={e.id}>
                        #{e.sequence} · {e.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ minWidth: 220 }}>
                  <label style={{ fontSize: "0.8rem" }}>To event</label>
                  <select
                    className="form-select form-select-sm"
                    value={toId}
                    onChange={(e) => setToId(e.target.value)}
                  >
                    <option value="">Select…</option>
                    {recon.events.map((e) => (
                      <option key={e.id} value={e.id}>
                        #{e.sequence} · {e.title}
                      </option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-sm btn-primary" onClick={doCompare}>
                  Compare
                </button>
              </div>
              {compare && (
                <div style={{ marginTop: 10 }}>
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Earlier</th>
                        <th>Later</th>
                        <th>Changed at</th>
                      </tr>
                    </thead>
                    <tbody>
                      {compare.differences.map((d, i) => (
                        <tr key={i}>
                          <td>{d.field}</td>
                          <td>{d.earlierValue ?? "not recorded"}</td>
                          <td>
                            <strong>{d.laterValue ?? "not recorded"}</strong>
                          </td>
                          <td>
                            {d.introducedBySequence
                              ? `event #${d.introducedBySequence}`
                              : "—"}
                          </td>
                        </tr>
                      ))}
                      {compare.differences.length === 0 && (
                        <tr>
                          <td colSpan={4} style={{ color: "#777" }}>
                            No recorded difference between the two points.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <div style={{ fontSize: "0.8rem", color: "#888" }}>
                    {compare.note}
                  </div>
                </div>
              )}
            </div>

            <KpiStrip>
              <KpiCard
                label="Reconstructed events"
                value={recon.events.length}
                accent={BIO.blue}
              />
              <KpiCard
                label="On-chain anchored"
                value={recon.integritySummary.anchored}
                accent={BIO.green}
                sub="Hash + tx present"
              />
              <KpiCard
                label="Hashed only"
                value={recon.integritySummary.hashedOnly}
                accent={BIO.violet}
                sub="Unchanged since hashing"
              />
              <KpiCard
                label="No proof"
                value={recon.integritySummary.noProof}
                accent={BIO.amber}
                sub="Nothing to verify yet"
              />
              <KpiCard
                label="Findings"
                value={recon.conflicts.length}
                accent={BIO.red}
                sub="Inconsistencies to review"
              />
            </KpiStrip>

            {recon.dependencyGraph &&
              recon.dependencyGraph.nodes.length > 0 && (
                <SectionCard
                  title="Event dependency graph"
                  subtitle="Drag to move, scroll to zoom, use the controls to fit. Click a node to focus that event in the replay below."
                  style={{ marginBottom: 18 }}
                >
                  <div style={{ height: 400 }}>
                    {(() => {
                      const bySeq = new Map<number, number>();
                      const nodes: Node[] = recon.dependencyGraph!.nodes.map(
                        (n) => {
                          const seq = Number.isFinite(n.sequence)
                            ? n.sequence
                            : 0;
                          const row = bySeq.get(seq) ?? 0;
                          bySeq.set(seq, row + 1);
                          return {
                            id: n.id,
                            position: { x: seq * 260, y: row * 128 },
                            data: {
                              label: `#${n.sequence} ${n.title || n.type}`,
                            },
                            style: {
                              background: STATUS_COLOR[n.status] || "#1e5aa8",
                              color: "#fff",
                              border: "none",
                              borderRadius: 8,
                              padding: 10,
                              fontSize: 12,
                              width: 210,
                            },
                          };
                        },
                      );
                      const ids = new Set(nodes.map((x) => x.id));
                      const edges: Edge[] = recon
                        .dependencyGraph!.edges.filter(
                          (e) => ids.has(e.from) && ids.has(e.to),
                        )
                        .map((e, i) => ({
                          id: `e${i}`,
                          source: e.from,
                          target: e.to,
                          label: e.relation,
                          style: { stroke: "#8896a6" },
                          labelStyle: { fontSize: 10, fill: "#44506a" },
                        }));
                      return (
                        <ReactFlow
                          nodes={nodes}
                          edges={edges}
                          fitView
                          minZoom={0.3}
                          proOptions={{ hideAttribution: true }}
                          onNodeClick={(_, node) => setSelectedId(node.id)}
                        >
                          <Background gap={16} size={1} />
                          <Controls />
                          <MiniMap
                            pannable
                            zoomable
                            nodeColor={() => "#1e5aa8"}
                          />
                        </ReactFlow>
                      );
                    })()}
                  </div>
                  <div
                    style={{ fontSize: "0.78rem", color: "#888", marginTop: 8 }}
                  >
                    Edges come from concrete references in the records (an
                    assessment's linked accident, a transfer following the prior
                    owner, a disputed value carried into later records). Nothing
                    here is inferred that the records do not state.
                  </div>
                </SectionCard>
              )}

            {linkedCase && (
              <div
                className="alert alert-success"
                style={{ marginBottom: 18, fontSize: "0.9rem" }}
              >
                Finding recorded in the investigation casebook as{" "}
                <strong>{linkedCase.caseRef}</strong>. The source records were
                not modified.
              </div>
            )}

            <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
              {/* Timeline */}
              <div style={{ flex: "1 1 340px", minWidth: 300 }}>
                <h5 style={{ color: "#2c3e50" }}>Event replay</h5>
                <div style={{ position: "relative", paddingLeft: 24 }}>
                  <div
                    style={{
                      position: "absolute",
                      left: 8,
                      top: 0,
                      bottom: 0,
                      width: 2,
                      background: "#1e5aa855",
                    }}
                  />
                  {recon.events.map((ev) => {
                    const isConflict = recon.conflicts.some(
                      (c) => c.firstAppearedEventId === ev.id,
                    );
                    return (
                      <button
                        key={ev.id}
                        onClick={() => setSelectedId(ev.id)}
                        className="card"
                        style={{
                          padding: 12,
                          marginBottom: 12,
                          position: "relative",
                          width: "100%",
                          textAlign: "left",
                          cursor: "pointer",
                          border:
                            selectedId === ev.id
                              ? "2px solid #1e5aa8"
                              : isConflict
                                ? "2px solid #b7791f"
                                : "1px solid #e2e8f0",
                          background: "#fff",
                        }}
                      >
                        <div
                          style={{
                            position: "absolute",
                            left: -22,
                            top: 16,
                            width: 12,
                            height: 12,
                            borderRadius: "50%",
                            background: STATUS_COLOR[ev.status] || "#1e5aa8",
                          }}
                        />
                        <div
                          style={{
                            display: "flex",
                            justifyContent: "space-between",
                            gap: 8,
                          }}
                        >
                          <strong style={{ color: "#2c3e50" }}>
                            {formatDate(ev.occurredAt)}
                          </strong>
                          {statusBadge(ev.status)}
                        </div>
                        <div style={{ marginTop: 4 }}>{ev.title}</div>
                        <div style={{ fontSize: "0.85rem", color: "#666" }}>
                          {ev.summary}
                        </div>
                      </button>
                    );
                  })}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    flexWrap: "wrap",
                    fontSize: "0.8rem",
                    color: "#555",
                    marginTop: 8,
                  }}
                >
                  {Object.entries({
                    Recorded: "#1e5aa8",
                    Approved: "#2f855a",
                    "Needs review": "#b7791f",
                  }).map(([l, c]) => (
                    <span key={l}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 10,
                          height: 10,
                          borderRadius: "50%",
                          background: c,
                          marginRight: 4,
                        }}
                      />
                      {l}
                    </span>
                  ))}
                </div>
              </div>

              {/* Detail panel */}
              <div style={{ flex: "1 1 360px", minWidth: 320 }}>
                <h5 style={{ color: "#2c3e50" }}>Selected event</h5>
                {!selected && (
                  <div className="alert alert-secondary">
                    Select an event to inspect its recorded state and evidence.
                  </div>
                )}
                {selected && (
                  <div className="card" style={{ padding: 16 }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                      }}
                    >
                      <h6 style={{ margin: 0 }}>{selected.title}</h6>
                      {statusBadge(selected.status)}
                    </div>
                    <button
                      className="btn btn-sm btn-outline-primary"
                      style={{ marginTop: 8 }}
                      onClick={() => replayTo(selected.id)}
                    >
                      Replay state up to this event
                    </button>
                    {stateAt &&
                      stateAt.event.sequence === selected.sequence && (
                        <div
                          className="alert alert-secondary"
                          style={{
                            marginTop: 8,
                            fontSize: "0.85rem",
                            padding: "8px 10px",
                          }}
                        >
                          <strong>
                            Recorded state at event #{stateAt.event.sequence}
                          </strong>
                          <table
                            className="table table-sm"
                            style={{ margin: "6px 0 0" }}
                          >
                            <tbody>
                              {Object.entries(stateAt.state).map(([k, v]) => (
                                <tr key={k}>
                                  <td style={{ width: "45%" }}>{k}</td>
                                  <td>
                                    {v ?? (
                                      <span style={{ color: "#888" }}>
                                        not recorded
                                      </span>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <div style={{ color: "#888", fontSize: "0.78rem" }}>
                            Fields shown as “not recorded” had no recorded value
                            at that point; the engine never fills them in.
                          </div>
                        </div>
                      )}
                    <p style={{ color: "#555", marginTop: 6 }}>
                      {selected.summary}
                    </p>

                    <table className="table table-sm" style={{ marginTop: 8 }}>
                      <tbody>
                        <tr>
                          <td style={{ width: "40%" }}>Event time</td>
                          <td>{formatDateTime(selected.occurredAt)}</td>
                        </tr>
                        <tr>
                          <td>Type</td>
                          <td>{selected.eventType}</td>
                        </tr>
                        <tr>
                          <td>Recorded by</td>
                          <td>
                            {selected.actor
                              ? `${selected.actor.name || "—"}${selected.actor.role ? ` (${roleLabel(selected.actor.role)})` : ""}`
                              : "—"}
                          </td>
                        </tr>
                        <tr>
                          <td>Source record</td>
                          <td>{selected.source.collection}</td>
                        </tr>
                      </tbody>
                    </table>

                    <h6 style={{ marginTop: 10 }}>State change</h6>
                    <table className="table table-sm">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Previous</th>
                          <th>Recorded now</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.changes.map((ch, i) => (
                          <tr key={i}>
                            <td>{ch.field}</td>
                            <td>{ch.previousValue ?? "—"}</td>
                            <td>
                              <strong>{ch.newValue ?? "—"}</strong>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <h6 style={{ marginTop: 10 }}>Approval / evidence</h6>
                    {selected.approval.required ? (
                      selected.approval.present ? (
                        <div
                          className="alert alert-success"
                          style={{ padding: "6px 10px", fontSize: "0.88rem" }}
                        >
                          Supporting reference recorded
                          {selected.approval.reference
                            ? `: ${selected.approval.reference}`
                            : ""}
                          .
                        </div>
                      ) : (
                        <div
                          className="alert alert-warning"
                          style={{ padding: "6px 10px", fontSize: "0.88rem" }}
                        >
                          {selected.approval.note ||
                            "Required approval / evidence reference is missing."}
                        </div>
                      )
                    ) : (
                      <div style={{ fontSize: "0.88rem", color: "#666" }}>
                        No independent approval required for this event.
                      </div>
                    )}

                    {selected.evidence.length > 0 && (
                      <>
                        <h6 style={{ marginTop: 10 }}>Evidence</h6>
                        <ul style={{ fontSize: "0.88rem", paddingLeft: 18 }}>
                          {selected.evidence.map((evd, i) => (
                            <li key={i}>
                              {evd.label}: {evd.present ? "present" : "missing"}
                              {evd.sha256 ? (
                                <span style={{ color: "#888" }}>
                                  {" "}
                                  · sha256 {evd.sha256.slice(0, 12)}…
                                </span>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    <h6 style={{ marginTop: 10 }}>Integrity proof</h6>
                    {selected.integrity.available ? (
                      <div style={{ fontSize: "0.88rem" }}>
                        <ViewTransactionButton
                          txHash={selected.integrity.txHash}
                          status={selected.integrity.status}
                          label="View transaction"
                          className="btn btn-sm btn-outline-success"
                        />
                        {selected.integrity.recordHash && (
                          <div
                            style={{
                              color: "#666",
                              wordBreak: "break-all",
                              marginTop: 4,
                            }}
                          >
                            Record hash: {selected.integrity.recordHash}
                          </div>
                        )}
                        <div style={{ color: "#888", marginTop: 4 }}>
                          A matching hash proves the recorded data has not
                          changed since it was hashed. It does not prove the
                          information is truthful or that a repair was
                          legitimate.
                        </div>
                      </div>
                    ) : (
                      <div style={{ fontSize: "0.88rem", color: "#888" }}>
                        {selected.integrity.note ||
                          "No integrity proof recorded."}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {integrity && <IntegrityBlock data={integrity} />}
            {report && (
              <ReportBlock data={report} onClose={() => setReport(null)} />
            )}
          </>
        )}

        {!recon && !loading && (
          <div className="alert alert-secondary">
            Search a vehicle to replay its recorded lifecycle. Reconstruction
            reads only the events the application already stores; it never
            changes a production record.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

function IntegrityBlock({ data }: { data: Record<string, unknown> }) {
  const results =
    (data.results as {
      eventId: string;
      description: string;
      verified: boolean;
      reason: string;
      anchorStatus?: string;
    }[]) || [];
  return (
    <div className="card" style={{ padding: 16, marginTop: 20 }}>
      <h5>Integrity verification</h5>
      {results.length === 0 && (
        <div style={{ color: "#666" }}>
          No hashable records found for this vehicle.
        </div>
      )}
      {results.map((r) => (
        <div
          key={r.eventId}
          className={`alert ${r.verified ? "alert-success" : "alert-danger"}`}
          style={{ padding: "6px 10px", fontSize: "0.88rem", marginBottom: 6 }}
        >
          <strong>{r.description}</strong> — {r.reason}
        </div>
      ))}
    </div>
  );
}

function ReportBlock({
  data,
  onClose,
}: {
  data: Record<string, unknown>;
  onClose: () => void;
}) {
  const vehicle = data.vehicle as
    | { regNumber: string; make: string; model: string }
    | undefined;
  const findings =
    (data.findings as { title: string; detail: string; severity: string }[]) ||
    [];
  return (
    <div
      className="card"
      style={{ padding: 20, marginTop: 20 }}
      id="forensics-report"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h4 style={{ margin: 0, color: "#1e5aa8" }}>Investigation Report</h4>
        <div
          className="d-flex gap-2"
          style={{ printColorAdjust: "exact" } as React.CSSProperties}
        >
          <button
            className="btn btn-sm btn-outline-dark"
            onClick={() => {
              // Isolate the report on the page (see @media print rule in
              // index.css) so "Print / Save PDF" produces a clean one-document
              // export instead of the whole console.
              document.body.classList.add("biochain-print-report");
              const done = () =>
                document.body.classList.remove("biochain-print-report");
              window.addEventListener("afterprint", done, { once: true });
              window.print();
              // Some browsers skip afterprint; a trailing clear keeps state sane.
              setTimeout(done, 1500);
            }}
          >
            Print / Save PDF
          </button>
          <button
            className="btn btn-sm btn-outline-secondary"
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
      <p style={{ color: "#555", marginTop: 8 }}>
        Vehicle {vehicle?.regNumber} ({vehicle?.make} {vehicle?.model}) ·
        Generated {formatDateTime(data.generatedAt as string)} ·{" "}
        {String(data.eventCount)} events replayed · {String(data.conflictCount)}{" "}
        finding(s).
      </p>
      <h6>Findings</h6>
      {findings.length === 0 && (
        <div style={{ color: "#666" }}>
          No identity inconsistencies detected.
        </div>
      )}
      <ul style={{ paddingLeft: 18 }}>
        {findings.map((f, i) => (
          <li key={i} style={{ marginBottom: 6 }}>
            <strong>{f.title}</strong> ({f.severity}) — {f.detail}
          </li>
        ))}
      </ul>
      <h6>Conclusion</h6>
      <p>{String(data.conclusion)}</p>
      <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
        {String(data.disclaimer)}
      </div>
    </div>
  );
}
