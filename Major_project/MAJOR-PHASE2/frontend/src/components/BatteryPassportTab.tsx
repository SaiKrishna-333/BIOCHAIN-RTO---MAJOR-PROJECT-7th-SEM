import { useCallback, useEffect, useState } from "react";
import api from "../services/api";
import ViewTransactionButton from "./ViewTransactionButton";
import { formatDate } from "../lib/display";

// Feature 7: Electric Vehicle Battery Passport
// One passport per EV; every reading is APPENDED as a labelled history event.
// There is no automatic battery telematics feed - every value must declare its
// source (owner-reported, workshop-verified, diagnostic-device, simulated-demo).

type ApiError = {
  response?: { data?: { message?: string; errors?: string[] } };
};
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

interface BatteryEvent {
  eventType: string;
  eventDate: string;
  stateOfHealthPercent?: number;
  capacityKwh?: number;
  cycleCount?: number;
  rangeKmEstimate?: number;
  sourceType: string;
  sourceDescription?: string;
  notes?: string;
  replacementDetails?: string;
  anchor?: { recordHash?: string; status?: string; txHash?: string | null };
}

interface Passport {
  batteryIdentifier: string;
  manufacturer?: string;
  chemistry?: string;
  nominalCapacityKwh?: number;
  currentSoH?: number;
  lastTestedAt?: string;
  lastSource?: string;
  events?: BatteryEvent[];
  anchor?: { recordHash?: string; status?: string; txHash?: string | null };
}

const SOURCE_TYPES = [
  "owner-reported",
  "workshop-verified",
  "diagnostic-device",
  "simulated-demo",
  "unverified",
];

const EVENT_TYPES = [
  "initial-report",
  "soh-report",
  "replacement",
  "warranty-update",
  "charging-data",
  "inspection",
];

export default function BatteryPassportTab({
  vehicleId,
  canSubmit,
}: {
  vehicleId: string;
  canSubmit: boolean;
}) {
  const [exists, setExists] = useState(false);
  const [passport, setPassport] = useState<Passport | null>(null);
  const [chart, setChart] = useState<
    { date: string; soh: number; source: string }[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showEvent, setShowEvent] = useState(false);

  const [createForm, setCreateForm] = useState({
    batteryIdentifier: "",
    manufacturer: "",
    chemistry: "lithium-ion",
    nominalCapacityKwh: "",
    installationDate: "",
  });
  const [eventForm, setEventForm] = useState({
    eventType: "soh-report",
    eventDate: "",
    stateOfHealthPercent: "",
    capacityKwh: "",
    cycleCount: "",
    rangeKmEstimate: "",
    sourceType: "workshop-verified",
    sourceDescription: "",
    notes: "",
    replacementDetails: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.get(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/battery`,
      );
      setExists(res.data.exists);
      setPassport(res.data.passport || null);
      setChart(res.data.healthChart || []);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load battery passport."));
    } finally {
      setLoading(false);
    }
  }, [vehicleId]);

  useEffect(() => {
    load();
  }, [load]);

  const createPassport = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const res = await api.post(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/battery`,
        {
          ...createForm,
          nominalCapacityKwh: createForm.nominalCapacityKwh
            ? Number(createForm.nominalCapacityKwh)
            : undefined,
          isElectric: true,
        },
      );
      setNotice(res.data.message);
      setShowCreate(false);
      setCreateForm({
        batteryIdentifier: "",
        manufacturer: "",
        chemistry: "lithium-ion",
        nominalCapacityKwh: "",
        installationDate: "",
      });
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(
        errs ? errs.join(" ") : apiMessage(err, "Failed to create passport."),
      );
    }
  };

  const addEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const num = (v: string) => (v === "" ? undefined : Number(v));
      await api.post(`/vehicle-intelligence/battery/${vehicleId}/events`, {
        eventType: eventForm.eventType,
        eventDate: eventForm.eventDate || undefined,
        stateOfHealthPercent: num(eventForm.stateOfHealthPercent),
        capacityKwh: num(eventForm.capacityKwh),
        cycleCount: num(eventForm.cycleCount),
        rangeKmEstimate: num(eventForm.rangeKmEstimate),
        sourceType: eventForm.sourceType,
        sourceDescription: eventForm.sourceDescription || undefined,
        notes: eventForm.notes || undefined,
        replacementDetails: eventForm.replacementDetails || undefined,
      });
      setNotice("Battery history event appended.");
      setShowEvent(false);
      setEventForm({
        ...eventForm,
        stateOfHealthPercent: "",
        capacityKwh: "",
        cycleCount: "",
        rangeKmEstimate: "",
        eventDate: "",
        sourceDescription: "",
        notes: "",
        replacementDetails: "",
      });
      load();
    } catch (err: unknown) {
      const errs = (err as ApiError)?.response?.data?.errors;
      setError(errs ? errs.join(" ") : apiMessage(err, "Failed to add event."));
    }
  };

  const maxSoh = 100;

  return (
    <div>
      {error && <div className="alert alert-danger">{error}</div>}
      {notice && <div className="alert alert-info">{notice}</div>}

      {loading ? (
        <p>Loading battery passport…</p>
      ) : !exists ? (
        <div>
          <div className="alert alert-secondary">
            No battery passport exists for this vehicle yet. EV only — every
            reading is labelled by its declared source (no live battery feed is
            read).
          </div>
          {canSubmit &&
            (!showCreate ? (
              <button
                className="btn btn-success"
                onClick={() => setShowCreate(true)}
              >
                + Create Battery Passport
              </button>
            ) : (
              <form
                onSubmit={createPassport}
                className="card"
                style={{ padding: 20 }}
              >
                <h5>Create EV Battery Passport</h5>
                <div className="row g-3">
                  <div className="col-md-4">
                    <label>Battery Identifier *</label>
                    <input
                      className="form-control"
                      required
                      value={createForm.batteryIdentifier}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          batteryIdentifier: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-4">
                    <label>Manufacturer</label>
                    <input
                      className="form-control"
                      value={createForm.manufacturer}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          manufacturer: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-4">
                    <label>Chemistry</label>
                    <select
                      className="form-control"
                      value={createForm.chemistry}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          chemistry: e.target.value,
                        })
                      }
                    >
                      <option value="lithium-ion">Lithium-ion</option>
                      <option value="lfp">LFP</option>
                      <option value="nickel-metal-hydride">NiMH</option>
                      <option value="solid-state">Solid-state</option>
                      <option value="other">Other</option>
                      <option value="unknown">Unknown</option>
                    </select>
                  </div>
                  <div className="col-md-4">
                    <label>Nominal Capacity (kWh)</label>
                    <input
                      type="number"
                      min={0}
                      step="0.1"
                      className="form-control"
                      value={createForm.nominalCapacityKwh}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          nominalCapacityKwh: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-4">
                    <label>Installation Date</label>
                    <input
                      type="date"
                      max={new Date().toISOString().slice(0, 10)}
                      className="form-control"
                      value={createForm.installationDate}
                      onChange={(e) =>
                        setCreateForm({
                          ...createForm,
                          installationDate: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                <div style={{ marginTop: 15 }}>
                  <button type="submit" className="btn btn-primary">
                    Create
                  </button>{" "}
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => setShowCreate(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ))}
        </div>
      ) : (
        <div>
          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 8,
              }}
            >
              <h5 style={{ marginTop: 0, marginBottom: 0 }}>
                {passport?.batteryIdentifier}
                {passport?.manufacturer ? ` — ${passport.manufacturer}` : ""}
              </h5>
              <ViewTransactionButton
                txHash={passport?.anchor?.txHash}
                status={passport?.anchor?.status}
                label="View Passport Anchoring Tx"
                className="btn btn-sm btn-outline-success"
              />
            </div>
            <div
              style={{
                display: "flex",
                gap: 20,
                flexWrap: "wrap",
                fontSize: "0.92rem",
              }}
            >
              <span>
                Chemistry: <strong>{passport?.chemistry}</strong>
              </span>
              {passport?.nominalCapacityKwh ? (
                <span>
                  Nominal: <strong>{passport.nominalCapacityKwh} kWh</strong>
                </span>
              ) : null}
              <span>
                Latest SoH:{" "}
                <strong>
                  {passport?.currentSoH != null
                    ? `${passport.currentSoH}%`
                    : "— not recorded"}
                </strong>
                {passport?.lastSource ? (
                  <em> ({passport.lastSource})</em>
                ) : null}
              </span>
            </div>
          </div>

          {chart.length > 1 && (
            <div className="card" style={{ padding: 20, marginBottom: 20 }}>
              <strong>State-of-Health trend</strong>
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-end",
                  gap: 8,
                  height: 120,
                  marginTop: 12,
                }}
              >
                {chart.map((pt, i) => (
                  <div key={i} style={{ textAlign: "center", flex: 1 }}>
                    <div
                      title={`${pt.soh}% (${pt.source})`}
                      style={{
                        height: `${(pt.soh / maxSoh) * 100}px`,
                        background: "var(--color-success)",
                        borderRadius: 3,
                        minHeight: 4,
                      }}
                    />
                    <div
                      style={{
                        fontSize: "0.7rem",
                        color: "#777",
                        marginTop: 4,
                      }}
                    >
                      {formatDate(pt.date)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {canSubmit && (
            <div style={{ marginBottom: 20 }}>
              {!showEvent ? (
                <button
                  className="btn btn-success"
                  onClick={() => setShowEvent(true)}
                >
                  + Append History Event
                </button>
              ) : (
                <form
                  onSubmit={addEvent}
                  className="card"
                  style={{ padding: 20 }}
                >
                  <h5>Append Battery History Event</h5>
                  <div className="row g-3">
                    <div className="col-md-3">
                      <label>Event Type</label>
                      <select
                        className="form-control"
                        value={eventForm.eventType}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            eventType: e.target.value,
                          })
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
                      <label>Source Type *</label>
                      <select
                        className="form-control"
                        value={eventForm.sourceType}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            sourceType: e.target.value,
                          })
                        }
                      >
                        {SOURCE_TYPES.map((t) => (
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
                        max={new Date().toISOString().slice(0, 10)}
                        className="form-control"
                        value={eventForm.eventDate}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            eventDate: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-md-3">
                      <label>State of Health %</label>
                      <input
                        type="number"
                        min={0}
                        max={100}
                        className="form-control"
                        value={eventForm.stateOfHealthPercent}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            stateOfHealthPercent: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-md-3">
                      <label>Capacity (kWh)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.1"
                        className="form-control"
                        value={eventForm.capacityKwh}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            capacityKwh: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-md-3">
                      <label>Cycle Count</label>
                      <input
                        type="number"
                        min={0}
                        className="form-control"
                        value={eventForm.cycleCount}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            cycleCount: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-md-3">
                      <label>Range Estimate (km)</label>
                      <input
                        type="number"
                        min={0}
                        className="form-control"
                        value={eventForm.rangeKmEstimate}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            rangeKmEstimate: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-md-3">
                      <label>Replacement Details</label>
                      <input
                        className="form-control"
                        value={eventForm.replacementDetails}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            replacementDetails: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-12">
                      <label>
                        Source Description (e.g. OBD scan at XYZ centre)
                      </label>
                      <input
                        className="form-control"
                        value={eventForm.sourceDescription}
                        onChange={(e) =>
                          setEventForm({
                            ...eventForm,
                            sourceDescription: e.target.value,
                          })
                        }
                      />
                    </div>
                    <div className="col-12">
                      <label>Notes</label>
                      <textarea
                        rows={2}
                        className="form-control"
                        value={eventForm.notes}
                        onChange={(e) =>
                          setEventForm({ ...eventForm, notes: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 15 }}>
                    <button type="submit" className="btn btn-primary">
                      Append Event
                    </button>{" "}
                    <button
                      type="button"
                      className="btn btn-outline-secondary"
                      onClick={() => setShowEvent(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}

          <h6>
            History ({passport?.events?.length ?? 0} events — never overwritten)
          </h6>
          {!passport?.events?.length ? (
            <div className="alert alert-secondary">No history events yet.</div>
          ) : (
            passport.events
              .slice()
              .reverse()
              .map((ev, i) => (
                <div
                  key={i}
                  className="card"
                  style={{ padding: 12, marginBottom: 10 }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: 6,
                    }}
                  >
                    <strong>
                      {formatDate(ev.eventDate)} —{" "}
                      {ev.eventType}
                    </strong>
                    <span className="badge bg-info text-dark">
                      {ev.sourceType}
                    </span>
                  </div>
                  {(ev.anchor?.txHash || ev.anchor?.status) && (
                    <div style={{ marginTop: 6 }}>
                      <ViewTransactionButton
                        txHash={ev.anchor?.txHash}
                        status={ev.anchor?.status}
                        label="Tx"
                        className="btn btn-sm btn-outline-success"
                      />
                    </div>
                  )}
                  <div style={{ fontSize: "0.88rem", marginTop: 4 }}>
                    {ev.stateOfHealthPercent != null ? (
                      <span>SoH {ev.stateOfHealthPercent}% · </span>
                    ) : null}
                    {ev.capacityKwh != null ? (
                      <span>{ev.capacityKwh} kWh · </span>
                    ) : null}
                    {ev.cycleCount != null ? (
                      <span>{ev.cycleCount} cycles · </span>
                    ) : null}
                    {ev.rangeKmEstimate != null ? (
                      <span>~{ev.rangeKmEstimate} km · </span>
                    ) : null}
                    {ev.replacementDetails ? (
                      <span>Replacement: {ev.replacementDetails} · </span>
                    ) : null}
                  </div>
                  {ev.sourceDescription && (
                    <div style={{ fontSize: "0.82rem", color: "#777" }}>
                      Source: {ev.sourceDescription}
                    </div>
                  )}
                  {ev.notes && (
                    <div style={{ fontSize: "0.85rem", marginTop: 4 }}>
                      {ev.notes}
                    </div>
                  )}
                </div>
              ))
          )}

          <div
            className="alert alert-secondary"
            style={{ marginTop: 15, fontSize: "0.82rem" }}
          >
            This project does not read a live EV battery. All values are
            submitted and clearly labelled by their declared source;
            "simulated-demo" marks synthetic demonstration data.
          </div>
        </div>
      )}
    </div>
  );
}
