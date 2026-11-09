import { useCallback, useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import api from "../services/api";
import { useAuth } from "../context/useAuth";
import PartsProvenanceTab from "../components/PartsProvenanceTab";
import DamagePassportTab from "../components/DamagePassportTab";
import BatteryPassportTab from "../components/BatteryPassportTab";
import ViewTransactionButton from "../components/ViewTransactionButton";
import DashboardLayout from "../components/DashboardLayout";
import { KpiCard, KpiStrip, StatusPill } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import { formatDate, formatDateTime, formatMoney } from "../lib/display";

interface ServiceRecord {
  _id: string;
  serviceDate: string;
  odometerKm: number;
  serviceType: string;
  description: string;
  partsReplaced: { partName: string; partSerial?: string }[];
  cost?: number;
  submitterName?: string;
  manufacturer?: string;
  status: "verified" | "flagged_for_review" | "corrected";
  flagReason?: string;
  anchor?: { recordHash?: string; status?: string; txHash?: string };
  corrections?: {
    field: string;
    previousValue: unknown;
    newValue: unknown;
    reason: string;
    correctedAt: string;
  }[];
}

interface VerificationResult {
  verified: boolean;
  reason: string;
  anchorStatus?: string;
  txHash?: string | null;
}

// Axios-style error with a JSON message/errors body (project convention)
type ApiError = {
  response?: { data?: { message?: string; errors?: string[] } };
};
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

const TABS = [
  { id: "service", label: "Service & Odometer", ready: true },
  { id: "parts", label: "Parts Provenance", ready: true },
  { id: "damage", label: "Damage Passport", ready: true },
  { id: "battery", label: "EV Battery Passport", ready: true },
] as const;

const canSubmit = (role?: string) =>
  role === "workshop" || role === "rto" || role === "admin";

export default function VehicleHistory() {
  const { vehicleId } = useParams<{ vehicleId: string }>();
  const { user } = useAuth();
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("service");
  const [records, setRecords] = useState<ServiceRecord[]>([]);
  const [vehicle, setVehicle] = useState<{
    regNumber: string;
    make: string;
    model: string;
    year: number;
    blockchainTxHash?: string | null;
  } | null>(null);
  const [summary, setSummary] = useState<{
    totalRecords: number;
    flaggedReadings: number;
    latestOdometerKm: number | null;
    note: string | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [verifications, setVerifications] = useState<
    Record<string, VerificationResult | null>
  >({});
  const [correcting, setCorrecting] = useState<string | null>(null);
  const [form, setForm] = useState({
    serviceDate: "",
    odometerKm: "",
    serviceType: "periodic-service",
    description: "",
    cost: "",
    partsReplaced: "",
  });
  const [correction, setCorrection] = useState({
    field: "odometerKm",
    newValue: "",
    reason: "",
  });

  const load = useCallback(async () => {
    if (!vehicleId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/service-records`,
      );
      setVehicle(res.data.vehicle);
      setSummary(res.data.summary);
      setRecords(res.data.records);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load vehicle history."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const payload = {
        ...form,
        odometerKm: Number(form.odometerKm),
        cost: form.cost ? Number(form.cost) : undefined,
        partsReplaced: form.partsReplaced
          ? form.partsReplaced.split(",").map((p) => {
              const [partName, partSerial] = p.split(":").map((s) => s.trim());
              return { partName, partSerial: partSerial || undefined };
            })
          : [],
      };
      const res = await api.post(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/service-records`,
        payload,
      );
      setNotice(res.data.message);
      setShowForm(false);
      setForm({
        serviceDate: "",
        odometerKm: "",
        serviceType: "periodic-service",
        description: "",
        cost: "",
        partsReplaced: "",
      });
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(
        errs ? errs.join(" ") : apiMessage(err, "Failed to add record."),
      );
    }
  };

  const handleVerify = async (recordId: string) => {
    try {
      const res = await api.get(
        `/vehicle-intelligence/service-records/${recordId}/verify`,
      );
      setVerifications((v) => ({ ...v, [recordId]: res.data }));
    } catch (err: unknown) {
      setVerifications((v) => ({
        ...v,
        [recordId]: {
          verified: false,
          reason: apiMessage(err, "Verification failed."),
        },
      }));
    }
  };

  const handleCorrection = async (recordId: string) => {
    setError(null);
    try {
      await api.patch(
        `/vehicle-intelligence/service-records/${recordId}/correct`,
        {
          field: correction.field,
          newValue:
            correction.field === "odometerKm"
              ? Number(correction.newValue)
              : correction.newValue,
          reason: correction.reason,
        },
      );
      setCorrecting(null);
      setCorrection({ field: "odometerKm", newValue: "", reason: "" });
      setNotice("Correction recorded with an audit trail.");
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Correction failed."));
    }
  };

  const statusBadge = (r: ServiceRecord) => {
    const label =
      r.status === "flagged_for_review"
        ? "Flagged for review"
        : r.status === "corrected"
          ? "Corrected"
          : "Verified";
    return <StatusPill status={r.status} label={label} />;
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
            Vehicle History
            {vehicle && (
              <small style={{ color: "#b45309", marginLeft: 12 }}>
                {vehicle.regNumber} — {vehicle.make} {vehicle.model} (
                {vehicle.year})
              </small>
            )}
          </h2>
          <div
            style={{
              display: "flex",
              gap: 10,
              alignItems: "center",
              flexWrap: "wrap",
            }}
          >
            {vehicle?.blockchainTxHash && (
              <ViewTransactionButton
                txHash={vehicle.blockchainTxHash}
                status="anchored"
                label="View Registration Transaction"
              />
            )}
            <Link to="/" className="btn btn-outline-secondary btn-sm">
              Back
            </Link>
          </div>
        </div>

        {/* Tabs */}
        <div
          className="d-flex gap-2"
          style={{ margin: "20px 0", flexWrap: "wrap" }}
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`btn btn-sm ${tab === t.id ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => t.ready && setTab(t.id)}
              disabled={!t.ready}
              title={t.ready ? undefined : "Coming in a later phase"}
              style={t.ready ? {} : { opacity: 0.5, cursor: "not-allowed" }}
            >
              {t.label}
              {!t.ready && " (soon)"}
            </button>
          ))}
        </div>

        {error && <div className="alert alert-danger">{error}</div>}
        {notice && <div className="alert alert-info">{notice}</div>}

        {tab === "service" && (
          <>
            {summary && summary.flaggedReadings > 0 && (
              <div className="alert alert-warning">{summary.note}</div>
            )}

            <div style={{ marginBottom: 20 }}>
              <KpiStrip>
                <KpiCard
                  label="Service Records"
                  value={summary?.totalRecords ?? 0}
                  sub="on the verified timeline"
                  accent={BIO.blue}
                />
                <KpiCard
                  label="Latest Odometer"
                  value={
                    summary?.latestOdometerKm != null
                      ? `${formatMoney(summary.latestOdometerKm)} km`
                      : "—"
                  }
                  sub="last reading on record"
                  accent={BIO.violet}
                />
                <KpiCard
                  label="Flagged Readings"
                  value={summary?.flaggedReadings ?? 0}
                  sub="awaiting manual review"
                  accent={
                    (summary?.flaggedReadings ?? 0) > 0 ? BIO.amber : BIO.green
                  }
                />
              </KpiStrip>
            </div>

            {canSubmit(user?.role) && (
              <div style={{ marginBottom: 20 }}>
                {!showForm ? (
                  <button
                    className="btn btn-success"
                    onClick={() => setShowForm(true)}
                  >
                    + Add Service Record
                  </button>
                ) : (
                  <form
                    onSubmit={handleSubmit}
                    className="card"
                    style={{ padding: 20 }}
                  >
                    <h5>Submit Service Record (authorized centre)</h5>
                    <div className="row g-3">
                      <div className="col-md-3">
                        <label>Service Date</label>
                        <input
                          type="date"
                          className="form-control"
                          required
                          max={new Date().toISOString().slice(0, 10)}
                          value={form.serviceDate}
                          onChange={(e) =>
                            setForm({ ...form, serviceDate: e.target.value })
                          }
                        />
                      </div>
                      <div className="col-md-3">
                        <label>Odometer (km)</label>
                        <input
                          type="number"
                          className="form-control"
                          required
                          min={0}
                          value={form.odometerKm}
                          onChange={(e) =>
                            setForm({ ...form, odometerKm: e.target.value })
                          }
                        />
                      </div>
                      <div className="col-md-3">
                        <label>Service Type</label>
                        <select
                          className="form-control"
                          value={form.serviceType}
                          onChange={(e) =>
                            setForm({ ...form, serviceType: e.target.value })
                          }
                        >
                          <option value="periodic-service">
                            Periodic Service
                          </option>
                          <option value="repair">Repair</option>
                          <option value="part-replacement">
                            Part Replacement
                          </option>
                          <option value="inspection">Inspection</option>
                          <option value="recall">Recall</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div className="col-md-3">
                        <label>Cost (₹, optional)</label>
                        <input
                          type="number"
                          className="form-control"
                          min={0}
                          value={form.cost}
                          onChange={(e) =>
                            setForm({ ...form, cost: e.target.value })
                          }
                        />
                      </div>
                      <div className="col-12">
                        <label>Description</label>
                        <textarea
                          className="form-control"
                          required
                          rows={2}
                          placeholder="Work performed…"
                          value={form.description}
                          onChange={(e) =>
                            setForm({ ...form, description: e.target.value })
                          }
                        />
                      </div>
                      <div className="col-12">
                        <label>
                          Parts Replaced (comma separated, serial optional as{" "}
                          <code>name:serial</code>)
                        </label>
                        <input
                          type="text"
                          className="form-control"
                          placeholder="Brake pads, Clutch plate:CP-9021"
                          value={form.partsReplaced}
                          onChange={(e) =>
                            setForm({ ...form, partsReplaced: e.target.value })
                          }
                        />
                      </div>
                    </div>
                    <div style={{ marginTop: 15 }}>
                      <button type="submit" className="btn btn-primary">
                        Save Record
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
            ) : records.length === 0 ? (
              <div className="alert alert-secondary">
                No service records yet for this vehicle.
              </div>
            ) : (
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
                {records.map((r) => (
                  <div
                    key={r._id}
                    className="card"
                    style={{
                      padding: 15,
                      marginBottom: 15,
                      position: "relative",
                    }}
                  >
                    <div
                      style={{
                        position: "absolute",
                        left: -22,
                        top: 18,
                        width: 12,
                        height: 12,
                        borderRadius: "50%",
                        background:
                          r.status === "flagged_for_review"
                            ? "var(--color-danger)"
                            : "var(--color-success)",
                      }}
                    />
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        flexWrap: "wrap",
                        gap: 8,
                      }}
                    >
                      <strong>
                        {formatDate(r.serviceDate)}
                      </strong>
                      {statusBadge(r)}
                    </div>
                    <div style={{ marginTop: 6 }}>
                      <span className="badge bg-light text-dark border">
                        {r.serviceType}
                      </span>{" "}
                      <strong>{formatMoney(r.odometerKm)} km</strong>
                      {r.cost ? <> · ₹{formatMoney(r.cost)}</> : null}
                    </div>
                    <p style={{ margin: "8px 0 4px" }}>{r.description}</p>
                    {r.partsReplaced?.length > 0 && (
                      <p
                        style={{ margin: 0, fontSize: "0.9rem", color: "#555" }}
                      >
                        Parts:{" "}
                        {r.partsReplaced
                          .map((p) =>
                            p.partSerial
                              ? `${p.partName} (${p.partSerial})`
                              : p.partName,
                          )
                          .join(", ")}
                      </p>
                    )}
                    <p
                      style={{
                        margin: "6px 0 0",
                        fontSize: "0.85rem",
                        color: "#777",
                      }}
                    >
                      Submitted by {r.submitterName || "Authorized centre"}
                    </p>
                    {r.flagReason && (
                      <div
                        className="alert alert-warning"
                        style={{ marginTop: 10, fontSize: "0.88rem" }}
                      >
                        {r.flagReason}
                      </div>
                    )}
                    {r.corrections?.length ? (
                      <div
                        style={{
                          marginTop: 8,
                          fontSize: "0.85rem",
                          color: "#555",
                        }}
                      >
                        <strong>Correction history:</strong>
                        {r.corrections.map((c, i) => (
                          <div key={i} style={{ marginLeft: 10 }}>
                            • {c.field}: {String(c.previousValue)} to{" "}
                            {String(c.newValue)} — {c.reason} (
                            {formatDateTime(c.correctedAt)})
                          </div>
                        ))}
                      </div>
                    ) : null}
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
                        onClick={() => handleVerify(r._id)}
                      >
                        Verify integrity
                      </button>
                      <ViewTransactionButton
                        txHash={r.anchor?.txHash}
                        status={r.anchor?.status}
                        label="Tx"
                        className="btn btn-sm btn-outline-success"
                      />
                      {(user?.role === "rto" ||
                        user?.role === "admin" ||
                        user?.role === "workshop") && (
                        <button
                          className="btn btn-sm btn-outline-warning"
                          onClick={() =>
                            setCorrecting(correcting === r._id ? null : r._id)
                          }
                        >
                          {correcting === r._id
                            ? "Close correction"
                            : "Authorized correction"}
                        </button>
                      )}
                    </div>
                    {verifications[r._id] && (
                      <div
                        className={`alert ${verifications[r._id]!.verified ? "alert-success" : "alert-danger"}`}
                        style={{ marginTop: 10, fontSize: "0.85rem" }}
                      >
                        {verifications[r._id]!.reason}
                        {verifications[r._id]!.txHash && (
                          <div style={{ marginTop: 6 }}>
                            <ViewTransactionButton
                              txHash={verifications[r._id]!.txHash}
                              status={verifications[r._id]!.anchorStatus}
                              label="View Anchoring Transaction"
                              className="btn btn-sm btn-outline-success"
                            />
                          </div>
                        )}
                        {verifications[r._id]!.anchorStatus === "pending" &&
                          !verifications[r._id]!.txHash && (
                            <div>
                              The record hash is stored in the database (the
                              authoritative safeguard); its on-chain commit is
                              still pending.
                            </div>
                          )}
                      </div>
                    )}
                    {correcting === r._id && (
                      <div
                        className="card"
                        style={{ padding: 12, marginTop: 10 }}
                      >
                        <div className="row g-2">
                          <div className="col-md-3">
                            <select
                              className="form-control form-control-sm"
                              value={correction.field}
                              onChange={(e) =>
                                setCorrection({
                                  ...correction,
                                  field: e.target.value,
                                })
                              }
                            >
                              <option value="odometerKm">Odometer</option>
                              <option value="serviceDate">Service date</option>
                              <option value="description">Description</option>
                            </select>
                          </div>
                          <div className="col-md-3">
                            <input
                              className="form-control form-control-sm"
                              placeholder="New value"
                              type={
                                correction.field === "serviceDate"
                                  ? "date"
                                  : correction.field === "odometerKm"
                                    ? "number"
                                    : "text"
                              }
                              value={correction.newValue}
                              onChange={(e) =>
                                setCorrection({
                                  ...correction,
                                  newValue: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="col-md-4">
                            <input
                              className="form-control form-control-sm"
                              placeholder="Reason (required for audit)"
                              value={correction.reason}
                              onChange={(e) =>
                                setCorrection({
                                  ...correction,
                                  reason: e.target.value,
                                })
                              }
                            />
                          </div>
                          <div className="col-md-2">
                            <button
                              className="btn btn-sm btn-warning"
                              style={{ width: "100%" }}
                              onClick={() => handleCorrection(r._id)}
                            >
                              Apply
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div
              className="alert alert-secondary"
              style={{ marginTop: 20, fontSize: "0.85rem" }}
            >
              A flagged odometer reading means the value is inconsistent with
              earlier records. It is a prompt for manual review — not proof of
              tampering or fraud.
            </div>
          </>
        )}

        {tab === "parts" && (
          <PartsProvenanceTab
            vehicleId={vehicleId!}
            canSubmit={canSubmit(user?.role)}
            isOfficer={["rto", "police", "admin"].includes(user?.role || "")}
          />
        )}

        {tab === "damage" && (
          <DamagePassportTab
            vehicleId={vehicleId!}
            canSubmit={canSubmit(user?.role)}
            canVerify={["rto", "police", "workshop", "admin"].includes(
              user?.role || "",
            )}
          />
        )}

        {tab === "battery" && (
          <BatteryPassportTab
            vehicleId={vehicleId!}
            canSubmit={canSubmit(user?.role)}
          />
        )}
      </div>
    </DashboardLayout>
  );
}
