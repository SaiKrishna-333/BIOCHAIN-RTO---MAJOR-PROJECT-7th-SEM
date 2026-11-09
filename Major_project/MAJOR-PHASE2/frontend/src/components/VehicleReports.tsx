// VehicleReports.tsx
// Owner view of the Vehicle Intelligence workflow:
// - request a verified report from the authorized (brand-matched) workshop
// - track open requests
// - see the live intelligence summary for every owned vehicle, which
// updates automatically as soon as the workshop uploads records
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import ViewTransactionButton from "./ViewTransactionButton";
import { formatDate, formatMoney } from "../lib/display";

interface IntelSummary {
  serviceRecords: number;
  latestService: { date: string; odometerKm: number; type: string } | null;
  partsTracked: number;
  damageEvents: number;
  battery: { currentSoH: number | null; lastTestedAt: string | null } | null;
}

interface SummaryRow {
  _id: string;
  regNumber?: string;
  make: string;
  model?: string;
  year?: number;
  summary: IntelSummary | null;
}

interface IntelRequest {
  _id: string;
  status: string;
  requestedItems: string[];
  note?: string;
  createdAt: string;
  vehicle?: { _id: string; regNumber?: string; make: string; model?: string };
  workshop?: { name: string; workshopDetails?: { companyName?: string } };
  response?: {
    submittedAt: string;
    note?: string;
    recordsCreated?: { type: string; id: string }[];
  };
  anchor?: { txHash?: string; status?: string };
}

const ITEMS = [
  { id: "service", label: "Service & odometer history" },
  { id: "parts", label: "Parts provenance" },
  { id: "battery", label: "Battery passport (EV)" },
  { id: "damage", label: "Damage & repair passport" },
];

export default function VehicleReports() {
  const { api } = useAuth();
  const navigate = useNavigate();

  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [requests, setRequests] = useState<IntelRequest[]>([]);
  const [selected, setSelected] = useState<string[]>([
    "service",
    "parts",
    "damage",
  ]);
  const [note, setNote] = useState("");
  const [busyVehicle, setBusyVehicle] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const vehRes = await api.get("/vehicles/my");
      const vehicles: SummaryRow[] = (vehRes.data || []).map(
        (v: SummaryRow) => ({ ...v, summary: null }),
      );
      setRows(vehicles);
      // Load each vehicle's intelligence summary
      await Promise.all(
        vehicles.map(async (v) => {
          try {
            const s = await api.get(
              `/vehicle-intelligence/vehicle-summary/${v._id}`,
            );
            setRows((prev) =>
              prev.map((r) =>
                r._id === v._id ? { ...r, summary: s.data.summary } : r,
              ),
            );
          } catch {
            /* vehicle not eligible (e.g. no RTO record) - leave null */
          }
        }),
      );
      const reqRes = await api.get("/vehicle-intelligence/my-requests");
      setRequests(reqRes.data.requests || []);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Failed to load reports",
      );
    }
  }, [api]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const requestReport = async (vehicleId: string) => {
    setBusyVehicle(vehicleId);
    setError(null);
    setMessage(null);
    try {
      const res = await api.post("/vehicle-intelligence/request", {
        vehicleId,
        requestedItems: selected,
        note: note || undefined,
      });
      setMessage(res.data.message);
      await fetchAll();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not send the request",
      );
    } finally {
      setBusyVehicle(null);
    }
  };

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Vehicle Intelligence Reports</h4>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Before selling, contact the authorized workshop by requesting a report.
        When the workshop uploads the vehicle's verified odometer, battery,
        parts and damage records they appear here automatically - and travel
        with the vehicle to any future buyer.
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

      {/* What to request */}
      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <strong style={{ fontSize: "0.9rem" }}>
          (Optional) tailor the request
        </strong>
        <div
          style={{
            display: "flex",
            gap: 14,
            flexWrap: "wrap",
            margin: "8px 0",
          }}
        >
          {ITEMS.map((it) => (
            <label key={it.id} style={{ fontSize: "0.85rem" }}>
              <input
                type="checkbox"
                className="form-check-input"
                checked={selected.includes(it.id)}
                onChange={(e) =>
                  setSelected((prev) =>
                    e.target.checked
                      ? [...prev, it.id]
                      : prev.filter((x) => x !== it.id),
                  )
                }
              />{" "}
              {it.label}
            </label>
          ))}
        </div>
        <input
          className="form-control form-control-sm"
          placeholder="Message to the workshop (e.g. selling soon - need full history)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          style={{ maxWidth: 460 }}
        />
      </div>

      {/* Per-vehicle intelligence + request button */}
      {rows.length === 0 && (
        <p>No vehicles registered under your account yet.</p>
      )}
      {rows.map((v) => (
        <div
          key={v._id}
          className="card"
          style={{ padding: 16, marginBottom: 12 }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <strong>
              {v.regNumber || "Pending registration"} — {v.make} {v.model} (
              {v.year})
            </strong>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                disabled={selected.length === 0 || busyVehicle === v._id}
                onClick={() => requestReport(v._id)}
              >
                {busyVehicle === v._id ? "Sending…" : "Request Workshop Report"}
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => navigate(`/vehicle-history/${v._id}`)}
              >
                Full History
              </button>
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            {v.summary ? (
              <>
                <span className="intel-chip">
                  {v.summary.serviceRecords} service record(s)
                </span>
                {v.summary.latestService && (
                  <span className="intel-chip">
                    {formatMoney(v.summary.latestService.odometerKm)} km @{" "}
                    {formatDate(
                      v.summary.latestService.date,
                    )}
                  </span>
                )}
                <span className="intel-chip">
                  {v.summary.partsTracked} part(s) tracked
                </span>
                <span
                  className={`intel-chip ${v.summary.damageEvents > 0 ? "chip-warn" : ""}`}
                >
                  {v.summary.damageEvents} damage event(s)
                </span>
                {v.summary.battery && (
                  <span
                    className={`intel-chip ${
                      v.summary.battery.currentSoH != null &&
                      v.summary.battery.currentSoH < 70
                        ? "chip-warn"
                        : ""
                    }`}
                  >
                    Battery SOH{" "}
                    {v.summary.battery.currentSoH != null
                      ? `${v.summary.battery.currentSoH}%`
                      : "pending"}
                  </span>
                )}
              </>
            ) : (
              <span style={{ color: "#888", fontSize: "0.85rem" }}>
                No workshop records uploaded yet — request a report above.
              </span>
            )}
          </div>
        </div>
      ))}

      {/* My requests ledger */}
      {requests.length > 0 && (
        <>
          <h5 style={{ marginTop: 20 }}>My report requests</h5>
          {requests.map((r) => (
            <div
              key={r._id}
              className="card"
              style={{
                padding: 14,
                marginTop: 10,
                borderLeft: `4px solid ${
                  r.status === "responded"
                    ? "var(--color-success)"
                    : "var(--color-warning)"
                }`,
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
                  {r.vehicle?.regNumber || ""} {r.vehicle?.make}{" "}
                  {r.vehicle?.model}
                </strong>
                <span
                  className={`badge ${
                    r.status === "responded"
                      ? "bg-success"
                      : "bg-warning text-dark"
                  }`}
                >
                  {r.status === "responded"
                    ? "Report delivered"
                    : "Waiting for workshop"}
                </span>
              </div>
              <p
                style={{
                  fontSize: "0.85rem",
                  margin: "6px 0 0",
                  color: "#555",
                }}
              >
                To{" "}
                {r.workshop?.workshopDetails?.companyName || r.workshop?.name}:{" "}
                {r.requestedItems.join(", ")} · asked{" "}
                {formatDate(r.createdAt)}
              </p>
              {r.status === "responded" && (
                <>
                  <p
                    style={{
                      fontSize: "0.85rem",
                      margin: "4px 0",
                      color: "#555",
                    }}
                  >
                    {r.response?.recordsCreated?.length || 0} record(s) attached
                    {r.response?.note ? ` — “${r.response.note}”` : ""}
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: 8,
                      marginTop: 6,
                      flexWrap: "wrap",
                    }}
                  >
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() =>
                        navigate(`/vehicle-history/${r.vehicle?._id}`)
                      }
                    >
                      View Uploaded Documents
                    </button>
                    {r.anchor?.txHash && (
                      <ViewTransactionButton
                        txHash={r.anchor.txHash}
                        status={r.anchor.status}
                        label="View Report Anchoring Tx"
                        className="btn btn-sm btn-outline-success"
                      />
                    )}
                  </div>
                </>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
