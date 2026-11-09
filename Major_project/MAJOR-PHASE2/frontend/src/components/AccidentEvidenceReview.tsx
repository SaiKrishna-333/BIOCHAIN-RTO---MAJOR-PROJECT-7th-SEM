// AccidentEvidenceReview.tsx
// Officer half of the accident evidence feature, shared by the police and the
// RTO dashboard: every upload an owner has made, newest first, with the media
// playable in place.
//
// The queue exists to make one point unmistakable - an owner's word and a
// verified fact are different things. So the officer is shown the fingerprint
// taken at upload, can re-check it, and must record a finding. The finding is
// stored next to the statement instead of replacing it, which is what keeps the
// owner's submission verifiable after the review.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import EvidencePlayer from "./EvidencePlayer";
import { formatDate, formatDateTime } from "../lib/display";

interface MediaRow {
  index: number;
  fileName: string;
  contentType?: string;
  fileSize?: number;
  sha256?: string;
  isVideo?: boolean;
}

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

interface UploadRow {
  _id: string;
  regNumber?: string;
  vehicle?: string;
  eventDate: string;
  description: string;
  severity?: string;
  verificationStatus: string;
  accident?: AccidentInfo;
  officerReview?: {
    outcome?: string;
    remarks?: string | null;
    reviewedByName?: string;
    reviewedByRole?: string;
    reviewedAt?: string;
  };
  owner?: { name?: string; email?: string; phone?: string };
  media: MediaRow[];
  anchor?: { recordHash?: string; status?: string };
  submittedAt: string;
}

interface IntegrityResult {
  allEvidenceIntact: boolean;
  recordIntegrity?: { verified?: boolean };
  evidence?: { fileName: string; verified: boolean }[];
  limitation?: string;
}

const FILTERS = [
  { id: "pending", label: "Waiting for review" },
  { id: "verified", label: "Verified" },
  { id: "disputed", label: "Disputed" },
  { id: "all", label: "All" },
];

export default function AccidentEvidenceReview() {
  const { api } = useAuth();
  const [filter, setFilter] = useState("pending");
  const [uploads, setUploads] = useState<UploadRow[]>([]);
  const [note, setNote] = useState("");
  const [remarks, setRemarks] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<Record<string, IntegrityResult>>(
    {},
  );
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const fetchQueue = useCallback(async () => {
    setError(null);
    try {
      const res = await api.get(`/vehicle-intelligence/accident-uploads`, {
        params: { status: filter },
      });
      setUploads(res.data.uploads || []);
      setNote(res.data.note || "");
    } catch (err: unknown) {
      setError(
        (err as { message?: string })?.message || "Could not load the queue",
      );
    }
  }, [api, filter]);

  useEffect(() => {
    fetchQueue();
  }, [fetchQueue]);

  const recheck = async (u: UploadRow) => {
    setBusyId(u._id);
    setError(null);
    try {
      const res = await api.get(
        `/vehicle-intelligence/damage-events/${u._id}/verify-integrity`,
      );
      setIntegrity((prev) => ({ ...prev, [u._id]: res.data }));
    } catch (err: unknown) {
      setError(
        (err as { message?: string })?.message || "Integrity check failed",
      );
    } finally {
      setBusyId(null);
    }
  };

  const decide = async (u: UploadRow, decision: "verified" | "disputed") => {
    setBusyId(u._id);
    setError(null);
    setMessage(null);
    try {
      const res = await api.patch(
        `/vehicle-intelligence/damage-events/${u._id}/decision`,
        { decision, remarks: remarks[u._id] || undefined },
      );
      setMessage(
        `Marked ${decision.toUpperCase()} for ${u.regNumber || "this vehicle"}${
          res.data.event?.officerReview?.reviewedByName
            ? ` by ${res.data.event.officerReview.reviewedByName}`
            : ""
        }. The owner has been notified.`,
      );
      await fetchQueue();
    } catch (err: unknown) {
      setError(
        (err as { message?: string })?.message ||
          "Could not record the finding",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <h4 style={{ margin: 0 }}>Accident Evidence Review</h4>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`btn btn-sm ${
                filter === f.id ? "btn-primary" : "btn-outline-primary"
              }`}
              onClick={() => setFilter(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <p style={{ color: "#666", fontSize: "0.9rem" }}>
        Owners upload their own dashcam clips and photos here. Play the media,
        re-check the fingerprints, then record whether you accept or dispute the
        account.
      </p>
      {note && <p style={{ color: "#856404", fontSize: "0.85rem" }}>{note}</p>}
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

      {uploads.length === 0 && (
        <div className="card" style={{ padding: 14 }}>
          No owner accident uploads in this state.
        </div>
      )}

      {uploads.map((u) => {
        const check = integrity[u._id];
        const review = u.officerReview;
        return (
          <div
            key={u._id}
            className="card"
            style={{
              padding: 16,
              marginBottom: 12,
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
              <strong style={{ fontSize: "1.05rem" }}>
                {u.regNumber || "Vehicle not linked"} —{" "}
                {formatDate(u.eventDate)}
              </strong>
              <span
                className={`badge ${
                  u.verificationStatus === "verified"
                    ? "bg-success"
                    : u.verificationStatus === "disputed"
                      ? "bg-danger"
                      : "bg-warning text-dark"
                }`}
              >
                {u.verificationStatus}
              </span>
            </div>

            <p style={{ fontSize: "0.9rem", margin: "6px 0" }}>
              {u.description}
            </p>

            <div style={{ fontSize: "0.85rem", color: "#555" }}>
              <div>
                Location: {u.accident?.location || "not stated"} · Severity:{" "}
                {u.severity || "unknown"} · Injuries:{" "}
                {u.accident?.injuries || "unknown"}
              </div>
              <div>
                Reported by {u.owner?.name || "owner"} (
                {u.owner?.email || "no email"}
                {u.owner?.phone ? `, ${u.owner.phone}` : ""}) · uploaded{" "}
                {formatDateTime(u.submittedAt)}
              </div>
              {(u.accident?.oppositePartyRegNumber ||
                u.accident?.oppositePartyName ||
                u.accident?.firNumber) && (
                <div>
                  Other party: {u.accident?.oppositePartyRegNumber || "—"}
                  {u.accident?.oppositePartyName
                    ? ` (${u.accident.oppositePartyName}${
                        u.accident.oppositePartyPhone
                          ? `, ${u.accident.oppositePartyPhone}`
                          : ""
                      })`
                    : ""}
                  {u.accident?.oppositePartyInsurance
                    ? ` · insurance ${u.accident.oppositePartyInsurance}`
                    : ""}
                  {u.accident?.firNumber
                    ? ` · FIR ${u.accident.firNumber}`
                    : ""}
                  {u.accident?.policeStation
                    ? ` · ${u.accident.policeStation} PS`
                    : ""}
                </div>
              )}
            </div>

            <div style={{ marginTop: 10 }}>
              {u.media.map((m) => (
                <EvidencePlayer
                  key={`${u._id}-${m.index}`}
                  eventId={u._id}
                  index={m.index}
                  fileName={m.fileName}
                  contentType={m.contentType}
                  fileSize={m.fileSize}
                  isVideo={m.isVideo}
                />
              ))}
              {u.media.length === 0 && (
                <span style={{ color: "#888", fontSize: "0.85rem" }}>
                  No files attached.
                </span>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: 6,
              }}
            >
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => recheck(u)}
                disabled={busyId === u._id}
              >
                Re-check fingerprints
              </button>
              {check && (
                <span
                  className={`badge ${
                    check.allEvidenceIntact && check.recordIntegrity?.verified
                      ? "bg-success"
                      : "bg-danger"
                  }`}
                >
                  {check.allEvidenceIntact && check.recordIntegrity?.verified
                    ? "Files and record unchanged since upload"
                    : "Mismatch — evidence has changed"}
                </span>
              )}
            </div>
            {check?.limitation && (
              <p
                style={{ fontSize: "0.78rem", color: "#777", margin: "4px 0" }}
              >
                {check.limitation}
              </p>
            )}

            {review && review.outcome && review.outcome !== "pending" && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  background: "var(--color-bg-tertiary)",
                  borderRadius: 6,
                  fontSize: "0.84rem",
                }}
              >
                <strong>Last finding: {review.outcome.toUpperCase()}</strong> by{" "}
                {review.reviewedByName || "an officer"} (
                {(review.reviewedByRole || "").toUpperCase()}) on{" "}
                {review.reviewedAt
                  ? formatDateTime(review.reviewedAt)
                  : "—"}
                {review.remarks ? ` — “${review.remarks}”` : ""}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                marginTop: 10,
                flexWrap: "wrap",
              }}
            >
              <input
                className="form-control form-control-sm"
                placeholder="Remarks for the record (what did you see in the clip?)"
                value={remarks[u._id] || ""}
                onChange={(e) =>
                  setRemarks((prev) => ({ ...prev, [u._id]: e.target.value }))
                }
                style={{ flex: "1 1 260px", maxWidth: 460 }}
              />
              <button
                className="btn btn-success btn-sm"
                onClick={() => decide(u, "verified")}
                disabled={busyId === u._id}
              >
                Verify evidence
              </button>
              <button
                className="btn btn-danger btn-sm"
                onClick={() => decide(u, "disputed")}
                disabled={busyId === u._id}
              >
                Dispute evidence
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
