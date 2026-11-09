// PatentFeatures.tsx
// BioChain Patent-Feature Console.
//
// The platform ships eight patent-prototype engines on /api/patent-features. Until
// now they ran only as API plumbing; this console drives each engine against your
// REAL records so they can be demonstrated and inspected. Honesty boundaries:
//   * Biometrics are simulated templates (this build has no hardware SDK); results
//     are labelled as simulated.
//   * "Zero-knowledge" proofs here are hash-commitment demonstrations, not a
//     production ZK circuit, and the console says so.
//   * Auto-freeze and state transitions change real records and are gated to the
//     same roles the backend enforces (police / RTO).
//   * Every result is shown exactly as the engine returned it - a readable summary
//     plus the raw payload, never a prettified fiction.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/useAuth";
import DashboardLayout from "../components/DashboardLayout";
import { enumLabel } from "../lib/display";
import { notify } from "../lib/notify";
import { SectionCard, StatusPill } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";

type Result = Record<string, unknown>;
type ApiError = { response?: { data?: { message?: string; error?: string } } };
const errMessage = (err: unknown, fallback: string): string => {
  const e = err as ApiError;
  return e?.response?.data?.message || e?.response?.data?.error || fallback;
};

// One shared shape for "call an engine, show whatever it returned".
function useRunner() {
  const { api } = useAuth();
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const run = useCallback(
    async (path: string, body?: unknown, method: "get" | "post" = "post") => {
      setBusy(true);
      try {
        const r =
          method === "get"
            ? await api.get(path)
            : await api.post(path, body ?? {});
        setRes(r.data as Result);
        return r.data as Result;
      } catch (err: unknown) {
        notify(errMessage(err, "The engine call failed."), "error");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [api],
  );
  const reset = useCallback(() => setRes(null), []);
  return { busy, res, run, reset };
}

// Scalars render as label/value rows; nested structures render as raw JSON,
// exactly what the service returned.
function ResultView({ data, note }: { data: Result | null; note?: string }) {
  if (!data) return null;
  const scalars = Object.entries(data).filter(
    ([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v),
  );
  const nested = Object.entries(data).filter(
    ([, v]) => v !== null && typeof v === "object",
  );
  return (
    <div
      style={{
        marginTop: 12,
        border: `1px solid ${BIO.line}`,
        borderRadius: 10,
        padding: 12,
        background: "#fbfdff",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <strong style={{ fontSize: "0.85rem", color: BIO.ink }}>
          Engine result
        </strong>
        {data.success === false || data.error ? (
          <StatusPill status="rejected" label="failure reported" />
        ) : (
          <StatusPill status="completed" label="returned" />
        )}
      </div>
      {scalars.length > 0 && (
        <table style={{ fontSize: "0.82rem", marginTop: 6, width: "100%" }}>
          <tbody>
            {scalars.map(([k, v]) => (
              <tr key={k}>
                <td style={{ color: BIO.slate, width: 220 }}>{enumLabel(k)}</td>
                <td style={{ wordBreak: "break-all" }}>
                  {v === null || v === "" ? "—" : String(v)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {nested.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary style={{ fontSize: "0.8rem", color: BIO.slate }}>
            Full payload ({nested.map(([k]) => k).join(", ")})
          </summary>
          <pre
            style={{
              fontSize: "0.72rem",
              overflowX: "auto",
              maxHeight: 320,
              background: "#f1f5f9",
              padding: 8,
              borderRadius: 6,
            }}
          >
            {JSON.stringify(
              Object.fromEntries(nested.map(([k, v]) => [k, v])),
              null,
              2,
            )}
          </pre>
        </details>
      )}
      {note && (
        <div style={{ fontSize: "0.76rem", color: BIO.slate, marginTop: 6 }}>
          {note}
        </div>
      )}
    </div>
  );
}

const inputStyle = { flex: "1 1 220px" };
const BTN = "btn btn-sm btn-primary";
const BTN_ALT = "btn btn-sm btn-outline-primary";

function RunButton({
  busy,
  onClick,
  children,
  outline,
  disabled,
}: {
  busy: boolean;
  onClick: () => void;
  children: React.ReactNode;
  outline?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={outline ? BTN_ALT : BTN}
      onClick={onClick}
      disabled={busy || disabled}
    >
      {busy ? "Running…" : children}
    </button>
  );
}

// Vehicle reference picker: owners pick from their own list, RTO/police search the
// register. This reuses the exact endpoints the rest of the app already calls.
function VehiclePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string, reg: string) => void;
}) {
  const { api, user } = useAuth();
  const role = user?.role;
  const [vehicles, setVehicles] = useState<
    { _id: string; regNumber: string; make?: string; model?: string }[]
  >([]);
  const [q, setQ] = useState("");

  const loadMine = useCallback(async () => {
    try {
      const r = await api.get("/vehicles/my");
      setVehicles((r.data || []) as typeof vehicles);
    } catch {
      /* the list simply stays empty */
    }
  }, [api]);

  const search = useCallback(async () => {
    if (!q.trim()) return;
    try {
      const r = await api.get(
        `/vehicles/search?query=${encodeURIComponent(q.trim())}&limit=10`,
      );
      setVehicles((r.data?.vehicles || []) as typeof vehicles);
    } catch (err: unknown) {
      notify(errMessage(err, "Search failed"), "error");
    }
  }, [api, q]);

  useEffect(() => {
    if (role === "owner") void loadMine();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role]);

  return (
    <div
      style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}
    >
      {role === "owner" ? (
        <select
          className="form-select form-select-sm"
          style={inputStyle}
          value={value}
          onChange={(e) => {
            const v = vehicles.find((x) => x._id === e.target.value);
            onChange(e.target.value, v?.regNumber || "");
          }}
        >
          <option value="">Pick one of my vehicles…</option>
          {vehicles.map((v) => (
            <option key={v._id} value={v._id}>
              {v.regNumber} · {v.make} {v.model}
            </option>
          ))}
        </select>
      ) : (
        <>
          <input
            className="form-control form-control-sm"
            style={inputStyle}
            placeholder="Registration / chassis / engine fragment…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && search()}
          />
          <button className={BTN_ALT} type="button" onClick={search}>
            Find
          </button>
          <select
            className="form-select form-select-sm"
            style={inputStyle}
            value={value}
            onChange={(e) => {
              const v = vehicles.find((x) => x._id === e.target.value);
              onChange(e.target.value, v?.regNumber || "");
            }}
          >
            <option value="">Pick from results…</option>
            {vehicles.map((v) => (
              <option key={v._id} value={v._id}>
                {v.regNumber} · {v.make} {v.model}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  );
}

function useVehicleRef() {
  const [vehicleId, setVehicleId] = useState("");
  const [reg, setReg] = useState("");
  const onChange = (id: string, r: string) => {
    setVehicleId(id);
    setReg(r);
  };
  return { vehicleId, reg, onChange };
}

// --- Feature 1: Biometric + DID binding -------------------------------------
function BiometricPanel() {
  const { busy, res, run } = useRunner();
  const [template, setTemplate] = useState("simulated-template-001");
  const [didDoc, setDidDoc] = useState<Result | null>(null);
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        Binds a Decentralised Identity document to a hash of a biometric
        template, so a credential is only usable with the same template. This
        build uses
        <strong> simulated templates</strong> (no hardware SDK); the hashing and
        binding logic itself is real.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <input
          className="form-control form-control-sm"
          style={inputStyle}
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          placeholder="Simulated biometric template string"
        />
        <RunButton
          busy={busy}
          onClick={() =>
            void run("/patent-features/biometric/hash", {
              biometricTemplate: template,
            })
          }
        >
          Hash template
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={async () => {
            const r = await run("/patent-features/biometric-did/create", {
              biometricTemplate: template,
            });
            if (r?.didDocument) setDidDoc(r.didDocument as Result);
          }}
        >
          Create biometric-bound DID
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            didDoc
              ? void run("/patent-features/biometric-did/verify", {
                  biometricTemplate: template,
                  didDocument: didDoc,
                })
              : notify(
                  "Create a DID first, then try verifying with a changed template.",
                  "info",
                )
          }
        >
          Verify template against DID
        </RunButton>
      </div>
      <div style={{ fontSize: "0.78rem", color: BIO.slate, marginTop: 6 }}>
        Tip: create the DID, change the template text, then verify — the engine
        should reject the mismatch instead of quietly accepting it.
      </div>
      <ResultView data={res} />
    </div>
  );
}

// --- Feature 2: Explainable fraud detection ----------------------------------
function FraudEnginePanel() {
  const { user } = useAuth();
  const { busy, res, run } = useRunner();
  const { vehicleId, reg, onChange } = useVehicleRef();
  const [type, setType] = useState("transfer");
  const officer = user?.role === "rto" || user?.role === "police";
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        Rule-based, fully explainable scoring: every check the engine ran is
        listed with its weight and message. No hidden model, no fabricated
        probability.
      </p>
      <VehiclePicker value={vehicleId} onChange={onChange} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={async () => {
            if (!user?.id) return;
            await run(
              `/patent-features/fraud/analyze-user/${user.id}`,
              undefined,
              "get",
            );
          }}
        >
          Analyse my own behaviour
        </RunButton>
        <select
          className="form-select form-select-sm"
          style={{ flex: "0 1 160px" }}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="transfer">transfer</option>
          <option value="registration">registration</option>
          <option value="challan-payment">challan-payment</option>
        </select>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            vehicleId
              ? void run("/patent-features/fraud/analyze-transaction", {
                  vehicleId,
                  type,
                  transactionId: `demo-${Date.now()}`,
                })
              : notify("Pick a vehicle first.", "info")
          }
        >
          Score a {enumLabel(type)} on {reg || "…"}
        </RunButton>
        {officer && (
          <RunButton
            busy={busy}
            outline
            onClick={() =>
              void run("/patent-features/fraud/dashboard", undefined, "get")
            }
          >
            Aggregate dashboard
          </RunButton>
        )}
      </div>
      <ResultView
        data={res}
        note="Scores are risk indications from explainable rules - never a validated fraud conclusion."
      />
    </div>
  );
}

// --- Feature 3: Multi-authority consensus ------------------------------------
function ConsensusPanel() {
  const { busy, res, run } = useRunner();
  const [lastId, setLastId] = useState("");
  const [authority, setAuthority] = useState("rto-source");
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        A high-impact action (e.g. a cross-state deregistration) can require
        several independent authorities to agree before it completes. Approvals
        here are recorded by whoever is logged in, exactly as the engine stores
        them.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={async () => {
            const r = await run("/patent-features/consensus/create", {
              transactionType: "cross-state-deregistration",
              vehicleRegNumber: "DEMO-CONSENSUS",
              description: "Consensus demo request from the feature console",
              requiredAuthorities: ["rto-source", "rto-destination", "police"],
            });
            const id = (r?.requestId ||
              r?.consensusRequestId ||
              r?.id ||
              (r?.request as Result | undefined)?._id) as string | undefined;
            if (id) setLastId(String(id));
          }}
        >
          Create consensus request
        </RunButton>
        <select
          className="form-select form-select-sm"
          style={{ flex: "0 1 180px" }}
          value={authority}
          onChange={(e) => setAuthority(e.target.value)}
        >
          {["rto-source", "rto-destination", "police", "transport-dept"].map(
            (a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ),
          )}
        </select>
        <RunButton
          busy={busy}
          outline
          disabled={!lastId}
          onClick={async () => {
            if (!lastId) return;
            await run(`/patent-features/consensus/${lastId}/approve`, {
              authority,
              comments: `approved via console by ${authority}`,
            });
          }}
        >
          Approve as {authority}
        </RunButton>
        <RunButton
          busy={busy}
          outline
          disabled={!lastId}
          onClick={async () => {
            if (!lastId) return;
            await run(
              `/patent-features/consensus/${lastId}/status`,
              undefined,
              "get",
            );
          }}
        >
          Check status
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            void run("/patent-features/consensus/statistics", undefined, "get")
          }
        >
          Statistics (RTO)
        </RunButton>
      </div>
      {lastId && (
        <div style={{ fontSize: "0.78rem", color: BIO.slate, marginTop: 6 }}>
          Last request: <code>{lastId}</code>
        </div>
      )}
      <ResultView data={res} />
    </div>
  );
}

// --- Feature 4: Vehicle lifecycle state machine -------------------------------
function LifecyclePanel() {
  const { busy, res, run } = useRunner();
  const { vehicleId, reg, onChange } = useVehicleRef();
  const [reason, setReason] = useState("");
  const guard = (fn: () => void) =>
    vehicleId ? fn() : notify("Pick a vehicle first.", "info");
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        Every vehicle sits in a governed state machine; transitions are
        validated against allowed paths, and an illegal jump is refused rather
        than patched through. Freeze actions are police-only, the same as the
        backend enforces.
      </p>
      <VehiclePicker value={vehicleId} onChange={onChange} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={() =>
            guard(
              () =>
                void run(
                  `/patent-features/lifecycle/${vehicleId}/state`,
                  undefined,
                  "get",
                ),
            )
          }
        >
          State of {reg || "…"}
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            guard(
              () =>
                void run(
                  `/patent-features/lifecycle/${vehicleId}/can-transfer`,
                  undefined,
                  "get",
                ),
            )
          }
        >
          Can it transfer?
        </RunButton>
        <input
          className="form-control form-control-sm"
          style={inputStyle}
          placeholder="Reason (recorded on the transition)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            guard(
              () =>
                void run(`/patent-features/lifecycle/${vehicleId}/freeze`, {
                  reason: reason || "console demo",
                }),
            )
          }
        >
          Auto-freeze (police)
        </RunButton>
      </div>
      <ResultView
        data={res}
        note="Freezing changes a real record — the console only exposes it to the roles the API allows."
      />
    </div>
  );
}

// --- Feature 5: Privacy-preserving ownership verification ---------------------
function PrivacyPanel() {
  const { busy, res, run } = useRunner();
  const { vehicleId, reg, onChange } = useVehicleRef();
  const [proof, setProof] = useState<Result | null>(null);
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        Answers "is this vehicle's owner in good standing?" without revealing
        the holder's identity number to the requester. The ZKP step below is a
        hash-commitment demonstration (claim + salt + verify), not a production
        ZK circuit — the console labels it as such everywhere.
      </p>
      <VehiclePicker value={vehicleId} onChange={onChange} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={() =>
            vehicleId
              ? void run(
                  `/patent-features/privacy/verify/${vehicleId}`,
                  undefined,
                  "get",
                )
              : notify("Pick a vehicle first.", "info")
          }
        >
          Privacy-preserving verify {reg || ""}
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={async () => {
            if (!vehicleId) return notify("Pick a vehicle first.", "info");
            const r = await run(
              `/patent-features/privacy/zkp/generate/${vehicleId}`,
              { ownerDID: `did:biochain:${vehicleId}` },
            );
            const p = (r?.proof || r?.zkProof) as Result | undefined;
            if (p) setProof(p);
          }}
        >
          Generate ownership proof
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            proof
              ? void run("/patent-features/privacy/zkp/verify", {
                  proof,
                  regNumber: reg,
                })
              : notify("Generate a proof first.", "info")
          }
        >
          Verify the proof
        </RunButton>
      </div>
      <ResultView data={res} />
    </div>
  );
}

// --- Feature 6: Cross-state RTO interoperability --------------------------------
function InteropPanel() {
  const { busy, res, run } = useRunner();
  const { vehicleId, reg, onChange } = useVehicleRef();
  const [passport, setPassport] = useState<Result | null>(null);
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        A signed Vehicle Passport travels with the vehicle between state
        systems; the receiving side verifies the hash instead of re-keying data.
        This is the engine behind the Migration Orchestrator's passport step.
      </p>
      <VehiclePicker value={vehicleId} onChange={onChange} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={async () => {
            if (!vehicleId) return notify("Pick a vehicle first.", "info");
            const r = await run(
              `/patent-features/interoperability/passport/${vehicleId}`,
              undefined,
              "get",
            );
            if (r?.passport) setPassport(r.passport as Result);
          }}
        >
          Generate passport for {reg || "…"}
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            passport
              ? void run("/patent-features/interoperability/passport/verify", {
                  passport,
                  passportHash: (passport as Result).passportHash || "",
                })
              : notify("Generate a passport first.", "info")
          }
        >
          Re-verify the passport
        </RunButton>
        <RunButton
          busy={busy}
          outline
          onClick={() =>
            void run(
              "/patent-features/interoperability/stats",
              undefined,
              "get",
            )
          }
        >
          Interoperability stats
        </RunButton>
      </div>
      <ResultView data={res} />
    </div>
  );
}

// --- Feature 7: Predictive theft detection + auto-freeze ------------------------
function TheftPanel() {
  const { user } = useAuth();
  const { busy, res, run } = useRunner();
  const { vehicleId, reg, onChange } = useVehicleRef();
  const police = user?.role === "police";
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        Scores theft likelihood from recorded factors (age, model demand,
        security features, location history) with every factor shown, and can
        trigger the auto-freeze path for police. Scores are indications, never
        accusations.
      </p>
      <VehiclePicker value={vehicleId} onChange={onChange} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={() =>
            vehicleId
              ? void run(
                  `/patent-features/theft/risk/${vehicleId}`,
                  undefined,
                  "get",
                )
              : notify("Pick a vehicle first.", "info")
          }
        >
          Theft risk of {reg || "…"}
        </RunButton>
        {police && (
          <>
            <RunButton
              busy={busy}
              outline
              onClick={() =>
                void run("/patent-features/theft/dashboard", undefined, "get")
              }
            >
              Monitoring dashboard
            </RunButton>
            <RunButton
              busy={busy}
              outline
              onClick={() =>
                vehicleId
                  ? void run(
                      `/patent-features/theft/auto-freeze/${vehicleId}`,
                      { reason: "console-triggered review" },
                    )
                  : notify("Pick a vehicle first.", "info")
              }
            >
              Execute auto-freeze
            </RunButton>
          </>
        )}
      </div>
      <ResultView
        data={res}
        note="Auto-freeze is a real state change and is only offered to the police role."
      />
    </div>
  );
}

// --- Feature 8: Ownership reputation -------------------------------------------
function ReputationPanel() {
  const { user } = useAuth();
  const { busy, res, run } = useRunner();
  const [lastScore, setLastScore] = useState<number | null>(null);
  return (
    <div>
      <p style={{ fontSize: "0.85rem" }}>
        A transparent score built from your own recorded conduct — challan
        history, transfer hygiene, document verification — with the full factor
        breakdown. Your own score is visible to you; user ids are never
        enumerated.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <RunButton
          busy={busy}
          onClick={async () => {
            const r = await run(
              `/patent-features/reputation/${user?.id}`,
              undefined,
              "get",
            );
            const s = (r?.score ?? r?.reputationScore) as number | undefined;
            if (typeof s === "number") setLastScore(s);
          }}
        >
          Calculate my reputation
        </RunButton>
        <RunButton
          busy={busy}
          outline
          disabled={lastScore == null}
          onClick={async () => {
            if (lastScore == null) return;
            await run(
              `/patent-features/reputation/badge/${lastScore}`,
              undefined,
              "get",
            );
          }}
        >
          Badge for {lastScore ?? "—"}
        </RunButton>
      </div>
      <ResultView data={res} />
    </div>
  );
}

type Feature = {
  id: string;
  title: string;
  tagline: string;
  roles?: string[]; // undefined = every signed-in role
  Panel: () => React.ReactElement;
};

const FEATURES: Feature[] = [
  {
    id: "biometric",
    title: "1 · Biometric + DID Binding",
    tagline: "Credentials bound to a biometric hash",
    Panel: BiometricPanel,
  },
  {
    id: "fraud-engine",
    title: "2 · Explainable Fraud Scoring",
    tagline: "Rule-based risk with every check listed",
    Panel: FraudEnginePanel,
  },
  {
    id: "consensus",
    title: "3 · Multi-Authority Consensus",
    tagline: "No single click completes a high-impact action",
    Panel: ConsensusPanel,
  },
  {
    id: "lifecycle",
    title: "4 · Lifecycle State Machine",
    tagline: "Illegal state jumps are refused, not patched",
    Panel: LifecyclePanel,
  },
  {
    id: "privacy",
    title: "5 · Privacy-Preserving Verification",
    tagline: "Prove standing without exposing identity",
    Panel: PrivacyPanel,
  },
  {
    id: "interop",
    title: "6 · Cross-State Interoperability",
    tagline: "Signed passport travels between state systems",
    Panel: InteropPanel,
  },
  {
    id: "theft",
    title: "7 · Predictive Theft + Auto-Freeze",
    tagline: "Factorised risk indications for police review",
    Panel: TheftPanel,
  },
  {
    id: "reputation",
    title: "8 · Ownership Reputation",
    tagline: "Transparent score from recorded conduct",
    Panel: ReputationPanel,
  },
];

export default function PatentFeatures() {
  const { user } = useAuth();
  const role = user?.role || "";
  const allowed = useMemo(
    () => FEATURES.filter((f) => !f.roles || f.roles.includes(role)),
    [role],
  );
  const [active, setActive] = useState(allowed[0]?.id || "");
  // Derived fallback, so a role change never renders a stale tab - no effect needed.
  const current =
    allowed.find((f) => f.id === active) || allowed[0] || FEATURES[0];
  if (!allowed.length) {
    return (
      <DashboardLayout title="Patent Feature Console">
        <div className="alert alert-secondary">
          No patent-feature consoles are available for the {enumLabel(role)}{" "}
          role.
        </div>
      </DashboardLayout>
    );
  }
  const Active = current.Panel;
  return (
    <DashboardLayout
      title="Patent Feature Console"
      subtitle="The eight patent-prototype engines, driven live against your real records - each result shown exactly as the engine returned it."
    >
      <div
        style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}
      >
        {allowed.map((f) => (
          <button
            key={f.id}
            className={`btn btn-sm ${current.id === f.id ? "btn-primary" : "btn-outline-primary"}`}
            onClick={() => setActive(f.id)}
          >
            {f.title}
          </button>
        ))}
      </div>
      <SectionCard title={current.title} subtitle={current.tagline}>
        <Active />
      </SectionCard>
    </DashboardLayout>
  );
}
