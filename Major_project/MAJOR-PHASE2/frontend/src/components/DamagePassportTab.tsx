import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import ViewTransactionButton from "../components/ViewTransactionButton";
import { formatDate } from "../lib/display";

// Feature 6: Verified Vehicle Damage and Repair Passport
// Chronological damage/repair timeline. Every entry is labelled reported /
// verified / disputed. The system only records what authorized inspectors
// submit - it cannot discover unreported damage.

type ApiError = {
  response?: { data?: { message?: string; errors?: string[] } };
};
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

interface Evidence {
  fileName: string;
  sha256: string;
  fileSize?: number;
}

interface DamageEvent {
  _id: string;
  eventType: string;
  eventDate: string;
  description: string;
  severity: string;
  affectedAreas?: string[];
  verificationStatus: "reported" | "verified" | "disputed";
  submitterName?: string;
  // Owner-submitted accidents carry their own statement details and the
  // officer's finding, stored beside the statement rather than inside it.
  sourceChannel?: "authorized-submitter" | "owner-upload";
  accident?: {
    location?: string;
    oppositePartyRegNumber?: string | null;
    policeStation?: string | null;
    firNumber?: string | null;
    injuries?: string;
  };
  officerReview?: {
    outcome?: string;
    remarks?: string | null;
    reviewedByName?: string;
    reviewedByRole?: string;
    reviewedAt?: string;
  };
  evidence?: Evidence[];
  anchor?: { recordHash?: string; status?: string; txHash?: string | null };
}

const EVENT_TYPES = [
  "accident-damage",
  "flood-exposure",
  "structural-repair",
  "safety-part-replacement",
  "inspection",
];

export default function DamagePassportTab({
  vehicleId,
  canSubmit,
  canVerify,
}: {
  vehicleId: string;
  canSubmit: boolean;
  canVerify: boolean;
}) {
  const [events, setEvents] = useState<DamageEvent[]>([]);
  const [summary, setSummary] = useState<{
    total: number;
    reported: number;
    verified: number;
    disputed: number;
  } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [integrity, setIntegrity] = useState<Record<string, string>>({});

  const [form, setForm] = useState({
    eventType: "accident-damage",
    eventDate: "",
    description: "",
    severity: "unknown",
    affectedAreas: "",
  });
  const [files, setFiles] = useState<File[]>([]);
  const [decisionFor, setDecisionFor] = useState<string | null>(null);
  const [decision, setDecision] = useState({
    decision: "verified",
    remarks: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/damage-events`,
      );
      setEvents(res.data.events || []);
      setSummary(res.data.summary);
      setNote(res.data.note);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load damage events."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const fd = new FormData();
      fd.append("eventType", form.eventType);
      fd.append("eventDate", form.eventDate);
      fd.append("description", form.description);
      fd.append("severity", form.severity);
      fd.append("affectedAreas", form.affectedAreas);
      files.forEach((f) => fd.append("evidence", f));
      const res = await api.post(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/damage-events`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setNotice(res.data.message);
      setShowForm(false);
      setForm({
        eventType: "accident-damage",
        eventDate: "",
        description: "",
        severity: "unknown",
        affectedAreas: "",
      });
      setFiles([]);
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(
        errs
          ? errs.join(" ")
          : apiMessage(err, "Failed to record damage event."),
      );
    }
  };

  const saveDecision = async (eventId: string) => {
    setError(null);
    try {
      await api.patch(
        `/vehicle-intelligence/damage-events/${eventId}/decision`,
        decision,
      );
      setDecisionFor(null);
      setDecision({ decision: "verified", remarks: "" });
      setNotice("Verification decision recorded.");
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to record decision."));
    }
  };

  const checkIntegrity = async (eventId: string) => {
    try {
      const res = await api.get(
        `/vehicle-intelligence/damage-events/${eventId}/verify-integrity`,
      );
      setIntegrity((v) => ({
        ...v,
        [eventId]: res.data.allEvidenceIntact
          ? "All evidence files match their recorded hashes (unchanged since submission)."
          : "One or more evidence files no longer match their recorded hash.",
      }));
    } catch (err: unknown) {
      setIntegrity((v) => ({
        ...v,
        [eventId]: apiMessage(err, "Integrity check failed."),
      }));
    }
  };

  const downloadEvidence = async (
    eventId: string,
    idx: number,
    name: string,
  ) => {
    try {
      const res = await api.get(
        `/vehicle-intelligence/damage-events/${eventId}/evidence/${idx}`,
        {
          responseType: "blob",
        },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Could not fetch evidence file.");
    }
  };

  const statusBadge = (e: DamageEvent) => {
    if (e.verificationStatus === "verified")
      return <span className="badge bg-success">Verified</span>;
    if (e.verificationStatus === "disputed")
      return <span className="badge bg-danger">Disputed</span>;
    return (
      <span className="badge bg-warning text-dark">Reported (unverified)</span>
    );
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

      {summary && (
        <div
          style={{
            display: "flex",
            gap: 15,
            flexWrap: "wrap",
            marginBottom: 20,
          }}
        >
          <div className="card" style={{ padding: 15, minWidth: 140 }}>
            <strong>{summary.total}</strong> events
          </div>
          <div className="card" style={{ padding: 15, minWidth: 140 }}>
            Verified: <strong>{summary.verified}</strong>
          </div>
          <div className="card" style={{ padding: 15, minWidth: 140 }}>
            Reported: <strong>{summary.reported}</strong>
          </div>
          <div className="card" style={{ padding: 15, minWidth: 140 }}>
            Disputed: <strong>{summary.disputed}</strong>
          </div>
        </div>
      )}

      {canSubmit && (
        <div style={{ marginBottom: 20 }}>
          {!showForm ? (
            <button
              className="btn btn-success"
              onClick={() => setShowForm(true)}
            >
              + Report Damage / Repair
            </button>
          ) : (
            <form onSubmit={submit} className="card" style={{ padding: 20 }}>
              <h5>Report Damage / Repair Event</h5>
              <div className="row g-3">
                <div className="col-md-3">
                  <label>Type</label>
                  <select
                    className="form-control"
                    value={form.eventType}
                    onChange={(e) =>
                      setForm({ ...form, eventType: e.target.value })
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
                  <label>Event Date</label>
                  <input
                    type="date"
                    className="form-control"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={form.eventDate}
                    onChange={(e) =>
                      setForm({ ...form, eventDate: e.target.value })
                    }
                  />
                </div>
                <div className="col-md-3">
                  <label>Severity</label>
                  <select
                    className="form-control"
                    value={form.severity}
                    onChange={(e) =>
                      setForm({ ...form, severity: e.target.value })
                    }
                  >
                    <option value="minor">Minor</option>
                    <option value="moderate">Moderate</option>
                    <option value="severe">Severe</option>
                    <option value="unknown">Unknown</option>
                  </select>
                </div>
                <div className="col-md-3">
                  <label>Affected Areas (comma sep.)</label>
                  <input
                    className="form-control"
                    placeholder="Front bumper, chassis"
                    value={form.affectedAreas}
                    onChange={(e) =>
                      setForm({ ...form, affectedAreas: e.target.value })
                    }
                  />
                </div>
                <div className="col-12">
                  <label>Description</label>
                  <textarea
                    className="form-control"
                    required
                    rows={2}
                    value={form.description}
                    onChange={(e) =>
                      setForm({ ...form, description: e.target.value })
                    }
                  />
                </div>
                <div className="col-12">
                  <label>Evidence files (images / PDF, up to 5)</label>
                  <input
                    type="file"
                    className="form-control"
                    multiple
                    accept="image/jpeg,image/png,image/webp,application/pdf"
                    onChange={(e) => setFiles(Array.from(e.target.files || []))}
                  />
                </div>
              </div>
              <div style={{ marginTop: 15 }}>
                <button type="submit" className="btn btn-primary">
                  Submit (as Reported)
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
        <p>Loading timeline…</p>
      ) : events.length === 0 ? (
        <div className="alert alert-secondary">
          No damage/repair events recorded yet.
        </div>
      ) : (
        events.map((e) => (
          <div
            key={e._id}
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
                {formatDate(e.eventDate)} — {e.eventType}
              </strong>
              {statusBadge(e)}
            </div>
            <div style={{ marginTop: 6 }}>
              <span className="badge bg-light text-dark border">
                {e.severity}
              </span>{" "}
              {e.affectedAreas?.length ? (
                <em>{e.affectedAreas.join(", ")}</em>
              ) : null}
            </div>
            <p style={{ margin: "8px 0 4px" }}>{e.description}</p>
            {e.sourceChannel === "owner-upload" && (
              <p
                style={{
                  margin: "0 0 4px",
                  fontSize: "0.83rem",
                  color: "#555",
                }}
              >
                <span className="badge bg-warning text-dark">
                  Owner-uploaded evidence
                </span>{" "}
                {[
                  e.accident?.location ? `at ${e.accident.location}` : null,
                  e.accident?.oppositePartyRegNumber
                    ? `other vehicle ${e.accident.oppositePartyRegNumber}`
                    : null,
                  e.accident?.firNumber ? `FIR ${e.accident.firNumber}` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            )}
            <p style={{ margin: 0, fontSize: "0.85rem", color: "#777" }}>
              Submitted by {e.submitterName || "Authorized party"}
            </p>
            {e.officerReview &&
              e.officerReview.outcome &&
              e.officerReview.outcome !== "pending" && (
                <p
                  style={{
                    margin: "4px 0 0",
                    fontSize: "0.83rem",
                    color: "#555",
                  }}
                >
                  Reviewed by {e.officerReview.reviewedByName || "an officer"} (
                  {(e.officerReview.reviewedByRole || "").toUpperCase()})
                  {e.officerReview.remarks
                    ? ` — “${e.officerReview.remarks}”`
                    : ""}
                </p>
              )}
            {e.evidence && e.evidence.length > 0 && (
              <div style={{ marginTop: 8, fontSize: "0.85rem" }}>
                <strong>Evidence:</strong>{" "}
                {e.evidence.map((ev, i) => (
                  <button
                    key={i}
                    className="btn btn-sm btn-link"
                    onClick={() => downloadEvidence(e._id, i, ev.fileName)}
                    title={ev.sha256}
                  >
                    {ev.fileName}
                  </button>
                ))}
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
              <button
                className="btn btn-sm btn-outline-primary"
                onClick={() => checkIntegrity(e._id)}
              >
                Verify evidence integrity
              </button>
              <ViewTransactionButton
                txHash={e.anchor?.txHash}
                status={e.anchor?.status}
                label="Tx"
                className="btn btn-sm btn-outline-success"
              />
              {canVerify && (
                <button
                  className="btn btn-sm btn-outline-warning"
                  onClick={() =>
                    setDecisionFor(decisionFor === e._id ? null : e._id)
                  }
                >
                  {decisionFor === e._id ? "Close" : "Verify / Dispute"}
                </button>
              )}
            </div>
            {integrity[e._id] && (
              <div
                className="alert alert-secondary"
                style={{ marginTop: 8, fontSize: "0.82rem" }}
              >
                {integrity[e._id]}
                <div>
                  Hash match only proves a file has not changed since hashing —
                  not that it was truthful.
                </div>
              </div>
            )}
            {decisionFor === e._id && (
              <div className="card" style={{ padding: 12, marginTop: 10 }}>
                <div className="row g-2">
                  <div className="col-md-4">
                    <select
                      className="form-control form-control-sm"
                      value={decision.decision}
                      onChange={(ev) =>
                        setDecision({ ...decision, decision: ev.target.value })
                      }
                    >
                      <option value="verified">Verified</option>
                      <option value="disputed">Disputed</option>
                      <option value="reported">Back to Reported</option>
                    </select>
                  </div>
                  <div className="col-md-6">
                    <input
                      className="form-control form-control-sm"
                      placeholder="Remarks"
                      value={decision.remarks}
                      onChange={(ev) =>
                        setDecision({ ...decision, remarks: ev.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-2">
                    <button
                      className="btn btn-sm btn-warning"
                      style={{ width: "100%" }}
                      onClick={() => saveDecision(e._id)}
                    >
                      Save
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
