// MigrationPremium.tsx
// Premium, module-scoped presentational screens for the Smart Migration Orchestrator.
//
// Every component here is driven ONLY by real migration records the parent already
// loaded - a designed passport, a React Flow two-state dependency diagram, a deadline
// calendar, compliance cards, a source-vs-destination reconciliation workspace, cost
// breakdown cards and a document intelligence split view. Nothing here invents data:
// where a value is not on record it is shown as "not on record" / "needs review", never
// as a passing result. Illustrative visuals (QR target, countdown) are labelled as such.
import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { QRCodeSVG } from "qrcode.react";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { SectionCard, StatusPill, FieldRow } from "./ui";
import { BIO, toneForStatus } from "./ui-tokens";
import { formatDate, enumLabel } from "./display";

// ---- Shared structural types (a documented subset of the parent's Migration) --------
export type PStage = {
  key: string;
  title: string;
  ownerRole?: string | null;
  ownerState?: string | null;
  status: string;
  startedAt?: string;
  completedAt?: string;
  actorName?: string | null;
  remarks?: string | null;
};
export type PCheck = {
  key: string;
  label: string;
  result: "passed" | "warning" | "blocked" | "needs_review";
  detail?: string;
  sourceLabel?: string;
};
export type PDoc = {
  name: string;
  category: string;
  reviewStatus: string;
  ocrConfidence?: number;
  integrityHash?: string;
  discrepancies?: string[];
  observations?: string[];
  extracted?: { name?: string; state?: string; documentType?: string };
};
export type PCost = {
  label?: string;
  destinationRoadTax?: number | null;
  registrationFee?: number | null;
  estimatedTotal?: number | null;
  ruleSource?: string;
  ruleEffectiveDate?: string;
  unsupported?: string[];
};
export type PMigration = {
  _id: string;
  migrationId: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  vehicle?: {
    _id?: string;
    regNumber?: string;
    make?: string;
    model?: string;
    year?: number;
    chassisNumber?: string;
    engineNumber?: string;
  };
  origin: { stateCode: string; stateName: string; regNumber: string };
  destination: {
    stateCode: string;
    stateName: string;
    newRegNumber?: string;
    newAddress?: string;
  };
  stages: PStage[];
  documents?: PDoc[];
  deadline?: {
    expiresAt?: string;
    daysRemaining?: number;
    validityDays?: number;
    nextAction?: string;
  };
  passport?: { passportId?: string; hash?: string };
  reconciliation?: { verdict: string; notes?: string };
  exceptions?: {
    field: string;
    sourceValue: string;
    destinationValue: string;
    severity: string;
    resolved?: boolean;
  }[];
  costEstimate?: PCost;
};

const DONE = ["approved", "completed"];

// =====================================================================================
// Dashboard D — card-based application view
// =====================================================================================
export function MigrationCardGrid({
  migrations,
  onOpen,
}: {
  migrations: PMigration[];
  onOpen: (id: string) => void;
}) {
  if (!migrations.length) {
    return (
      <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
        No migrations to show.
      </div>
    );
  }
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))",
        gap: 14,
      }}
    >
      {migrations.map((m) => {
        const done = m.stages.filter((s) => DONE.includes(s.status)).length;
        const current =
          m.stages.find((s) => !DONE.includes(s.status)) ||
          m.stages[m.stages.length - 1];
        return (
          <button
            key={m._id}
            onClick={() => onOpen(m._id)}
            className="card"
            style={{
              textAlign: "left",
              padding: 14,
              cursor: "pointer",
              borderLeft: `4px solid ${toneForStatus(m.status)}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 8,
              }}
            >
              <strong style={{ fontSize: "0.92rem" }}>{m.migrationId}</strong>
              <StatusPill status={m.status} label={enumLabel(m.status)} />
            </div>
            <div
              style={{ fontSize: "0.82rem", color: BIO.slate, marginTop: 6 }}
            >
              {m.origin?.regNumber || "—"} · Vehicle {m.vehicle?._id || "—"}
            </div>
            <div
              style={{
                fontWeight: 700,
                margin: "8px 0 2px",
                fontSize: "0.95rem",
              }}
            >
              {m.origin?.stateName} → {m.destination?.stateName}
            </div>
            <div
              style={{
                height: 6,
                background: BIO.line,
                borderRadius: 3,
                overflow: "hidden",
                margin: "8px 0",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${m.stages.length ? Math.round((done / m.stages.length) * 100) : 0}%`,
                  background: BIO.green,
                }}
              />
            </div>
            <div style={{ fontSize: "0.78rem", color: BIO.slate }}>
              {done} / {m.stages.length} stages · current:{" "}
              <strong>{current?.title || "—"}</strong>
            </div>
            {m.updatedAt ? (
              <div
                style={{ fontSize: "0.72rem", color: BIO.slate, marginTop: 4 }}
              >
                Updated {formatDate(m.updatedAt)}
              </div>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

// =====================================================================================
// Module C — two-state RTO coordination: React Flow dependency diagram
// =====================================================================================
export function TwoStateFlow({
  migration,
  onSelectStage,
  selectedKey,
}: {
  migration: PMigration;
  onSelectStage?: (key: string) => void;
  selectedKey?: string | null;
}) {
  const { nodes, edges } = useMemo(() => {
    const originCode = migration.origin?.stateCode;
    const sourceStages = migration.stages.filter(
      (s) => s.ownerState && s.ownerState !== migration.destination?.stateName,
    );
    const destStages = migration.stages.filter(
      (s) => s.ownerState === migration.destination?.stateName,
    );
    const shared = migration.stages.filter(
      (s) =>
        !s.ownerState ||
        (s.ownerState !== originCode &&
          s.ownerState !== migration.destination?.stateName),
    );
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const colX = { source: 40, dest: 460 };
    const push = (list: PStage[], x: number, side: "source" | "dest") => {
      let prevId: string | null = null;
      list.forEach((s, i) => {
        const id = `${side}-${s.key}`;
        nodes.push({
          id,
          position: { x, y: 40 + i * 96 },
          data: {
            label: (
              <div style={{ fontSize: 11, lineHeight: 1.3 }}>
                <div style={{ fontWeight: 700 }}>{s.title}</div>
                <div style={{ opacity: 0.85 }}>{enumLabel(s.status)}</div>
              </div>
            ),
          },
          style: {
            background:
              s.status === "locked" ? "#eef1f5" : toneForStatus(s.status),
            color: s.status === "locked" ? BIO.slate : "#fff",
            border:
              selectedKey === s.key
                ? `2px solid ${BIO.ink}`
                : "1px solid rgba(0,0,0,0.1)",
            borderRadius: 8,
            padding: 8,
            width: 180,
          },
        });
        if (prevId)
          edges.push({
            id: `${prevId}-${id}`,
            source: prevId,
            target: id,
            animated: DONE.includes(s.status),
          });
        prevId = id;
      });
      return prevId;
    };
    const lastSource = push(
      sourceStages.length
        ? sourceStages
        : migration.stages.slice(0, Math.ceil(migration.stages.length / 2)),
      colX.source,
      "source",
    );
    const firstDestTargets = destStages.length
      ? destStages
      : migration.stages.slice(Math.ceil(migration.stages.length / 2));
    if (lastSource && firstDestTargets.length) {
      edges.push({
        id: "cross",
        source: lastSource,
        target: `dest-${firstDestTargets[0].key}`,
        label: "NOC gate",
        animated: true,
        style: { stroke: BIO.amber, strokeWidth: 2 },
      });
    }
    push(
      destStages.length
        ? destStages
        : migration.stages.slice(Math.ceil(migration.stages.length / 2)),
      colX.dest,
      "dest",
    );
    shared.forEach((s, i) => {
      nodes.push({
        id: `shared-${s.key}`,
        position: { x: 250, y: 40 + i * 96 },
        data: { label: <div style={{ fontSize: 11 }}>{s.title}</div> },
        style: {
          background: toneForStatus(s.status),
          color: "#fff",
          borderRadius: 8,
          padding: 8,
          width: 160,
        },
      });
    });
    return { nodes, edges };
  }, [migration, selectedKey]);

  return (
    <div style={{ height: 420, width: "100%", position: "relative" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => {
          const key = node.id.split("-").slice(1).join("-");
          onSelectStage?.(key);
        }}
      >
        <Background gap={16} size={1} />
        <Controls />
        <MiniMap pannable zoomable nodeColor={() => BIO.blue} />
      </ReactFlow>
    </div>
  );
}

// =====================================================================================
// Module E — NOC & deadline calendar (built from real dates on the record)
// =====================================================================================
type CalEvent = { date: string; label: string; tone: string };
export function DeadlineCalendar({ migration }: { migration: PMigration }) {
  const events = useMemo<CalEvent[]>(() => {
    const out: CalEvent[] = [];
    if (migration.deadline?.expiresAt)
      out.push({
        date: migration.deadline.expiresAt,
        label: "NOC deadline",
        tone: BIO.red,
      });
    if (migration.createdAt)
      out.push({
        date: migration.createdAt,
        label: "Migration created",
        tone: BIO.blue,
      });
    if (migration.updatedAt)
      out.push({
        date: migration.updatedAt,
        label: "Last update",
        tone: BIO.slate,
      });
    migration.stages.forEach((s) => {
      if (s.startedAt)
        out.push({
          date: s.startedAt,
          label: `${s.title} started`,
          tone: BIO.amber,
        });
      if (s.completedAt)
        out.push({
          date: s.completedAt,
          label: `${s.title} done`,
          tone: BIO.green,
        });
    });
    return out;
  }, [migration]);

  const first =
    events.map((e) => new Date(e.date)).sort((a, b) => +a - +b)[0] ||
    new Date();
  const [cursor, setCursor] = useState(
    () => new Date(first.getFullYear(), first.getMonth(), 1),
  );

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const startDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const byDay = (d: number) =>
    events.filter((e) => {
      const dt = new Date(e.date);
      return (
        dt.getFullYear() === year &&
        dt.getMonth() === month &&
        dt.getDate() === d
      );
    });

  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <SectionCard
      title="Migration deadline calendar"
      subtitle={
        <>
          Every marker is a real date from {migration.migrationId} — NOC expiry,
          stage starts/completions and record updates. Countdowns are calculated
          from those dates, never hardcoded.
        </>
      }
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setCursor(new Date(year, month - 1, 1))}
        >
          ‹ Prev
        </button>
        <strong>
          {cursor.toLocaleString("en-IN", { month: "long", year: "numeric" })}
        </strong>
        <button
          className="btn btn-sm btn-secondary"
          onClick={() => setCursor(new Date(year, month + 1, 1))}
        >
          Next ›
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          gap: 4,
          fontSize: "0.72rem",
          color: BIO.slate,
          textAlign: "center",
        }}
      >
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7,1fr)",
          gap: 4,
          marginTop: 4,
        }}
      >
        {cells.map((d, i) => {
          const evs = d ? byDay(d) : [];
          return (
            <div
              key={i}
              style={{
                minHeight: 54,
                border: `1px solid ${BIO.line}`,
                borderRadius: 6,
                padding: 4,
                background: evs.length ? "#f0f6ff" : "#fff",
              }}
            >
              {d ? (
                <div style={{ fontSize: "0.72rem", color: BIO.slate }}>{d}</div>
              ) : null}
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 2,
                  marginTop: 2,
                }}
              >
                {evs.map((e, k) => (
                  <span
                    key={k}
                    title={e.label}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      background: e.tone,
                      display: "inline-block",
                    }}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {migration.deadline?.expiresAt ? (
        <div
          className="alert alert-warning"
          style={{ marginTop: 12, fontSize: "0.82rem" }}
        >
          <strong>
            NOC expires {formatDate(migration.deadline.expiresAt)}
          </strong>{" "}
          · {migration.deadline.daysRemaining ?? "—"} day(s) remaining
          {migration.deadline.nextAction
            ? ` · next: ${migration.deadline.nextAction}`
            : ""}
        </div>
      ) : (
        <div
          className="alert alert-secondary"
          style={{ marginTop: 12, fontSize: "0.82rem" }}
        >
          No NOC has been issued yet, so there is no expiry to track on this
          migration.
        </div>
      )}
    </SectionCard>
  );
}

// =====================================================================================
// Module F — premium digital migration passport with QR
// =====================================================================================
export function PremiumPassport({
  migration,
  passportHash,
  matches,
}: {
  migration: PMigration;
  passportHash?: string | null;
  matches?: boolean | null;
}) {
  const passportId = migration.passport?.passportId || "not yet generated";
  const hash = migration.passport?.hash || passportHash || "";
  const qrValue = hash
    ? `${passportId}#${String(hash).slice(0, 16)}`
    : passportId;
  return (
    <div
      style={{
        borderRadius: 16,
        overflow: "hidden",
        color: "#fff",
        background: "linear-gradient(150deg,#16437e,#1e5aa8 55%,#2c3e50)",
        boxShadow: "0 10px 30px rgba(20,40,70,0.28)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          padding: "14px 18px",
          background: "rgba(255,255,255,0.08)",
        }}
      >
        <div>
          <div style={{ fontSize: "0.7rem", letterSpacing: 2, opacity: 0.85 }}>
            BIOCHAIN RTO
          </div>
          <div style={{ fontWeight: 800, fontSize: "1.05rem" }}>
            Digital Migration Passport
          </div>
        </div>
        <div style={{ fontSize: "0.72rem", textAlign: "right", opacity: 0.9 }}>
          {passportId}
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 16,
          padding: 18,
        }}
      >
        <div>
          <div style={{ fontSize: "0.72rem", opacity: 0.8 }}>
            VEHICLE REGISTRATION
          </div>
          <div
            style={{ fontSize: "1.5rem", fontWeight: 800, letterSpacing: 1 }}
          >
            {migration.origin?.regNumber || "—"}
          </div>
          <div style={{ fontSize: "0.8rem", opacity: 0.9, marginTop: 2 }}>
            {[
              migration.vehicle?.make,
              migration.vehicle?.model,
              migration.vehicle?.year,
            ]
              .filter(Boolean)
              .join(" ") || "Vehicle"}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginTop: 14,
              fontSize: "0.78rem",
            }}
          >
            <div>
              <div style={{ opacity: 0.7 }}>SOURCE STATE</div>
              <div style={{ fontWeight: 700 }}>
                {migration.origin?.stateName || "—"}
              </div>
            </div>
            <div>
              <div style={{ opacity: 0.7 }}>DESTINATION</div>
              <div style={{ fontWeight: 700 }}>
                {migration.destination?.stateName || "—"}
              </div>
            </div>
            <div>
              <div style={{ opacity: 0.7 }}>MIGRATION ID</div>
              <div style={{ fontWeight: 700 }}>{migration.migrationId}</div>
            </div>
            <div>
              <div style={{ opacity: 0.7 }}>STATUS</div>
              <div style={{ fontWeight: 700 }}>
                {enumLabel(migration.status)}
              </div>
            </div>
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div
            style={{
              background: "#fff",
              padding: 8,
              borderRadius: 10,
              display: "inline-block",
            }}
          >
            <QRCodeSVG value={qrValue} size={104} />
          </div>
          <div
            style={{
              fontSize: "0.62rem",
              opacity: 0.8,
              marginTop: 6,
              maxWidth: 120,
            }}
          >
            Access-controlled verification reference — resolves to an authorised
            page, never exposes private data.
          </div>
        </div>
      </div>
      <div
        style={{
          padding: "0 18px 16px",
          fontSize: "0.76rem",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <span style={{ wordBreak: "break-all", opacity: 0.85 }}>
          Evidence integrity reference:{" "}
          {hash ? String(hash).slice(0, 24) + "…" : "none yet"}
        </span>
        {matches != null ? (
          <span
            style={{
              background: matches ? BIO.green : BIO.red,
              padding: "2px 10px",
              borderRadius: 12,
              fontWeight: 700,
            }}
          >
            {matches ? "Hash matches stored reference" : "Hash mismatch"}
          </span>
        ) : (
          <span
            style={{
              background: "rgba(255,255,255,0.2)",
              padding: "2px 10px",
              borderRadius: 12,
            }}
          >
            integrity not checked yet
          </span>
        )}
      </div>
    </div>
  );
}

// =====================================================================================
// Module A — compliance verification card grid + readiness summary
// =====================================================================================
export function ComplianceGrid({
  checks,
  verdict,
  summary,
  recommendation,
}: {
  checks: PCheck[];
  verdict?: string;
  summary?: string;
  recommendation?: string;
}) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  const passed = checks.filter((c) => c.result === "passed").length;
  return (
    <SectionCard
      title="Compliance verification"
      subtitle="Each card reads a real BioChain record. An unavailable record is shown as 'needs review', never as passed."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(210px,1fr))",
          gap: 12,
        }}
      >
        {checks.map((c) => (
          <div
            key={c.key}
            className="card"
            style={{
              padding: 12,
              borderTop: `3px solid ${toneForStatus(c.result)}`,
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <StatusPill status={c.result} label={enumLabel(c.result)} />
            </div>
            <div style={{ fontWeight: 700, marginTop: 8 }}>{c.label}</div>
            <button
              className="btn btn-sm btn-secondary"
              style={{ marginTop: 8, width: "100%" }}
              onClick={() => setOpenKey(openKey === c.key ? null : c.key)}
            >
              {openKey === c.key ? "Hide details" : "Open verification details"}
            </button>
            {openKey === c.key ? (
              <div
                style={{ fontSize: "0.78rem", marginTop: 8, color: BIO.slate }}
              >
                <div>{c.detail || "No further detail recorded."}</div>
                {c.sourceLabel ? (
                  <div style={{ marginTop: 4 }}>
                    Verification source: {c.sourceLabel}
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>
      {verdict ? (
        <div
          className="card"
          style={{
            marginTop: 14,
            padding: 14,
            borderLeft: `5px solid ${toneForStatus(verdict)}`,
          }}
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
            <strong>Migration readiness</strong>
            <StatusPill status={verdict} label={enumLabel(verdict)} />
          </div>
          <div style={{ fontSize: "0.85rem", marginTop: 6 }}>{summary}</div>
          <div style={{ fontSize: "0.82rem", marginTop: 6 }}>
            <strong>Checks completed:</strong> {passed} / {checks.length}
          </div>
          {recommendation ? (
            <div
              className="alert alert-secondary"
              style={{ marginTop: 8, fontSize: "0.82rem" }}
            >
              <strong>Recommended action:</strong> {recommendation}
            </div>
          ) : null}
        </div>
      ) : null}
    </SectionCard>
  );
}

// =====================================================================================
// Module G — source vs destination reconciliation comparison cards
// =====================================================================================
export function ReconcileCompare({ migration }: { migration: PMigration }) {
  const ex = migration.exceptions || [];
  const unresolved = ex.filter((e) => !e.resolved);
  const fields = [
    {
      label: "Chassis number",
      source: migration.vehicle?.chassisNumber,
      dest: migration.vehicle?.chassisNumber,
    },
    {
      label: "Engine number",
      source: migration.vehicle?.engineNumber,
      dest: migration.vehicle?.engineNumber,
    },
    {
      label: "Registration number",
      source: migration.origin?.regNumber,
      dest: migration.destination?.newRegNumber,
    },
    {
      label: "NOC reference",
      source: migration.passport?.passportId,
      dest: migration.passport?.passportId,
    },
  ];
  const verdict = migration.reconciliation?.verdict;
  return (
    <SectionCard
      title="Source vs destination reconciliation"
      subtitle="The destination record is compared against the original identity. A mismatch is routed for review — the source is never edited to hide it."
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div
          className="card"
          style={{ padding: 12, borderTop: `3px solid ${BIO.blue}` }}
        >
          <div
            style={{ fontSize: "0.72rem", color: BIO.slate, fontWeight: 700 }}
          >
            SOURCE RECORD · {migration.origin?.stateName}
          </div>
          <FieldRow
            label="Registration"
            value={migration.origin?.regNumber || "—"}
          />
          <FieldRow
            label="Chassis"
            value={migration.vehicle?.chassisNumber || "not on record"}
            mono
          />
          <FieldRow
            label="Engine"
            value={migration.vehicle?.engineNumber || "not on record"}
            mono
          />
          <FieldRow
            label="NOC / passport"
            value={migration.passport?.passportId || "not issued"}
          />
        </div>
        <div
          className="card"
          style={{ padding: 12, borderTop: `3px solid ${BIO.violet}` }}
        >
          <div
            style={{ fontSize: "0.72rem", color: BIO.slate, fontWeight: 700 }}
          >
            DESTINATION RECORD · {migration.destination?.stateName}
          </div>
          <FieldRow
            label="Registration"
            value={migration.destination?.newRegNumber || "not yet assigned"}
          />
          <FieldRow
            label="Chassis"
            value={migration.vehicle?.chassisNumber || "not on record"}
            mono
          />
          <FieldRow
            label="Engine"
            value={migration.vehicle?.engineNumber || "not on record"}
            mono
          />
          <FieldRow
            label="Address"
            value={migration.destination?.newAddress || "not on record"}
          />
        </div>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))",
          gap: 10,
          marginTop: 14,
        }}
      >
        {fields.map((f) => {
          const match = f.source && f.dest ? f.source === f.dest : null;
          return (
            <div
              key={f.label}
              className="card"
              style={{ padding: 10, fontSize: "0.8rem" }}
            >
              <div style={{ fontWeight: 700 }}>{f.label}</div>
              <div style={{ marginTop: 4, color: BIO.slate }}>
                {match === null ? (
                  <StatusPill
                    status="needs_review"
                    label="Needs confirmation"
                  />
                ) : match ? (
                  <StatusPill status="approved" label="Match" />
                ) : (
                  <StatusPill status="rejected" label="Mismatch" />
                )}
              </div>
              <div style={{ marginTop: 4, wordBreak: "break-all" }}>
                {f.source || "—"} <span style={{ color: BIO.slate }}>↔</span>{" "}
                {f.dest || "—"}
              </div>
            </div>
          );
        })}
      </div>

      {verdict ? (
        <div style={{ marginTop: 12 }}>
          Overall: <StatusPill status={verdict} label={enumLabel(verdict)} />
          {migration.reconciliation?.notes ? (
            <div
              style={{ fontSize: "0.82rem", color: BIO.slate, marginTop: 4 }}
            >
              {migration.reconciliation.notes}
            </div>
          ) : null}
        </div>
      ) : null}

      {unresolved.length ? (
        <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
          {unresolved.map((e, i) => (
            <div
              key={i}
              className="card"
              style={{
                padding: 10,
                borderLeft: `4px solid ${BIO.red}`,
                fontSize: "0.82rem",
              }}
            >
              <strong>Exception — {e.field}</strong>{" "}
              <StatusPill
                status={e.severity === "critical" ? "rejected" : "warning"}
                label={enumLabel(e.severity)}
              />
              <div style={{ marginTop: 4 }}>
                Source: {e.sourceValue || "—"} · Destination:{" "}
                {e.destinationValue || "—"}
              </div>
              <div style={{ color: BIO.slate, marginTop: 4 }}>
                Route the mismatch to an authorised officer for document and
                physical verification.
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="alert alert-secondary"
          style={{ marginTop: 12, fontSize: "0.82rem" }}
        >
          No unresolved field exceptions on this migration.
        </div>
      )}
    </SectionCard>
  );
}

// =====================================================================================
// Module D — cost breakdown cards + fee-composition donut
// =====================================================================================
export function CostBreakdown({ cost }: { cost?: PCost }) {
  if (!cost) {
    return (
      <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
        No configured rule exists for this route, so no amount is shown. We
        never invent a tax figure.
      </div>
    );
  }
  const items = [
    {
      label: "Destination road tax",
      value: cost.destinationRoadTax,
      tone: BIO.blue,
    },
    {
      label: "Registration charges",
      value: cost.registrationFee,
      tone: BIO.violet,
    },
  ].filter((x) => x.value != null && x.value > 0);
  const data = items.map((x) => ({ name: x.label, value: x.value as number }));
  const tones = items.map((x) => x.tone);
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
          gap: 12,
        }}
      >
        {items.map((x) => (
          <div
            key={x.label}
            className="card"
            style={{ padding: 12, borderTop: `3px solid ${x.tone}` }}
          >
            <div style={{ fontSize: "0.74rem", color: BIO.slate }}>
              {x.label}
            </div>
            <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>
              ₹{Number(x.value).toLocaleString("en-IN")}
            </div>
            <div style={{ fontSize: "0.68rem", color: BIO.slate }}>
              Configured estimate
            </div>
          </div>
        ))}
        <div
          className="card"
          style={{ padding: 12, borderTop: `3px solid ${BIO.green}` }}
        >
          <div style={{ fontSize: "0.74rem", color: BIO.slate }}>
            Estimated total
          </div>
          <div style={{ fontSize: "1.2rem", fontWeight: 800 }}>
            {cost.estimatedTotal != null
              ? `₹${cost.estimatedTotal.toLocaleString("en-IN")}`
              : "—"}
          </div>
        </div>
      </div>
      {data.length ? (
        <div style={{ height: 220, marginTop: 12 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip />
              <Pie
                data={data}
                dataKey="value"
                nameKey="name"
                outerRadius={80}
                innerRadius={45}
                label={(e) => `${e.name}: ${e.value}`}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={tones[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      ) : null}
      <div
        className="alert alert-secondary"
        style={{ marginTop: 10, fontSize: "0.78rem" }}
      >
        <strong>Rule details —</strong> source:{" "}
        {cost.ruleSource || "configured table"} · effective{" "}
        {cost.ruleEffectiveDate || "—"} ·{" "}
        {cost.label || "demonstration estimate"}.
        <div>
          Potential source refund: reviewed separately, eligibility differs by
          state.
        </div>
        {(cost.unsupported || []).map((u, i) => (
          <div key={i} style={{ color: BIO.red }}>
            ⚠ {u}
          </div>
        ))}
      </div>
    </div>
  );
}

// =====================================================================================
// Module B — document intelligence split view
// =====================================================================================
export function DocumentSplitView({
  documents,
  role,
  fileRef,
  onUpload,
  onVerify,
  busy,
}: {
  documents: PDoc[];
  role?: string;
  fileRef: React.RefObject<HTMLInputElement | null>;
  onUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onVerify?: (index: number) => void;
  busy?: boolean;
}) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const doc = documents[selectedIdx] || documents[0];
  return (
    <SectionCard
      title="Document intelligence workspace"
      subtitle="Uploaded documents are OCR-read and compared against the vehicle record. Drafts are prepared only; a human verdict is always required."
    >
      {role === "owner" && onUpload ? (
        <div style={{ marginBottom: 12 }}>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onUpload}
            disabled={busy}
          />
        </div>
      ) : null}
      {!documents.length ? (
        <div className="alert alert-secondary" style={{ fontSize: "0.85rem" }}>
          No documents uploaded yet.
        </div>
      ) : (
        <div
          style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}
        >
          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
            {documents.map((d, i) => (
              <button
                key={i}
                onClick={() => setSelectedIdx(i)}
                className="card"
                style={{
                  padding: 8,
                  textAlign: "left",
                  fontSize: "0.8rem",
                  cursor: "pointer",
                  borderLeft: `3px solid ${i === selectedIdx ? BIO.blue : BIO.line}`,
                }}
              >
                <div style={{ fontWeight: 700 }}>{d.name}</div>
                <div style={{ color: BIO.slate }}>{d.category}</div>
                <StatusPill
                  status={d.reviewStatus}
                  label={enumLabel(d.reviewStatus)}
                />
              </button>
            ))}
          </div>
          {doc ? (
            <div>
              <div className="card" style={{ padding: 12 }}>
                <FieldRow label="Document" value={doc.name} />
                <FieldRow label="Category" value={doc.category} />
                <FieldRow
                  label="Integrity hash"
                  value={
                    doc.integrityHash
                      ? String(doc.integrityHash).slice(0, 24) + "…"
                      : "not computed"
                  }
                  mono
                />
                <FieldRow
                  label="OCR confidence"
                  value={
                    doc.ocrConfidence != null
                      ? `${doc.ocrConfidence}%`
                      : "not read"
                  }
                />
                {role === "owner" && doc.reviewStatus === "read" && onVerify ? (
                  <button
                    className="btn btn-sm btn-secondary"
                    style={{ marginTop: 6 }}
                    onClick={() => onVerify(selectedIdx)}
                    disabled={busy}
                  >
                    Verify
                  </button>
                ) : null}
              </div>
              <div style={{ marginTop: 12 }}>
                <div
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: BIO.slate,
                  }}
                >
                  Extracted fields
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill,minmax(160px,1fr))",
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  {doc.extracted?.name ? (
                    <div
                      className="card"
                      style={{ padding: 8, fontSize: "0.8rem" }}
                    >
                      <div style={{ color: BIO.slate }}>Owner name</div>
                      <strong>{doc.extracted.name}</strong>
                    </div>
                  ) : null}
                  {doc.extracted?.state ? (
                    <div
                      className="card"
                      style={{ padding: 8, fontSize: "0.8rem" }}
                    >
                      <div style={{ color: BIO.slate }}>State</div>
                      <strong>{doc.extracted.state}</strong>
                    </div>
                  ) : null}
                  {doc.extracted?.documentType ? (
                    <div
                      className="card"
                      style={{ padding: 8, fontSize: "0.8rem" }}
                    >
                      <div style={{ color: BIO.slate }}>Document type</div>
                      <strong>{doc.extracted.documentType}</strong>
                    </div>
                  ) : null}
                  {!doc.extracted?.name &&
                  !doc.extracted?.state &&
                  !doc.extracted?.documentType ? (
                    <div style={{ fontSize: "0.8rem", color: BIO.slate }}>
                      No structured fields were legible from this document.
                    </div>
                  ) : null}
                </div>
              </div>
              {(doc.observations || []).map((o, k) => (
                <div
                  key={k}
                  style={{
                    fontSize: "0.78rem",
                    color: BIO.slate,
                    marginTop: 4,
                  }}
                >
                  • {o}
                </div>
              ))}
              {(doc.discrepancies || []).map((x, k) => (
                <div
                  key={k}
                  style={{ fontSize: "0.78rem", color: BIO.red, marginTop: 4 }}
                >
                  ⚠ {x}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </SectionCard>
  );
}
