// IncomingRequests.tsx
// Workshop view of owner-initiated Vehicle Intelligence requests.
// The workshop opens the vehicle's history page to add records (existing
// forms), then marks the request answered - newly created records are
// attached automatically by the backend and anchored on-chain.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import ViewTransactionButton from "./ViewTransactionButton";
import { formatDate } from "../lib/display";

interface IntelRequest {
  _id: string;
  status: "pending" | "responded" | "cancelled";
  requestedItems: string[];
  note?: string;
  createdAt: string;
  vehicle?: {
    _id: string;
    regNumber?: string;
    make: string;
    model?: string;
    year?: number;
  };
  requester?: { name: string; email: string; phone?: string };
  response?: {
    submittedAt: string;
    note?: string;
    recordsCreated?: { type: string; id: string }[];
  };
  anchor?: { txHash?: string; status?: string; recordHash?: string };
}

const ITEM_LABELS: Record<string, string> = {
  service: "Service records",
  odometer: "Odometer reading",
  parts: "Parts provenance",
  battery: "Battery passport",
  damage: "Damage passport",
};

export default function IncomingRequests() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [requests, setRequests] = useState<IntelRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});

  const fetchRequests = useCallback(async () => {
    try {
      const res = await api.get("/vehicle-intelligence/incoming-requests");
      setRequests(res.data.requests || []);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Failed to load requests",
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const respond = async (id: string) => {
    setBusyId(id);
    setError(null);
    try {
      const res = await api.put(
        `/vehicle-intelligence/requests/${id}/respond`,
        { note: notes[id] || "Records verified and uploaded." },
      );
      setMessage(res.data.message);
      await fetchRequests();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not submit response",
      );
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <p>Loading incoming requests…</p>;

  const pending = requests.filter((r) => r.status === "pending");
  const answered = requests.filter((r) => r.status === "responded");

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Incoming Report Requests</h4>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Vehicle owners ask you for their verified records (e.g. before selling).
        Open the vehicle's service history, upload the requested records, then
        mark the request answered - everything you added since the request is
        attached automatically and anchored on-chain.
      </p>

      {message && (
        <div className="alert alert-success" role="alert">
          {message}
        </div>
      )}
      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {requests.length === 0 && (
        <div className="alert alert-secondary">
          No report requests yet. They appear here when an owner of a{" "}
          <em>your brand</em> vehicle asks for a report.
        </div>
      )}

      {pending.map((r) => (
        <div
          key={r._id}
          className="card"
          style={{
            padding: 16,
            marginTop: 12,
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
            <strong>
              {r.vehicle?.regNumber || "No reg no"} — {r.vehicle?.make}{" "}
              {r.vehicle?.model} ({r.vehicle?.year})
            </strong>
            <span className="badge bg-warning text-dark">
              requested {formatDate(r.createdAt)}
            </span>
          </div>
          <p style={{ margin: "8px 0 4px", fontSize: "0.9rem" }}>
            <strong>{r.requester?.name}</strong> ({r.requester?.email}) needs:{" "}
            {r.requestedItems.map((i) => ITEM_LABELS[i] || i).join(", ")}
          </p>
          {r.note && (
            <p style={{ margin: "4px 0", fontStyle: "italic", color: "#555" }}>
              “{r.note}”
            </p>
          )}
          <div
            style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}
          >
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate(`/vehicle-history/${r.vehicle?._id}`)}
            >
              Open Service History & Add Records
            </button>
            <input
              className="form-control form-control-sm"
              style={{ maxWidth: 280 }}
              placeholder="Note to owner (optional)"
              value={notes[r._id] || ""}
              onChange={(e) => setNotes({ ...notes, [r._id]: e.target.value })}
            />
            <button
              className="btn btn-success btn-sm"
              disabled={busyId === r._id}
              onClick={() => respond(r._id)}
            >
              {busyId === r._id ? "Submitting…" : "Mark Answered"}
            </button>
          </div>
        </div>
      ))}

      {answered.length > 0 && (
        <>
          <h5 style={{ marginTop: 24 }}>Answered</h5>
          {answered.map((r) => (
            <div
              key={r._id}
              className="card"
              style={{ padding: 14, marginTop: 10, opacity: 0.9 }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  flexWrap: "wrap",
                  gap: 8,
                }}
              >
                <span>
                  <strong>{r.vehicle?.regNumber || r.vehicle?._id}</strong> —{" "}
                  {r.requester?.name} ·{" "}
                  {r.response?.recordsCreated?.length || 0} record(s) attached
                </span>
                <span className="badge bg-success">
                  answered{" "}
                  {r.response?.submittedAt
                    ? formatDate(r.response.submittedAt)
                    : ""}
                </span>
              </div>
              {r.anchor?.txHash && (
                <div style={{ marginTop: 8 }}>
                  <ViewTransactionButton
                    txHash={r.anchor.txHash}
                    status={r.anchor.status}
                    label="View Response Anchoring Tx"
                    className="btn btn-sm btn-outline-success"
                  />
                </div>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
