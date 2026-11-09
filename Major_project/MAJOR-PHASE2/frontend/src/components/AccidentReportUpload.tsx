// AccidentReportUpload.tsx
// Owner half of the accident evidence feature: the owner states what happened,
// attaches the dashcam clip or photos from their own phone, and can then see
// where the submission stands - including what an officer concluded.
//
// Two things are deliberate:
// - a submission always lands as REPORTED. Only police or RTO can move it to
//   verified or disputed, so an owner can never mark their own word as proven.
// - the statement is never editable after upload. The officer's finding is
//   stored beside it, which is what lets the record keep hashing to what the
//   owner actually submitted.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/useAuth";
import EvidencePlayer from "./EvidencePlayer";
import type { Vehicle } from "../types/api";
import { formatDate, formatDateTime } from "../lib/display";

interface AccidentInfo {
  location?: string;
  oppositePartyRegNumber?: string | null;
  oppositePartyName?: string | null;
  oppositePartyPhone?: string | null;
  oppositePartyInsurance?: string | null;
  policeStation?: string | null;
  firNumber?: string | null;
  injuries?: string;
}

interface OfficerReview {
  outcome?: string;
  remarks?: string | null;
  reviewedByName?: string;
  reviewedByRole?: string;
  reviewedAt?: string;
}

interface EvidenceRow {
  fileName: string;
  contentType: string;
  fileSize: number;
  sha256: string;
  storage?: string;
}

interface OwnerUpload {
  _id: string;
  eventDate: string;
  description: string;
  severity: string;
  verificationStatus: string;
  sourceChannel?: string;
  accident?: AccidentInfo;
  officerReview?: OfficerReview;
  evidence: EvidenceRow[];
  anchor?: { recordHash?: string };
  createdAt: string;
}

const MAX_FILES = 4;
const MAX_FILE_BYTES = 60 * 1024 * 1024;
const ACCEPTED_TYPES = [
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "image/jpeg",
  "image/png",
  "image/webp",
];

const today = () => new Date().toISOString().slice(0, 10);

const statusBadge = (status: string) => {
  if (status === "verified") return "bg-success";
  if (status === "disputed") return "bg-danger";
  return "bg-warning text-dark";
};

const statusLabel = (status: string) =>
  status === "verified"
    ? "Verified by an officer"
    : status === "disputed"
      ? "Disputed by an officer"
      : "Awaiting officer verification";

export default function AccidentReportUpload() {
  const { api } = useAuth();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [form, setForm] = useState({
    eventDate: today(),
    location: "",
    severity: "moderate",
    injuries: "none",
    description: "",
    oppositePartyRegNumber: "",
    oppositePartyName: "",
    oppositePartyPhone: "",
    oppositePartyInsurance: "",
    policeStation: "",
    firNumber: "",
  });
  const [uploadHistory, setUploadHistory] = useState<OwnerUpload[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await api.get("/vehicles/my");
        const list: Vehicle[] = res.data || [];
        setVehicles(list);
        if (list[0]?._id) setVehicleId(list[0]._id);
      } catch (err: unknown) {
        setError(
          (err as { message?: string })?.message ||
            "Could not load your vehicles",
        );
      }
    })();
  }, [api]);

  // Whatever the owner already reported on the selected vehicle, so the outcome
  // of a submission is visible without waiting for a call back.
  const fetchMyUploads = useCallback(async () => {
    if (!vehicleId) return;
    try {
      const res = await api.get(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/damage-events`,
      );
      const events: OwnerUpload[] = (res.data.events || []).filter(
        (e: OwnerUpload) => e.sourceChannel === "owner-upload",
      );
      setUploadHistory(events);
    } catch {
      setUploadHistory([]);
    }
  }, [api, vehicleId]);

  useEffect(() => {
    fetchMyUploads();
  }, [fetchMyUploads]);

  const setField = (key: keyof typeof form, value: string) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const rejected = useMemo(() => {
    const reasons: string[] = [];
    if (files.length > MAX_FILES)
      reasons.push(`At most ${MAX_FILES} files per report.`);
    for (const f of files) {
      if (!ACCEPTED_TYPES.includes(f.type)) {
        reasons.push(`“${f.name}” is not a supported file type.`);
      }
      if (f.size > MAX_FILE_BYTES) {
        reasons.push(`“${f.name}” is larger than 60 MB.`);
      }
    }
    return reasons;
  }, [files]);

  const canSubmit =
    !!vehicleId &&
    !!files.length &&
    !rejected.length &&
    !!form.eventDate &&
    !!form.location.trim() &&
    !!form.description.trim() &&
    !busy;

  const submit = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([key, value]) => fd.append(key, value));
      files.forEach((f) => fd.append("media", f));
      const res = await api.post(
        `/vehicle-intelligence/vehicle-history/${vehicleId}/accident-upload`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setMessage(res.data.message);
      setFiles([]);
      setForm((prev) => ({ ...prev, description: "" }));
      await fetchMyUploads();
    } catch (err: unknown) {
      const payload = (err as { response?: { data?: { errors?: string[] } } })
        ?.response?.data;
      setError(
        (err as { message?: string })?.message ||
          (payload?.errors || []).join(" ") ||
          "Could not submit the accident report",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!vehicles.length) {
    return (
      <div>
        <h4 style={{ marginTop: 0 }}>Report an Accident with Evidence</h4>
        <p>No vehicles registered under your account yet.</p>
      </div>
    );
  }

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Report an Accident with Evidence</h4>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Upload the dashcam clip or photos you already have, describe what
        happened, and add the other party's details if you noted them. Police
        and RTO officers are alerted immediately and can play your files,
        re-check them against the fingerprint taken at upload, and record
        whether they accept or dispute the account. mParivahan has no place for
        the owner's own evidence — here it becomes part of the vehicle's
        tamper-evident history.
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

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div className="row">
          <div className="form-group col-md-6">
            <label>Vehicle</label>
            <select
              className="form-control"
              value={vehicleId}
              onChange={(e) => setVehicleId(e.target.value)}
            >
              {vehicles.map((v) => (
                <option key={v._id} value={v._id}>
                  {v.regNumber || "Pending registration"} — {v.make} {v.model}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group col-md-3">
            <label>Date of accident</label>
            <input
              type="date"
              className="form-control"
              max={today()}
              value={form.eventDate}
              onChange={(e) => setField("eventDate", e.target.value)}
            />
          </div>
          <div className="form-group col-md-3">
            <label>Severity</label>
            <select
              className="form-control"
              value={form.severity}
              onChange={(e) => setField("severity", e.target.value)}
            >
              <option value="minor">Minor</option>
              <option value="moderate">Moderate</option>
              <option value="severe">Severe</option>
              <option value="unknown">Not sure</option>
            </select>
          </div>
        </div>

        <div className="row">
          <div className="form-group col-md-6">
            <label>Location (place, city)</label>
            <input
              className="form-control"
              placeholder="e.g. Junction of Road No 5, Banjara Hills"
              value={form.location}
              onChange={(e) => setField("location", e.target.value)}
            />
          </div>
          <div className="form-group col-md-3">
            <label>Injuries</label>
            <select
              className="form-control"
              value={form.injuries}
              onChange={(e) => setField("injuries", e.target.value)}
            >
              <option value="none">None</option>
              <option value="minor">Minor</option>
              <option value="serious">Serious</option>
              <option value="unknown">Not sure</option>
            </select>
          </div>
          <div className="form-group col-md-3">
            <label>FIR number (if filed)</label>
            <input
              className="form-control"
              placeholder="Optional"
              value={form.firNumber}
              onChange={(e) => setField("firNumber", e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label>What happened</label>
          <textarea
            className="form-control"
            rows={3}
            placeholder="Describe the collision in your own words. This statement cannot be changed after upload."
            value={form.description}
            onChange={(e) => setField("description", e.target.value)}
          />
        </div>

        <div className="row">
          <div className="form-group col-md-3">
            <label>Other vehicle number</label>
            <input
              className="form-control"
              placeholder="TS07AB1234"
              value={form.oppositePartyRegNumber}
              onChange={(e) =>
                setField("oppositePartyRegNumber", e.target.value.toUpperCase())
              }
            />
          </div>
          <div className="form-group col-md-3">
            <label>Other party name</label>
            <input
              className="form-control"
              placeholder="Optional"
              value={form.oppositePartyName}
              onChange={(e) => setField("oppositePartyName", e.target.value)}
            />
          </div>
          <div className="form-group col-md-3">
            <label>Other party phone</label>
            <input
              className="form-control"
              placeholder="Optional"
              value={form.oppositePartyPhone}
              onChange={(e) => setField("oppositePartyPhone", e.target.value)}
            />
          </div>
          <div className="form-group col-md-3">
            <label>Other party insurance</label>
            <input
              className="form-control"
              placeholder="Policy number, if known"
              value={form.oppositePartyInsurance}
              onChange={(e) =>
                setField("oppositePartyInsurance", e.target.value)
              }
            />
          </div>
        </div>

        <div className="form-group">
          <label>Police station (if informed)</label>
          <input
            className="form-control"
            placeholder="Optional"
            value={form.policeStation}
            onChange={(e) => setField("policeStation", e.target.value)}
            style={{ maxWidth: 420 }}
          />
        </div>

        <div className="form-group">
          <label>Dashcam video / accident photos</label>
          <input
            type="file"
            className="form-control-file"
            multiple
            accept="video/*,image/jpeg,image/png,image/webp"
            onChange={(e) => setFiles(Array.from(e.target.files || []))}
          />
          <small style={{ color: "#666" }}>
            MP4, MOV, WebM, AVI video or JPEG/PNG/WebP photos · up to{" "}
            {MAX_FILES} files · 60 MB each
          </small>
        </div>

        {files.length > 0 && (
          <ul style={{ paddingLeft: 18, margin: "6px 0" }}>
            {files.map((f) => (
              <li key={`${f.name}-${f.size}`} style={{ fontSize: "0.85rem" }}>
                {f.name} — {(f.size / (1024 * 1024)).toFixed(1)} MB
              </li>
            ))}
          </ul>
        )}
        {rejected.length > 0 && (
          <div className="alert alert-danger" role="alert">
            {rejected.join(" ")}
          </div>
        )}

        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginTop: 10,
            flexWrap: "wrap",
          }}
        >
          <button
            className="btn btn-primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "Uploading evidence…" : "Upload Accident Evidence"}
          </button>
          {files.some((f) => f.size > 8 * 1024 * 1024) && !busy && (
            <small style={{ color: "#666" }}>
              Large clip — the upload may take a while.
            </small>
          )}
        </div>
      </div>

      {uploadHistory.length > 0 && (
        <>
          <h5>My accident submissions for this vehicle</h5>
          {uploadHistory.map((u) => (
            <div
              key={u._id}
              className="card"
              style={{
                padding: 14,
                marginBottom: 10,
                borderLeft: `4px solid ${
                  u.verificationStatus === "verified"
                    ? "var(--color-success)"
                    : u.verificationStatus === "disputed"
                      ? "var(--color-danger)"
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
                  {formatDate(u.eventDate)} —{" "}
                  {u.accident?.location}
                </strong>
                <span className={`badge ${statusBadge(u.verificationStatus)}`}>
                  {statusLabel(u.verificationStatus)}
                </span>
              </div>
              <p style={{ fontSize: "0.88rem", margin: "6px 0 0" }}>
                {u.description}
              </p>
              {(u.accident?.oppositePartyRegNumber ||
                u.accident?.firNumber) && (
                <p
                  style={{
                    fontSize: "0.82rem",
                    color: "#555",
                    margin: "4px 0",
                  }}
                >
                  {[
                    u.accident?.oppositePartyRegNumber
                      ? `Other vehicle ${u.accident.oppositePartyRegNumber}`
                      : null,
                    u.accident?.policeStation
                      ? `Station ${u.accident.policeStation}`
                      : null,
                    u.accident?.firNumber
                      ? `FIR ${u.accident.firNumber}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              <div style={{ marginTop: 8 }}>
                {u.evidence.map((f, idx) => (
                  <EvidencePlayer
                    key={`${u._id}-${idx}`}
                    eventId={u._id}
                    index={idx}
                    fileName={f.fileName}
                    contentType={f.contentType}
                    fileSize={f.fileSize}
                    isVideo={(f.contentType || "").startsWith("video/")}
                  />
                ))}
              </div>
              {u.officerReview && u.officerReview.outcome !== "pending" && (
                <div
                  style={{
                    marginTop: 8,
                    padding: 8,
                    background: "var(--color-bg-tertiary)",
                    borderRadius: 6,
                    fontSize: "0.84rem",
                  }}
                >
                  <strong>
                    {u.officerReview.reviewedByName || "Officer"} (
                    {(
                      u.officerReview.reviewedByRole || "officer"
                    ).toUpperCase()}
                    )
                  </strong>{" "}
                  on{" "}
                  {u.officerReview.reviewedAt
                    ? formatDateTime(u.officerReview.reviewedAt)
                    : "—"}
                  {u.officerReview.remarks
                    ? ` — “${u.officerReview.remarks}”`
                    : ""}
                </div>
              )}
              {u.anchor?.recordHash && (
                <p
                  style={{
                    fontSize: "0.75rem",
                    color: "#777",
                    margin: "6px 0 0",
                    wordBreak: "break-all",
                  }}
                >
                  Fingerprint of this statement:{" "}
                  {u.anchor.recordHash.slice(0, 24)}… — it will not change,
                  whatever the review outcome.
                </p>
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
