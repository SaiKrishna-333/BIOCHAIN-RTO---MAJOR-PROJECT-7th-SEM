// InterStateApprovals.tsx
// RTO officer side of the Inter-State Transfer workflow (Workflow 7).
// Lists transfers involving the officer's own state and provides the
// NOC (source state) and final registration (destination state) actions.
// Backend enforces which stage each officer may act on.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import { formatDate } from "../lib/display";

interface Approval {
  status: string;
  officerName?: string;
  remarks?: string;
}

interface InterStateRequest {
  _id: string;
  status: string;
  createdAt: string;
  vehicle?: {
    regNumber?: string;
    make: string;
    model?: string;
    year?: number;
  };
  seller?: { name: string; email: string };
  interStateDetails?: {
    currentState?: string;
    targetState?: string;
    newAddress?: string;
    currentRegNumber?: string;
    passportHash?: string;
    newRegNumber?: string | null;
    sourceRTOApproval?: Approval;
    destinationRTOApproval?: Approval;
  };
}

const STATUS_BADGE: Record<string, string> = {
  pending: "role-dealer",
  source_rto_approved: "role-owner",
  destination_rto_approved: "role-rto",
  completed: "role-rto",
  rejected: "role-reject",
};

export default function InterStateApprovals() {
  const { api, user } = useAuth();
  const [requests, setRequests] = useState<InterStateRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [regInputs, setRegInputs] = useState<Record<string, string>>({});
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const myState = user?.rtoDetails?.stateCode;

  const load = useCallback(async () => {
    try {
      const res = await api.get("/inter-state/requests");
      setRequests(res.data || []);
      setError(null);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(
        e?.response?.data?.message || "Failed to load inter-state requests",
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (
    id: string,
    endpoint: string,
    body: Record<string, string>,
    okMsg: string,
  ) => {
    setBusy(id);
    try {
      await api.post(`/inter-state/${id}/${endpoint}`, body);
      setMessage(okMsg);
      setRemarks("");
      await load();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message || "Action failed");
    } finally {
      setBusy(null);
    }
  };

  // Remarks are typed into the row itself. A prompt() box halts the whole
  // console until someone answers it, which is unacceptable on a recordable
  // screen and cannot be styled to match the registry.
  const remarkOr = (fallback: string) => remarks.trim() || fallback;

  if (loading) return <p>Loading inter-state transfer requests…</p>;

  return (
    <div>
      <h4>Inter-State Transfer Approvals</h4>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
        Transfers involving{" "}
        <strong>{myState || "your configured state"}</strong> as source or
        destination. The origin office issues the NOC; the destination office
        verifies the Vehicle Passport hash and assigns the new registration
        number.
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

      {requests.length === 0 && !error && (
        <div className="alert alert-secondary">
          No inter-state transfers are pending for your state right now.
        </div>
      )}

      {requests.map((r) => {
        const d = r.interStateDetails || {};
        const isSource = myState && d.currentState === myState;
        const isDest = myState && d.targetState === myState;
        return (
          <div
            key={r._id}
            className="card"
            style={{
              padding: 16,
              marginTop: 12,
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
              <strong>
                {d.currentRegNumber || r.vehicle?.regNumber || "Vehicle"} —{" "}
                {r.vehicle?.make} {r.vehicle?.model} ({r.vehicle?.year})
              </strong>
              <span
                className={`role-badge ${STATUS_BADGE[r.status] || "role-dealer"}`}
              >
                {r.status}
              </span>
            </div>
            <p style={{ fontSize: "0.9rem", margin: "8px 0 4px" }}>
              {d.currentState} to <strong>{d.targetState}</strong> · Owner:{" "}
              {r.seller?.name} ({r.seller?.email}) · Requested{" "}
              {formatDate(r.createdAt)}
            </p>
            {d.passportHash && (
              <p
                style={{
                  fontSize: "0.8rem",
                  color: "var(--color-text-muted)",
                  margin: "2px 0",
                }}
              >
                Vehicle Passport hash: {String(d.passportHash).slice(0, 18)}…
                (integrity re-verified before approval)
              </p>
            )}
            <p style={{ fontSize: "0.85rem", margin: "4px 0" }}>
              NOC:{" "}
              <span
                className={`role-badge ${d.sourceRTOApproval?.status === "approved" ? "role-rto" : d.sourceRTOApproval?.status === "rejected" ? "role-reject" : "role-dealer"}`}
              >
                {d.sourceRTOApproval?.status || "pending"}
              </span>{" "}
              Destination:{" "}
              <span
                className={`role-badge ${d.destinationRTOApproval?.status === "approved" ? "role-rto" : d.destinationRTOApproval?.status === "rejected" ? "role-reject" : "role-dealer"}`}
              >
                {d.destinationRTOApproval?.status || "pending"}
              </span>
              {d.newRegNumber && (
                <>
                  {" "}
                  · New registration: <strong>{d.newRegNumber}</strong>
                </>
              )}
            </p>

            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                marginTop: 8,
              }}
            >
              {(isSource || isDest) && (
                <input
                  type="text"
                  aria-label="Remarks for this decision"
                  placeholder="Remarks (optional)"
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  style={{ minWidth: "220px", flex: "1 1 220px" }}
                />
              )}
              {isSource && r.status === "pending" && (
                <>
                  <button
                    className="btn btn-success btn-sm"
                    disabled={busy === r._id}
                    onClick={() =>
                      act(
                        r._id,
                        "source-rto-approve",
                        { remarks: remarkOr("NOC approved") },
                        "NOC issued for this vehicle.",
                      )
                    }
                  >
                    Issue NOC (Source State)
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busy === r._id}
                    onClick={() =>
                      act(
                        r._id,
                        "source-rto-reject",
                        { remarks: remarkOr("NOC rejected by source office") },
                        "NOC rejected.",
                      )
                    }
                  >
                    Reject NOC
                  </button>
                </>
              )}
              {isDest && r.status === "source_rto_approved" && (
                <>
                  <input
                    className="form-control form-control-sm"
                    style={{ maxWidth: 180 }}
                    placeholder="New Reg No (e.g. TN-01-AB-1234)"
                    value={regInputs[r._id] || ""}
                    onChange={(e) =>
                      setRegInputs({ ...regInputs, [r._id]: e.target.value })
                    }
                  />
                  <button
                    className="btn btn-success btn-sm"
                    disabled={busy === r._id || !regInputs[r._id]}
                    onClick={() =>
                      act(
                        r._id,
                        "destination-rto-approve",
                        {
                          newRegNumber: regInputs[r._id],
                          remarks: remarkOr("Registration approved"),
                        },
                        "Destination approval done — new number assigned and recorded on-chain.",
                      )
                    }
                  >
                    Verify Passport & Approve
                  </button>
                  <button
                    className="btn btn-danger btn-sm"
                    disabled={busy === r._id}
                    onClick={() =>
                      act(
                        r._id,
                        "destination-rto-reject",
                        { remarks: remarkOr("Destination approval rejected") },
                        "Destination approval rejected.",
                      )
                    }
                  >
                    Reject
                  </button>
                </>
              )}
              {!isSource && !isDest && (
                <span
                  style={{
                    color: "var(--color-text-muted)",
                    fontSize: "0.85rem",
                  }}
                >
                  View-only — your state is not the source or destination here.
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
