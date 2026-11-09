import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import ViewTransactionButton from "./ViewTransactionButton";
import { formatDate } from "../lib/display";

// Feature 2: Critical Vehicle Parts Provenance Tracker
// Serialized components (engine, battery pack, gearbox…) with an append-only
// lifecycle. A serial ACTIVE on two vehicles is flagged as a CONFLICT for
// investigation only - never an automatic fraud verdict.

type ApiError = {
  response?: { data?: { message?: string; errors?: string[] } };
};
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

interface ComponentEvent {
  _id?: string;
  eventType: string;
  eventDate: string;
  reason?: string;
  workshopName?: string;
  inspectionResult?: string;
}

interface Component {
  _id: string;
  componentType: string;
  serialNumber: string;
  status: string;
  conflict?: {
    flagged: boolean;
    reason?: string;
    reviewStatus?: string;
  };
  anchor?: { recordHash?: string; status?: string; txHash?: string | null };
  events?: ComponentEvent[];
}

const COMPONENT_TYPES = [
  "engine",
  "battery-pack",
  "gearbox",
  "transmission",
  "motor",
  "chassis-panel",
  "other",
];

const EVENT_TYPES = ["installed", "removed", "replaced", "inspected"];

export default function PartsProvenanceTab({
  vehicleId,
  canSubmit,
  isOfficer,
}: {
  vehicleId: string;
  canSubmit: boolean;
  isOfficer: boolean;
}) {
  const [components, setComponents] = useState<Component[]>([]);
  const [summary, setSummary] = useState<{
    totalComponents: number;
    conflicts: number;
    note: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [eventFor, setEventFor] = useState<string | null>(null);
  const [conflictFor, setConflictFor] = useState<string | null>(null);

  const [form, setForm] = useState({
    componentType: "engine",
    serialNumber: "",
    installationDate: "",
    reason: "",
  });
  const [event, setEvent] = useState({
    eventType: "inspected",
    eventDate: "",
    reason: "",
    inspectionResult: "pass",
  });
  const [conflictReview, setConflictReview] = useState({
    reviewStatus: "under-investigation",
    remarks: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/components`,
      );
      setComponents(res.data.components || []);
      setSummary(res.data.summary);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load components."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  const registerComponent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await api.post(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/components`,
        { ...form, installationDate: form.installationDate || undefined },
      );
      setNotice(res.data.message);
      setShowForm(false);
      setForm({
        componentType: "engine",
        serialNumber: "",
        installationDate: "",
        reason: "",
      });
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(
        errs
          ? errs.join(" ")
          : apiMessage(err, "Failed to register component."),
      );
    }
  };

  const addEvent = async (componentId: string) => {
    setError(null);
    setNotice(null);
    try {
      await api.post(`/vehicle-intelligence/components/${componentId}/events`, {
        ...event,
        eventDate: event.eventDate || undefined,
      });
      setEventFor(null);
      setEvent({
        eventType: "inspected",
        eventDate: "",
        reason: "",
        inspectionResult: "pass",
      });
      setNotice("Lifecycle event recorded (history preserved).");
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(
        errs ? errs.join(" ") : apiMessage(err, "Failed to record event."),
      );
    }
  };

  const resolveConflict = async (componentId: string) => {
    setError(null);
    try {
      await api.patch(
        `/vehicle-intelligence/components/${componentId}/conflict`,
        conflictReview,
      );
      setConflictFor(null);
      setConflictReview({ reviewStatus: "under-investigation", remarks: "" });
      setNotice("Conflict review status updated.");
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to update conflict review."));
    }
  };

  const statusBadge = (c: Component) => {
    if (c.conflict?.flagged)
      return <span className="badge bg-danger">Serial conflict</span>;
    if (c.status === "active")
      return <span className="badge bg-success">Active</span>;
    if (c.status === "replaced")
      return <span className="badge bg-info text-dark">Replaced</span>;
    if (c.status === "removed")
      return <span className="badge bg-secondary">Removed</span>;
    return <span className="badge bg-light text-dark border">{c.status}</span>;
  };

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      {summary && summary.conflicts > 0 && (
        <div className="alert alert-warning">
          {summary.note} A conflicting serial is a prompt for human review —
          not proof of fraud.
        </div>
      )}

      <div
        style={{ display: "flex", gap: 15, flexWrap: "wrap", marginBottom: 20 }}
      >
        <div className="card" style={{ padding: 15, minWidth: 180 }}>
          <strong>{summary?.totalComponents ?? 0}</strong> serialized components
        </div>
        <div className="card" style={{ padding: 15, minWidth: 180 }}>
          Conflicts: <strong>{summary?.conflicts ?? 0}</strong>
        </div>
      </div>

      {canSubmit && (
        <div style={{ marginBottom: 20 }}>
          {!showForm ? (
            <button
              className="btn btn-success"
              onClick={() => setShowForm(true)}
            >
              + Register Component
            </button>
          ) : (
            <form
              onSubmit={registerComponent}
              className="card"
              style={{ padding: 20 }}
            >
              <h5>Register Serialized Component</h5>
              <div className="row g-3">
                <div className="col-md-3">
                  <label>Component Type</label>
                  <select
                    className="form-control"
                    value={form.componentType}
                    onChange={(e) =>
                      setForm({ ...form, componentType: e.target.value })
                    }
                  >
                    {COMPONENT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="col-md-3">
                  <label>Serial Number</label>
                  <input
                    className="form-control"
                    required
                    minLength={4}
                    placeholder="ENG-1A2B3C"
                    value={form.serialNumber}
                    onChange={(e) =>
                      setForm({ ...form, serialNumber: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-3">
                  <label>Installation Date (optional)</label>
                  <input
                    type="date"
                    className="form-control"
                    max={new Date().toISOString().slice(0, 10)}
                    value={form.installationDate}
                    onChange={(e) =>
                      setForm({ ...form, installationDate: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-3">
                  <label>Reason / Note</label>
                  <input
                    className="form-control"
                    placeholder="Fitted at authorized centre"
                    value={form.reason}
                    onChange={(e) =>
                      setForm({ ...form, reason: e.target.value })
                    }
                  />
                </div>
              </div>
              <div style={{ marginTop: 15 }}>
                <button type="submit" className="btn btn-primary">
                  Save Component
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
      )}

      {loading ? (
        <p>Loading components…</p>
      ) : components.length === 0 ? (
        <div className="alert alert-secondary">
          No serialized components recorded yet.
        </div>
      ) : (
        components.map((c) => (
          <div
            key={c._id}
            className="card"
            style={{ padding: 15, marginBottom: 15 }}
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
                {c.componentType} · <code>{c.serialNumber}</code>
              </strong>
              {statusBadge(c)}
            </div>
            {c.conflict?.flagged && (
              <div
                className="alert alert-warning"
                style={{ marginTop: 10, fontSize: "0.88rem" }}
              >
                {c.conflict.reason}
                <div style={{ marginTop: 4 }}>
                  <em>
                    Review status: {c.conflict.reviewStatus || "unreviewed"}
                  </em>
                </div>
              </div>
            )}
            <div
              style={{
                marginTop: 10,
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
              }}
            >
              <ViewTransactionButton
                txHash={c.anchor?.txHash}
                status={c.anchor?.status}
                label="Tx"
                className="btn btn-sm btn-outline-success"
              />
              {canSubmit && (
                <button
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => setEventFor(eventFor === c._id ? null : c._id)}
                >
                  {eventFor === c._id ? "Close" : "+ Lifecycle event"}
                </button>
              )}
              {isOfficer && c.conflict?.flagged && (
                <button
                  className="btn btn-sm btn-outline-warning"
                  onClick={() =>
                    setConflictFor(conflictFor === c._id ? null : c._id)
                  }
                >
                  {conflictFor === c._id ? "Close review" : "Review conflict"}
                </button>
              )}
            </div>

            {eventFor === c._id && (
              <div className="card" style={{ padding: 12, marginTop: 10 }}>
                <div className="row g-2">
                  <div className="col-md-3">
                    <select
                      className="form-control form-control-sm"
                      value={event.eventType}
                      onChange={(e) =>
                        setEvent({ ...event, eventType: e.target.value })
                      }
                    >
                      {EVENT_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="col-md-3">
                    <input
                      type="date"
                      className="form-control form-control-sm"
                      max={new Date().toISOString().slice(0, 10)}
                      value={event.eventDate}
                      onChange={(e) =>
                        setEvent({ ...event, eventDate: e.target.value })
                      }
                    />
                  </div>
                  {event.eventType === "inspected" && (
                    <div className="col-md-2">
                      <select
                        className="form-control form-control-sm"
                        value={event.inspectionResult}
                        onChange={(e) =>
                          setEvent({
                            ...event,
                            inspectionResult: e.target.value,
                          })
                        }
                      >
                        <option value="pass">Pass</option>
                        <option value="fail">Fail</option>
                      </select>
                    </div>
                  )}
                  <div className="col-md-4">
                    <input
                      className="form-control form-control-sm"
                      placeholder="Reason"
                      value={event.reason}
                      onChange={(e) =>
                        setEvent({ ...event, reason: e.target.value })
                      }
                    />
                  </div>
                </div>
                <button
                  className="btn btn-sm btn-primary"
                  style={{ marginTop: 8 }}
                  onClick={() => addEvent(c._id)}
                >
                  Record Event
                </button>
              </div>
            )}

            {conflictFor === c._id && (
              <div className="card" style={{ padding: 12, marginTop: 10 }}>
                <div className="row g-2">
                  <div className="col-md-4">
                    <select
                      className="form-control form-control-sm"
                      value={conflictReview.reviewStatus}
                      onChange={(e) =>
                        setConflictReview({
                          ...conflictReview,
                          reviewStatus: e.target.value,
                        })
                      }
                    >
                      <option value="under-investigation">
                        Under investigation
                      </option>
                      <option value="cleared">Cleared</option>
                      <option value="unreviewed">Unreviewed</option>
                    </select>
                  </div>
                  <div className="col-md-6">
                    <input
                      className="form-control form-control-sm"
                      placeholder="Remarks"
                      value={conflictReview.remarks}
                      onChange={(e) =>
                        setConflictReview({
                          ...conflictReview,
                          remarks: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-2">
                    <button
                      className="btn btn-sm btn-warning"
                      style={{ width: "100%" }}
                      onClick={() => resolveConflict(c._id)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}

            {c.events && c.events.length > 0 && (
              <div
                style={{ marginTop: 10, fontSize: "0.85rem", color: "#555" }}
              >
                <strong>Lifecycle:</strong>
                {c.events.map((ev, i) => (
                  <div key={ev._id || i} style={{ marginLeft: 10 }}>
                    • {formatDate(ev.eventDate)} —{" "}
                    {ev.eventType}
                    {ev.inspectionResult &&
                    ev.inspectionResult !== "not-applicable"
                      ? ` (${ev.inspectionResult})`
                      : ""}
                    {ev.reason ? ` — ${ev.reason}` : ""}
                    {ev.workshopName ? ` [${ev.workshopName}]` : ""}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
