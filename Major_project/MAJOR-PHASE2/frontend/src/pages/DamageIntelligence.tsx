// DamageIntelligence.tsx
// Feature 9: 3D Vehicle Damage & Repair Intelligence console.
//
// What this page does, and the honesty it keeps to (Step 11.5 of the specification):
//   * It opens an EXISTING accident or starts the single accident record - it never
//     creates a duplicate accident for the same incident.
//   * Photographs drive the assessment. The analysis step is pluggable: with no
//     computer-vision endpoint configured the server honestly returns "manual mode"
//     and produces no automated findings, so the assessor records what they see.
//   * The 3D model only colours components that a real finding maps to. Unassessed
//     parts stay neutral and are never shown as "undamaged".
//   * Repair prices come only from the configured catalogue; anything without a price
//     is flagged, never invented.
//   * Approving an estimate, recording completion, and verification after a passed
//     final inspection are three distinct states. A hash proves integrity only.
import { useCallback, useEffect, useRef, useState } from "react";
import api from "../services/api";
import DashboardLayout from "../components/DashboardLayout";
import ViewTransactionButton from "../components/ViewTransactionButton";
import VehicleDamageViewer, {
  DAMAGE_COMPONENT_LABELS,
  type ViewerFinding,
} from "../components/VehicleDamageViewer";
import { useAuth } from "../context/useAuth";
import { formatDateTime, formatMoney, enumLabel } from "../lib/display";
import { notify } from "../lib/notify";

type DamageFinding = {
  id: string;
  component: string;
  label: string;
  detectionState: string;
  source: string;
  sourceDetail?: string | null;
  confidence?: number | null;
  severity: string;
  recommendation: string;
  inspectorNotes?: string | null;
  mappedTo3D: boolean;
  linkedPhotoIndex?: number | null;
  assessedByName?: string | null;
  corrections?: {
    field: string;
    previousValue: string;
    newValue: string;
    reason?: string;
    correctedByName?: string;
  }[];
};
type EstimateItem = {
  component: string;
  findingLabel?: string;
  proposedAction: string;
  partsCost: number;
  labourCost: number;
  additionalCost: number;
  total: number;
  priceBasis: string;
  note?: string;
};
type Assessment = {
  id: string;
  assessmentRef: string;
  vehicle: string;
  regNumber: string;
  linkedDamageEvent: string | null;
  status: string;
  incidentNotes: string;
  suspectedArea: string;
  analysis: {
    mode: string;
    note?: string;
    limitation?: string;
    engineName?: string | null;
  };
  photos: {
    index: number;
    fileName: string;
    view: string;
    contentType: string;
    fileSize: number;
    url: string;
  }[];
  findings: DamageFinding[];
  estimate: {
    version: number;
    currency: string;
    items: EstimateItem[];
    partsTotal: number;
    labourTotal: number;
    grandTotal: number;
    status: string;
    note?: string;
  } | null;
  decisions: {
    stage: string;
    decision: string;
    reason?: string;
    byName?: string;
    byRole?: string;
    at?: string;
  }[];
  repairCompletion: {
    workshop?: string;
    technician?: string;
    completedAt?: string;
    workSummary?: string;
    finalInspection: string;
    verified: boolean;
    note?: string;
    evidenceCount: number;
    evidence: {
      index: number;
      fileName: string;
      sha256?: string;
      view?: string;
      url?: string;
    }[];
  } | null;
  anchor: {
    status?: string;
    txHash?: string | null;
    recordHash?: string | null;
  } | null;
  createdAt: string;
};
type VehicleSummary = {
  id: string;
  regNumber: string;
  make: string;
  model: string;
  year: number;
  status: string;
};
type DamageEventLite = {
  id: string;
  eventType: string;
  eventDate: string;
  description: string;
  verificationStatus: string;
};

const SEVERITIES = [
  "no-visible-damage",
  "minor",
  "moderate",
  "severe",
  "requires-inspection",
  "inconclusive",
];
const ACTIONS = [
  "repair",
  "replace",
  "inspect-physically",
  "specialist-assessment",
  "no-action",
];
const COMPONENTS = Object.keys(DAMAGE_COMPONENT_LABELS).concat(["other"]);
const VIEWS = [
  "front",
  "rear",
  "left",
  "right",
  "close-up",
  "interior",
  "other",
];

const STATUS_TONE: Record<string, string> = {
  draft: "secondary",
  assessed: "info",
  submitted: "info",
  "under-review": "warning",
  approved: "success",
  "repair-completed": "primary",
  verified: "success",
  rejected: "danger",
  closed: "dark",
};

// Badge tone per severity, reused by photo annotations and the findings table.
const SEVERITY_TONE: Record<string, string> = {
  "no-visible-damage": "success",
  minor: "warning",
  moderate: "warning",
  severe: "danger",
  "requires-inspection": "info",
  inconclusive: "secondary",
};

// Which findings genuinely relate to one photograph: those the assessor linked to
// that frame, plus any computer-vision detection (its source frame is the photo set
// as a whole, so it is shown on every frame and labelled as such). No invented
// bounding boxes - a CV engine that starts returning regions will surface here.
const photoAnnotations = (f: DamageFinding, index: number): boolean =>
  f.linkedPhotoIndex === index ||
  (f.source === "computer-vision" && f.detectionState !== "not-assessed");

const apiMsg = (err: unknown, fallback: string) =>
  (err as { response?: { data?: { message?: string } } })?.response?.data
    ?.message || fallback;

export default function DamageIntelligence() {
  const { user } = useAuth();
  const role = user?.role || "";
  const canAssess = ["workshop", "rto", "admin"].includes(role);
  const canReview = ["rto", "admin"].includes(role);

  const [reg, setReg] = useState("");
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [damageEvents, setDamageEvents] = useState<DamageEventLite[]>([]);
  const [existingAssessments, setExistingAssessments] = useState<
    { id: string; assessmentRef: string; status: string; createdAt: string }[]
  >([]);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(false);

  // New-assessment form
  const [linkChoice, setLinkChoice] = useState<string>(""); // "" = none, "new", or event id
  const [incidentNotes, setIncidentNotes] = useState("");
  const [suspectedArea, setSuspectedArea] = useState("");

  const loadAssessment = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const res = await api.get(`/damage/assessments/${id}`);
      setAssessment((res.data as { assessment: Assessment }).assessment);
    } catch (err: unknown) {
      notify(apiMsg(err, "Could not load the assessment."), "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reg.trim()) {
      notify("Enter a registration number.", "info");
      return;
    }
    setLoading(true);
    try {
      const res = await api.get("/damage/vehicle-lookup", {
        params: { reg: reg.trim() },
      });
      const data = res.data as {
        vehicle: VehicleSummary;
        damageEvents: DamageEventLite[];
        existingAssessments: {
          id: string;
          assessmentRef: string;
          status: string;
          createdAt: string;
        }[];
      };
      setVehicle(data.vehicle);
      setDamageEvents(data.damageEvents || []);
      setExistingAssessments(data.existingAssessments || []);
      setAssessment(null);
      setLinkChoice(data.damageEvents?.[0]?.id || "");
    } catch (err: unknown) {
      setVehicle(null);
      notify(apiMsg(err, "No matching vehicle you can assess."), "error");
    } finally {
      setLoading(false);
    }
  };

  const startOrOpen = async () => {
    if (!vehicle) return;
    setLoading(true);
    try {
      const body: Record<string, unknown> = {
        vehicleId: vehicle.id,
        incidentNotes,
        suspectedArea,
      };
      if (linkChoice === "new") body.startNewAccident = true;
      else if (linkChoice) body.linkedDamageEventId = linkChoice;
      const res = await api.post("/damage/assessments", body);
      const a = (res.data as { assessment: Assessment }).assessment;
      setAssessment(a);
      notify(res.data.message || "Assessment opened.", "success");
      // refresh the accident/assessment lists so a newly created accident shows up
      const lr = await api.get("/damage/vehicle-lookup", {
        params: { reg: vehicle.regNumber },
      });
      const ld = lr.data as {
        damageEvents: DamageEventLite[];
        existingAssessments: typeof existingAssessments;
      };
      setDamageEvents(ld.damageEvents || []);
      setExistingAssessments(ld.existingAssessments || []);
    } catch (err: unknown) {
      notify(apiMsg(err, "Could not open an assessment."), "error");
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    if (assessment) await loadAssessment(assessment.id);
  };

  return (
    <DashboardLayout
      title="3D Vehicle Damage & Repair Intelligence"
      subtitle="One accident, a photo-driven assessment, an honest estimate and a verification trail - never a fabricated result."
    >
      <div className="container" style={{ marginTop: 10, marginBottom: 40 }}>
        <form
          onSubmit={handleLookup}
          className="card"
          style={{ padding: 20, marginBottom: 18 }}
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
                {loading ? "Searching…" : "Find vehicle"}
              </button>
            </div>
          </div>
        </form>

        {vehicle && !assessment && (
          <VehiclePicker
            vehicle={vehicle}
            damageEvents={damageEvents}
            existingAssessments={existingAssessments}
            linkChoice={linkChoice}
            setLinkChoice={setLinkChoice}
            incidentNotes={incidentNotes}
            setIncidentNotes={setIncidentNotes}
            suspectedArea={suspectedArea}
            setSuspectedArea={setSuspectedArea}
            canAssess={canAssess || role === "owner"}
            onOpen={loadAssessment}
            onStart={startOrOpen}
            loading={loading}
          />
        )}

        {assessment && (
          <AssessmentWorkspace
            assessment={assessment}
            role={role}
            canAssess={canAssess}
            canReview={canReview}
            onRefresh={refresh}
            onClose={() => setAssessment(null)}
            loading={loading}
          />
        )}

        {!vehicle && !loading && (
          <div className="alert alert-secondary">
            Find a vehicle to open its damage assessment. If an accident is
            already on record, the assessment links to that single accident
            rather than making a second one.
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}

// ---------------------------------------------------------------------------
// Vehicle picker: link an existing accident, or start the single accident record.
// ---------------------------------------------------------------------------
function VehiclePicker(props: {
  vehicle: VehicleSummary;
  damageEvents: DamageEventLite[];
  existingAssessments: {
    id: string;
    assessmentRef: string;
    status: string;
    createdAt: string;
  }[];
  linkChoice: string;
  setLinkChoice: (v: string) => void;
  incidentNotes: string;
  setIncidentNotes: (v: string) => void;
  suspectedArea: string;
  setSuspectedArea: (v: string) => void;
  canAssess: boolean;
  onOpen: (id: string) => void;
  onStart: () => void;
  loading: boolean;
}) {
  const { vehicle, damageEvents, existingAssessments } = props;
  return (
    <div className="card" style={{ padding: 18, marginBottom: 18 }}>
      <h5 style={{ color: "#1e5aa8", margin: 0 }}>
        {vehicle.regNumber} — {vehicle.make} {vehicle.model} ({vehicle.year})
      </h5>
      <div style={{ fontSize: "0.88rem", color: "#666", marginTop: 4 }}>
        Status: {enumLabel(vehicle.status)}
      </div>

      {existingAssessments.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <strong>Existing assessments</strong>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 6 }}
          >
            {existingAssessments.map((a) => (
              <button
                key={a.id}
                className="btn btn-sm btn-outline-primary"
                onClick={() => props.onOpen(a.id)}
              >
                {a.assessmentRef} · {enumLabel(a.status)}
              </button>
            ))}
          </div>
          <div style={{ fontSize: "0.82rem", color: "#777", marginTop: 4 }}>
            Open one of these to continue it. Starting a new assessment here
            does not create a second accident for the same incident.
          </div>
        </div>
      )}

      <div style={{ marginTop: 14 }}>
        <strong>Accident this assessment covers</strong>
        {damageEvents.length === 0 && (
          <div style={{ fontSize: "0.85rem", color: "#777", marginTop: 2 }}>
            No accident is on record for this vehicle yet.
          </div>
        )}
        <div style={{ marginTop: 6 }}>
          {damageEvents.map((d) => (
            <label key={d.id} className="d-block" style={{ marginBottom: 4 }}>
              <input
                type="radio"
                name="link"
                value={d.id}
                checked={props.linkChoice === d.id}
                onChange={() => props.setLinkChoice(d.id)}
              />{" "}
              {formatDateTime(d.eventDate)} — {d.description?.slice(0, 80)}{" "}
              <span className="badge bg-light text-dark border">
                {enumLabel(d.verificationStatus)}
              </span>
            </label>
          ))}
          <label className="d-block" style={{ marginBottom: 4 }}>
            <input
              type="radio"
              name="link"
              value="new"
              checked={props.linkChoice === "new"}
              onChange={() => props.setLinkChoice("new")}
            />{" "}
            Start a new accident record for this incident
          </label>
        </div>
      </div>

      <div className="row g-2" style={{ marginTop: 8 }}>
        <div className="col-md-8">
          <label style={{ fontWeight: 600 }}>Incident notes</label>
          <textarea
            className="form-control"
            rows={2}
            value={props.incidentNotes}
            onChange={(e) => props.setIncidentNotes(e.target.value)}
            placeholder="What happened, as the owner/workshop describes it."
          />
        </div>
        <div className="col-md-4">
          <label style={{ fontWeight: 600 }}>Suspected area</label>
          <input
            className="form-control"
            value={props.suspectedArea}
            onChange={(e) => props.setSuspectedArea(e.target.value)}
            placeholder="e.g. front-left"
          />
        </div>
      </div>

      {props.canAssess ? (
        <button
          className="btn btn-primary"
          style={{ marginTop: 12 }}
          onClick={props.onStart}
          disabled={props.loading}
        >
          {props.loading ? "Opening…" : "Open damage assessment"}
        </button>
      ) : (
        <div
          className="alert alert-secondary"
          style={{ marginTop: 12, padding: "6px 10px", fontSize: "0.86rem" }}
        >
          An authorised workshop or officer opens and records the assessment. As{" "}
          {enumLabel(roleOf()) || "you"} you can view assessments that already
          exist.
        </div>
      )}
    </div>
  );
}

// Helper only used by the picker note above; keeps role text generic.
function roleOf(): string {
  try {
    const raw = localStorage.getItem("user");
    return raw ? JSON.parse(raw)?.role || "" : "";
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Assessment workspace: photos -> analysis -> 3D findings -> estimate ->
// review -> completion -> final inspection -> integrity. Each step states its
// own honesty boundary.
// ---------------------------------------------------------------------------
function AssessmentWorkspace(props: {
  assessment: Assessment;
  role: string;
  canAssess: boolean;
  canReview: boolean;
  onRefresh: () => void;
  onClose: () => void;
  loading: boolean;
}) {
  const { assessment: a, canAssess, canReview, onRefresh } = props;
  const [busy, setBusy] = useState(false);
  const [viewState, setViewState] = useState<"assessed" | "repaired">(
    "assessed",
  );
  const [selected, setSelected] = useState<string | null>(null);
  const [integrity, setIntegrity] = useState<Record<string, unknown> | null>(
    null,
  );

  const post = useCallback(
    async (path: string, body?: unknown, opts?: { formData?: FormData }) => {
      setBusy(true);
      try {
        const res = opts?.formData
          ? await api.post(path, opts.formData, {
              headers: { "Content-Type": "multipart/form-data" },
            })
          : await api.post(path, body || {});
        notify(res.data.message || "Updated.", "success");
        onRefresh();
        return res.data;
      } catch (err: unknown) {
        notify(apiMsg(err, "That step could not be completed."), "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [onRefresh],
  );

  const runAnalyze = async () => {
    const data = await post(`/damage/assessments/${a.id}/analyze`);
    if (data?.analysis?.mode === "manual")
      notify(
        "No computer-vision engine is configured, so findings must be recorded manually.",
        "info",
      );
  };

  const verifyIntegrity = async () => {
    setBusy(true);
    try {
      const res = await api.get(`/damage/assessments/${a.id}/verify-integrity`);
      setIntegrity(res.data as Record<string, unknown>);
    } catch (err: unknown) {
      notify(apiMsg(err, "Integrity check failed."), "error");
    } finally {
      setBusy(false);
    }
  };

  const viewerFindings: ViewerFinding[] = a.findings.map((f) => ({
    component: f.component,
    label: f.label,
    severity: f.severity,
    recommendation: f.recommendation,
    detectionState: f.detectionState,
    mappedTo3D: f.mappedTo3D,
  }));
  const unmapped = a.findings.filter((f) => !f.mappedTo3D);

  return (
    <div className="card" style={{ padding: 18 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <div>
          <h5 style={{ margin: 0, color: "#1e5aa8" }}>
            {a.assessmentRef} · {a.regNumber}
          </h5>
          <div style={{ marginTop: 4 }}>
            <span
              className={`badge bg-${STATUS_TONE[a.status] || "secondary"}`}
            >
              {enumLabel(a.status)}
            </span>
            <span style={{ fontSize: "0.82rem", color: "#777", marginLeft: 8 }}>
              {a.linkedDamageEvent
                ? "Linked to the existing accident record."
                : "No accident linked yet."}
            </span>
          </div>
        </div>
        <button
          className="btn btn-sm btn-outline-secondary"
          onClick={props.onClose}
        >
          Close
        </button>
      </div>

      {/* Analysis --------------------------------------------------------- */}
      <Section title="1 · Analysis (pluggable, honest)">
        <div style={{ fontSize: "0.9rem", marginBottom: 8 }}>
          <strong>Mode:</strong> {enumLabel(a.analysis.mode)} —{" "}
          {a.analysis.note}
          {a.analysis.engineName ? ` (${a.analysis.engineName})` : ""}
        </div>
        {a.analysis.limitation && (
          <div
            className="alert alert-secondary"
            style={{ fontSize: "0.82rem", padding: "6px 10px" }}
          >
            {a.analysis.limitation}
          </div>
        )}
        {canAssess && (
          <button
            className="btn btn-sm btn-outline-primary"
            onClick={runAnalyze}
            disabled={busy}
          >
            {busy ? "Running…" : "Run analysis"}
          </button>
        )}
      </Section>

      {/* Photos ----------------------------------------------------------- */}
      <Section title="2 · Damage photographs & detection annotations">
        <PhotoStrip
          assessment={a}
          canAssess={canAssess || props.role === "owner"}
          post={post}
          busy={busy}
          onSelectComponent={setSelected}
        />
      </Section>

      {/* 3D findings ----------------------------------------------------- */}
      <Section title="3 · Interactive 3D assessment">
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <button
            className={`btn btn-sm ${viewState === "assessed" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setViewState("assessed")}
          >
            Assessed condition
          </button>
          <button
            className={`btn btn-sm ${viewState === "repaired" ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setViewState("repaired")}
          >
            Repaired preview
          </button>
        </div>
        <VehicleDamageViewer
          findings={viewerFindings}
          selectedComponent={selected}
          onSelectComponent={setSelected}
          viewState={viewState}
        />
        {unmapped.length > 0 && (
          <div
            className="alert alert-warning"
            style={{ marginTop: 10, fontSize: "0.85rem" }}
          >
            Not mapped to the 3D model:{" "}
            {unmapped.map((f) => f.label).join(", ")}. The model does not
            pretend these are shown — they are recorded as findings only.
          </div>
        )}
        <FindingEditor
          key={`${selected}:${a.findings.find((f) => f.component === selected)?.id || "new"}`}
          assessment={a}
          selected={selected}
          canAssess={canAssess}
          post={post}
          busy={busy}
        />
      </Section>

      {/* Findings list --------------------------------------------------- */}
      <Section title="4 · Recorded component findings">
        <FindingsList findings={a.findings} />
      </Section>

      {/* Estimate -------------------------------------------------------- */}
      <Section title="5 · Repair estimate (catalogue-priced only)">
        <EstimatePanel
          assessment={a}
          canAssess={canAssess}
          post={post}
          busy={busy}
        />
      </Section>

      {/* Review ---------------------------------------------------------- */}
      <Section title="6 · Authorised review">
        <ReviewPanel
          assessment={a}
          canReview={canReview}
          post={post}
          busy={busy}
        />
      </Section>

      {/* Completion ------------------------------------------------------ */}
      <Section title="7 · Repair completion evidence">
        <CompletionPanel
          assessment={a}
          canAssess={canAssess}
          post={post}
          busy={busy}
        />
      </Section>

      {/* Before / after -------------------------------------------------- */}
      <Section title="8 · Before / after comparison">
        <BeforeAfterPanel assessment={a} />
      </Section>

      {/* Final inspection ------------------------------------------------ */}
      <Section title="9 · Final inspection & verification">
        <FinalInspectionPanel
          assessment={a}
          canReview={canReview}
          post={post}
          busy={busy}
        />
      </Section>

      {/* Decisions + integrity ------------------------------------------ */}
      <Section title="Decision trail & integrity">
        {a.decisions.length > 0 && (
          <ul style={{ fontSize: "0.85rem", paddingLeft: 18 }}>
            {a.decisions.map((d, i) => (
              <li key={i}>
                <strong>{enumLabel(d.stage)}</strong> — {enumLabel(d.decision)}
                {d.reason ? `: ${d.reason}` : ""}
                {d.byName
                  ? ` (${d.byName}${d.byRole ? `, ${d.byRole}` : ""})`
                  : ""}
              </li>
            ))}
          </ul>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 8,
          }}
        >
          <button
            className="btn btn-sm btn-outline-dark"
            onClick={verifyIntegrity}
            disabled={busy}
          >
            Verify integrity
          </button>
          <ViewTransactionButton
            txHash={a.anchor?.txHash}
            status={a.anchor?.status}
            label="View transaction"
            className="btn btn-sm btn-outline-success"
          />
        </div>
        {a.anchor?.recordHash && (
          <div
            style={{
              fontSize: "0.78rem",
              color: "#888",
              wordBreak: "break-all",
              marginTop: 4,
            }}
          >
            Record hash: {a.anchor.recordHash}
          </div>
        )}
        {integrity && <IntegrityResult data={integrity} />}
        <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 8 }}>
          A matching hash proves the recorded assessment has not changed since
          it was hashed. It does not prove the assessment was truthful or that
          the vehicle is roadworthy.
        </div>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{ borderTop: "1px solid #eef1f5", paddingTop: 12, marginTop: 12 }}
    >
      <h6 style={{ color: "#2c3e50" }}>{title}</h6>
      {children}
    </div>
  );
}

// --- Photo upload + thumbnails with detection annotations ------------------
function PhotoStrip(props: {
  assessment: Assessment;
  canAssess: boolean;
  post: (
    p: string,
    b?: unknown,
    o?: { formData?: FormData },
  ) => Promise<unknown>;
  busy: boolean;
  onSelectComponent: (component: string) => void;
}) {
  const { assessment: a } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [view, setView] = useState("front");

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      notify("Choose one or more photographs first.", "info");
      return;
    }
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append("photos", files[i]);
    fd.append("view", view);
    await props.post(`/damage/assessments/${a.id}/photos`, undefined, {
      formData: fd,
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      {a.photos.length > 0 ? (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            marginBottom: 10,
          }}
        >
          {a.photos.map((p) => (
            <PhotoThumb
              key={p.index}
              assessmentId={a.id}
              index={p.index}
              url={p.url}
              label={`${enumLabel(p.view)} · ${p.fileName}`}
              annotations={a.findings.filter((f) =>
                photoAnnotations(f, p.index),
              )}
              onSelectComponent={props.onSelectComponent}
            />
          ))}
        </div>
      ) : (
        <div style={{ fontSize: "0.85rem", color: "#777", marginBottom: 8 }}>
          No photographs attached yet.
        </div>
      )}
      {props.canAssess && (
        <form
          onSubmit={upload}
          className="d-flex flex-wrap align-items-end"
          style={{ gap: 8 }}
        >
          <div>
            <label style={{ fontSize: "0.8rem", display: "block" }}>View</label>
            <select
              className="form-select form-select-sm"
              value={view}
              onChange={(e) => setView(e.target.value)}
            >
              {VIEWS.map((v) => (
                <option key={v} value={v}>
                  {enumLabel(v)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "0.8rem", display: "block" }}>
              Photos (JPEG/PNG/WebP, max 6)
            </label>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="form-control form-control-sm"
            />
          </div>
          <button
            className="btn btn-sm btn-primary"
            type="submit"
            disabled={props.busy}
          >
            Upload
          </button>
        </form>
      )}
    </div>
  );
}

function PhotoThumb({
  assessmentId,
  index,
  url,
  label,
  annotations = [],
  onSelectComponent,
}: {
  assessmentId: string;
  index: number;
  url: string;
  label: string;
  annotations?: DamageFinding[];
  onSelectComponent?: (component: string) => void;
}) {
  const [src, setSrc] = useState<string>("");
  useEffect(() => {
    let revoked = "";
    let active = true;
    api
      .get(url, { responseType: "blob" })
      .then((r) => {
        if (!active) return;
        revoked = URL.createObjectURL(r.data as Blob);
        setSrc(revoked);
      })
      .catch(() => setSrc(""));
    return () => {
      active = false;
      if (revoked) URL.revokeObjectURL(revoked);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assessmentId, index]);
  return (
    <figure style={{ margin: 0, width: 150, textAlign: "center" }}>
      <div style={{ position: "relative", width: 150, height: 110 }}>
        {src ? (
          <img
            src={src}
            alt={label}
            style={{
              width: 150,
              height: 110,
              objectFit: "cover",
              borderRadius: 6,
              border: "1px solid #cbd5e1",
            }}
          />
        ) : (
          <div
            style={{
              width: 150,
              height: 110,
              borderRadius: 6,
              background: "#eef1f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "0.72rem",
              color: "#888",
            }}
          >
            loading…
          </div>
        )}
        {/* Detection annotations genuinely tied to this frame. No fabricated
            bounding boxes - the engine never returned regions. */}
        {annotations.length > 0 && (
          <div
            style={{
              position: "absolute",
              top: 4,
              left: 4,
              right: 4,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              alignItems: "flex-start",
            }}
          >
            {annotations.slice(0, 3).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => onSelectComponent?.(f.component)}
                title={`${enumLabel(f.detectionState)} · ${enumLabel(f.source)}${f.source === "computer-vision" ? " (whole photo set)" : ""}. Click to inspect on the 3D model.`}
                style={{
                  fontSize: "0.66rem",
                  lineHeight: "1.1",
                  padding: "2px 5px",
                  borderRadius: 4,
                  border: "none",
                  background: "rgba(255,255,255,0.92)",
                  borderLeft: `3px solid ${
                    f.severity === "severe" ? "#c53030" : "#b7791f"
                  }`,
                  cursor: onSelectComponent ? "pointer" : "default",
                  textAlign: "left",
                  color: "#2c3e50",
                }}
              >
                {DAMAGE_COMPONENT_LABELS[f.component] || enumLabel(f.component)}
                {f.confidence != null
                  ? ` · ${Math.round(f.confidence * 100)}%`
                  : ""}
              </button>
            ))}
            {annotations.length > 3 && (
              <span style={{ fontSize: "0.64rem", color: "#fff" }}>
                +{annotations.length - 3} more
              </span>
            )}
          </div>
        )}
      </div>
      <figcaption
        style={{
          fontSize: "0.72rem",
          color: "#666",
          marginTop: 2,
          wordBreak: "break-word",
        }}
      >
        {label}
        {annotations.length === 0 && src && (
          <div style={{ fontSize: "0.64rem", color: "#a0aec0" }}>
            no finding linked to this frame
          </div>
        )}
      </figcaption>
    </figure>
  );
}

// --- Finding editor -------------------------------------------------------
function FindingEditor(props: {
  assessment: Assessment;
  selected: string | null;
  canAssess: boolean;
  post: (
    p: string,
    b?: unknown,
    o?: { formData?: FormData },
  ) => Promise<unknown>;
  busy: boolean;
}) {
  const { assessment: a, canAssess } = props;
  const existing = props.selected
    ? a.findings.find((f) => f.component === props.selected)
    : undefined;
  const [component, setComponent] = useState(props.selected || "front-bumper");
  const [severity, setSeverity] = useState(
    existing?.severity || "requires-inspection",
  );
  const [recommendation, setRecommendation] = useState(
    existing?.recommendation || "inspect-physically",
  );
  const [detectionState, setDetectionState] = useState(
    existing?.detectionState || "needs-review",
  );
  const [notes, setNotes] = useState(existing?.inspectorNotes || "");
  const [photoLink, setPhotoLink] = useState(
    existing?.linkedPhotoIndex != null ? String(existing.linkedPhotoIndex) : "",
  );

  if (!canAssess) return null;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await props.post(`/damage/assessments/${a.id}/findings`, {
      component,
      severity,
      recommendation,
      detectionState,
      inspectorNotes: notes,
      linkedPhotoIndex:
        photoLink === "" ? null : Number.parseInt(photoLink, 10),
      correct: !!existing,
      findingId: existing?.id,
    });
  };

  return (
    <form
      onSubmit={save}
      className="row g-2"
      style={{
        marginTop: 12,
        background: "#f7fafc",
        padding: 12,
        borderRadius: 8,
      }}
    >
      <div className="col-md-6">
        <label style={{ fontSize: "0.8rem" }}>
          Component{" "}
          {props.selected
            ? `(selected: ${DAMAGE_COMPONENT_LABELS[props.selected] || props.selected})`
            : ""}
        </label>
        <select
          className="form-select form-select-sm"
          value={component}
          onChange={(e) => setComponent(e.target.value)}
          disabled={!!props.selected}
        >
          {COMPONENTS.map((c) => (
            <option key={c} value={c}>
              {DAMAGE_COMPONENT_LABELS[c] || enumLabel(c)}
            </option>
          ))}
        </select>
      </div>
      <div className="col-md-3">
        <label style={{ fontSize: "0.8rem" }}>Condition</label>
        <select
          className="form-select form-select-sm"
          value={severity}
          onChange={(e) => setSeverity(e.target.value)}
        >
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {enumLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="col-md-3">
        <label style={{ fontSize: "0.8rem" }}>Recommendation</label>
        <select
          className="form-select form-select-sm"
          value={recommendation}
          onChange={(e) => setRecommendation(e.target.value)}
        >
          {ACTIONS.map((s) => (
            <option key={s} value={s}>
              {enumLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="col-md-3">
        <label style={{ fontSize: "0.8rem" }}>Detection state</label>
        <select
          className="form-select form-select-sm"
          value={detectionState}
          onChange={(e) => setDetectionState(e.target.value)}
        >
          {["detected", "needs-review", "not-assessed"].map((s) => (
            <option key={s} value={s}>
              {enumLabel(s)}
            </option>
          ))}
        </select>
      </div>
      <div className="col-md-3">
        <label style={{ fontSize: "0.8rem" }}>Linked photo</label>
        <select
          className="form-select form-select-sm"
          value={photoLink}
          onChange={(e) => setPhotoLink(e.target.value)}
          disabled={a.photos.length === 0}
        >
          <option value="">
            {a.photos.length === 0 ? "no photos yet" : "not linked"}
          </option>
          {a.photos.map((p) => (
            <option key={p.index} value={String(p.index)}>
              #{p.index + 1} {enumLabel(p.view)}
            </option>
          ))}
        </select>
      </div>
      <div className="col-md-9">
        <label style={{ fontSize: "0.8rem" }}>Inspector notes</label>
        <input
          className="form-control form-control-sm"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What the inspector observed in the photographs."
        />
      </div>
      <div className="col-12">
        <button
          className="btn btn-sm btn-primary"
          type="submit"
          disabled={props.busy}
        >
          {existing ? "Correct finding" : "Record finding"}
        </button>
        {existing && (
          <span style={{ fontSize: "0.78rem", color: "#777", marginLeft: 8 }}>
            A correction keeps the original value in the finding's history.
          </span>
        )}
      </div>
    </form>
  );
}

function FindingsList({ findings }: { findings: DamageFinding[] }) {
  if (findings.length === 0)
    return (
      <div style={{ fontSize: "0.85rem", color: "#777" }}>
        No findings recorded yet.
      </div>
    );
  return (
    <table className="table table-sm">
      <thead>
        <tr>
          <th>Component</th>
          <th>Condition</th>
          <th>Action</th>
          <th>Source</th>
          <th>Confidence</th>
          <th>Photo</th>
          <th>3D</th>
        </tr>
      </thead>
      <tbody>
        {findings.map((f) => (
          <tr key={f.id}>
            <td>
              {DAMAGE_COMPONENT_LABELS[f.component] || enumLabel(f.component)}
            </td>
            <td>
              <span
                className={`badge bg-${SEVERITY_TONE[f.severity] || "secondary"}`}
                style={{ textTransform: "none" }}
              >
                {enumLabel(f.severity)}
              </span>
            </td>
            <td>{enumLabel(f.recommendation)}</td>
            <td>
              {enumLabel(f.source)}
              {f.corrections && f.corrections.length > 0 && (
                <span
                  style={{
                    fontSize: "0.72rem",
                    color: "#b7791f",
                    marginLeft: 6,
                  }}
                >
                  ({f.corrections.length} correction
                  {f.corrections.length > 1 ? "s" : ""})
                </span>
              )}
            </td>
            <td>
              {f.confidence != null
                ? `${Math.round(f.confidence * 100)}%`
                : "—"}
            </td>
            <td>
              {f.linkedPhotoIndex != null
                ? `#${f.linkedPhotoIndex + 1}`
                : f.source === "computer-vision"
                  ? "photo set"
                  : "—"}
            </td>
            <td>{f.mappedTo3D ? "mapped" : "not mapped"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// --- Estimate -------------------------------------------------------------
function EstimatePanel(props: {
  assessment: Assessment;
  canAssess: boolean;
  post: (
    p: string,
    b?: unknown,
    o?: { formData?: FormData },
  ) => Promise<unknown>;
  busy: boolean;
}) {
  const { assessment: a, canAssess } = props;
  const est = a.estimate;
  return (
    <div>
      {canAssess && (
        <button
          className="btn btn-sm btn-primary"
          disabled={props.busy || a.findings.length === 0}
          onClick={() => props.post(`/damage/assessments/${a.id}/estimate`)}
        >
          {est ? "Regenerate estimate" : "Generate estimate"}
        </button>
      )}
      {a.findings.length === 0 && (
        <div style={{ fontSize: "0.82rem", color: "#777", marginTop: 6 }}>
          Record at least one finding first.
        </div>
      )}
      {est && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: "0.85rem", color: "#555" }}>
            Estimate v{est.version} · status {enumLabel(est.status)}
          </div>
          <table className="table table-sm" style={{ marginTop: 6 }}>
            <thead>
              <tr>
                <th>Component</th>
                <th>Action</th>
                <th>Parts</th>
                <th>Labour</th>
                <th>Total</th>
                <th>Basis</th>
              </tr>
            </thead>
            <tbody>
              {est.items.map((it, i) => (
                <tr key={i}>
                  <td>
                    {DAMAGE_COMPONENT_LABELS[it.component] ||
                      enumLabel(it.component)}
                  </td>
                  <td>{enumLabel(it.proposedAction)}</td>
                  <td>₹{formatMoney(it.partsCost)}</td>
                  <td>₹{formatMoney(it.labourCost)}</td>
                  <td>₹{formatMoney(it.total)}</td>
                  <td>
                    {it.priceBasis === "none" ? (
                      <span style={{ color: "#b91c1c" }}>
                        no catalogue price
                      </span>
                    ) : (
                      enumLabel(it.priceBasis)
                    )}
                  </td>
                </tr>
              ))}
              {est.items.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: "#777" }}>
                    No repair/replace findings to price.
                  </td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>Grand total</th>
                <th>₹{formatMoney(est.grandTotal)}</th>
                <th />
              </tr>
            </tfoot>
          </table>
          <div style={{ fontSize: "0.8rem", color: "#888" }}>{est.note}</div>
        </div>
      )}
    </div>
  );
}

function ReviewPanel(props: {
  assessment: Assessment;
  canReview: boolean;
  post: (
    p: string,
    b?: unknown,
    o?: { formData?: FormData },
  ) => Promise<unknown>;
  busy: boolean;
}) {
  const { assessment: a, canReview } = props;
  const [reason, setReason] = useState("");
  if (!canReview) return <ReviewNote a={a} />;
  if (!a.estimate)
    return (
      <div style={{ fontSize: "0.85rem", color: "#777" }}>
        An estimate must be generated before review.
      </div>
    );
  const decide = (decision: string) =>
    props.post(`/damage/assessments/${a.id}/review`, { decision, reason });
  return (
    <div>
      <input
        className="form-control form-control-sm mb-2"
        placeholder="Reason (optional)"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ maxWidth: 420 }}
      />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="btn btn-sm btn-success"
          disabled={props.busy}
          onClick={() => decide("approve")}
        >
          Approve estimate
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={props.busy}
          onClick={() => decide("reject")}
        >
          Reject
        </button>
        <button
          className="btn btn-sm btn-outline-warning"
          disabled={props.busy}
          onClick={() => decide("request-evidence")}
        >
          Request more evidence
        </button>
      </div>
      <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 6 }}>
        Approving an estimate authorises the work; it does not mean the repair
        is complete or verified.
      </div>
    </div>
  );
}

function ReviewNote({ a }: { a: Assessment }) {
  const approved = ["approved", "repair-completed", "verified"].includes(
    a.status,
  );
  return (
    <div style={{ fontSize: "0.85rem", color: "#555" }}>
      {a.estimate
        ? `Estimate v${a.estimate.version} is ${enumLabel(a.estimate.status)}. ${approved ? "Approved for the workshop to proceed." : "Awaiting an authorised reviewer."}`
        : "No estimate has been submitted yet."}
    </div>
  );
}

// --- Before / after comparison --------------------------------------------
// Side-by-side of the original damage photographs and the workshop's completion
// evidence. Honest framing: the after set is workshop-submitted, and the pair is
// only called a verified comparison once a passed final inspection exists.
function BeforeAfterPanel({ assessment: a }: { assessment: Assessment }) {
  const evidence = a.repairCompletion?.evidence || [];
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))",
          gap: 14,
        }}
      >
        <div>
          <h6
            style={{ fontSize: "0.85rem", color: "#b91c1c", marginBottom: 6 }}
          >
            Before · damage photographs ({a.photos.length})
          </h6>
          {a.photos.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {a.photos.map((p) => (
                <PhotoThumb
                  key={p.index}
                  assessmentId={a.id}
                  index={p.index}
                  url={p.url}
                  label={`before · ${enumLabel(p.view)}`}
                />
              ))}
            </div>
          ) : (
            <div style={{ fontSize: "0.82rem", color: "#777" }}>
              No damage photographs attached.
            </div>
          )}
        </div>
        <div>
          <h6
            style={{ fontSize: "0.85rem", color: "#2f855a", marginBottom: 6 }}
          >
            After · completion evidence ({evidence.length})
          </h6>
          {evidence.length > 0 ? (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {evidence.map((e) =>
                e.url ? (
                  <PhotoThumb
                    key={e.index}
                    assessmentId={a.id}
                    index={e.index}
                    url={e.url}
                    label={`after · ${e.view ? enumLabel(e.view) : e.fileName}`}
                  />
                ) : null,
              )}
            </div>
          ) : (
            <div style={{ fontSize: "0.82rem", color: "#777" }}>
              No completion evidence recorded yet — the workshop uploads it at
              step 7.
            </div>
          )}
        </div>
      </div>
      {evidence.length > 0 && (
        <div style={{ fontSize: "0.78rem", color: "#888", marginTop: 8 }}>
          {a.repairCompletion?.verified
            ? "Comparison supported by a passed final inspection."
            : "After photographs are workshop-submitted and not yet independently verified by a passed final inspection."}
        </div>
      )}
    </div>
  );
}

function CompletionPanel(props: {
  assessment: Assessment;
  canAssess: boolean;
  post: (
    p: string,
    b?: unknown,
    o?: { formData?: FormData },
  ) => Promise<unknown>;
  busy: boolean;
}) {
  const { assessment: a, canAssess } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    workshop: "",
    technician: "",
    workSummary: "",
  });
  const approved = a.status === "approved";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      notify("Attach at least one completion photograph.", "info");
      return;
    }
    const fd = new FormData();
    for (let i = 0; i < files.length; i++) fd.append("evidence", files[i]);
    fd.append("workshop", form.workshop);
    fd.append("technician", form.technician);
    fd.append("workSummary", form.workSummary);
    await props.post(
      `/damage/assessments/${a.id}/repair-completion`,
      undefined,
      { formData: fd },
    );
  };

  if (a.repairCompletion) {
    return (
      <div style={{ fontSize: "0.86rem" }}>
        Completed by {a.repairCompletion.workshop || "workshop"}
        {a.repairCompletion.technician
          ? ` · tech ${a.repairCompletion.technician}`
          : ""}{" "}
        · {a.repairCompletion.evidenceCount} evidence photo(s). Final
        inspection:{" "}
        <strong>{enumLabel(a.repairCompletion.finalInspection)}</strong>.{" "}
        {a.repairCompletion.verified ? "Verified." : "Not yet verified."}
        <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 4 }}>
          {a.repairCompletion.note}
        </div>
      </div>
    );
  }
  if (!canAssess)
    return (
      <div style={{ fontSize: "0.85rem", color: "#777" }}>
        The workshop records completion evidence.
      </div>
    );
  if (!approved)
    return (
      <div style={{ fontSize: "0.85rem", color: "#777" }}>
        Completion can be recorded once the estimate is approved.
      </div>
    );

  return (
    <form onSubmit={submit} className="row g-2">
      <div className="col-md-4">
        <input
          className="form-control form-control-sm"
          placeholder="Workshop"
          value={form.workshop}
          onChange={(e) => setForm({ ...form, workshop: e.target.value })}
        />
      </div>
      <div className="col-md-4">
        <input
          className="form-control form-control-sm"
          placeholder="Technician"
          value={form.technician}
          onChange={(e) => setForm({ ...form, technician: e.target.value })}
        />
      </div>
      <div className="col-md-4">
        <input
          className="form-control form-control-sm"
          type="file"
          accept="image/*"
          multiple
          ref={fileRef}
        />
      </div>
      <div className="col-12">
        <input
          className="form-control form-control-sm"
          placeholder="Work summary"
          value={form.workSummary}
          onChange={(e) => setForm({ ...form, workSummary: e.target.value })}
        />
      </div>
      <div className="col-12">
        <button
          className="btn btn-sm btn-primary"
          type="submit"
          disabled={props.busy}
        >
          Submit completion evidence
        </button>
      </div>
    </form>
  );
}

function FinalInspectionPanel(props: {
  assessment: Assessment;
  canReview: boolean;
  post: (
    p: string,
    b?: unknown,
    o?: { formData?: FormData },
  ) => Promise<unknown>;
  busy: boolean;
}) {
  const { assessment: a, canReview } = props;
  const [reason, setReason] = useState("");
  const rc = a.repairCompletion;
  if (rc?.verified) {
    return (
      <div className="alert alert-success" style={{ fontSize: "0.86rem" }}>
        The repair was verified after a passed final inspection with completion
        evidence, and reflected in the Damage &amp; Repair Passport.
      </div>
    );
  }
  if (!rc)
    return (
      <div style={{ fontSize: "0.85rem", color: "#777" }}>
        No completion evidence recorded yet.
      </div>
    );
  if (!canReview)
    return (
      <div style={{ fontSize: "0.85rem", color: "#777" }}>
        Final inspection: {enumLabel(rc.finalInspection)}.
      </div>
    );

  const inspect = (outcome: string) =>
    props.post(`/damage/assessments/${a.id}/final-inspection`, {
      outcome,
      reason,
    });
  return (
    <div>
      <input
        className="form-control form-control-sm mb-2"
        placeholder="Inspection remarks"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        style={{ maxWidth: 420 }}
      />
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn btn-sm btn-success"
          disabled={props.busy}
          onClick={() => inspect("passed")}
        >
          Inspection passed
        </button>
        <button
          className="btn btn-sm btn-danger"
          disabled={props.busy}
          onClick={() => inspect("failed")}
        >
          Inspection failed
        </button>
      </div>
      <div style={{ fontSize: "0.8rem", color: "#888", marginTop: 6 }}>
        Verification requires a passed inspection and attached completion
        evidence — a passed inspection alone with no evidence is not verified.
      </div>
    </div>
  );
}

function IntegrityResult({ data }: { data: Record<string, unknown> }) {
  const record = data.record as
    | { verified?: boolean; reason?: string; anchorStatus?: string }
    | undefined;
  const photos =
    (data.photos as {
      index: number;
      fileName: string;
      verified: boolean | null;
      note?: string;
    }[]) || [];
  return (
    <div style={{ marginTop: 10 }}>
      {record && (
        <div
          className={`alert ${record.verified ? "alert-success" : "alert-danger"}`}
          style={{ padding: "6px 10px", fontSize: "0.85rem" }}
        >
          Assessment record:{" "}
          {record.verified
            ? "matches its recorded hash."
            : record.reason || "does not match its recorded hash."}
        </div>
      )}
      {photos.map((p) => (
        <div
          key={p.index}
          className={`alert ${p.verified === false ? "alert-danger" : "alert-secondary"}`}
          style={{ padding: "4px 8px", fontSize: "0.8rem", marginBottom: 4 }}
        >
          {p.fileName}: {p.note}
        </div>
      ))}
      <div style={{ fontSize: "0.8rem", color: "#888" }}>
        {String(data.note)}
      </div>
    </div>
  );
}
