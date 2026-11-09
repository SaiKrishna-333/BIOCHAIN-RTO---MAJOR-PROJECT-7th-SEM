// DigitalIdCard.tsx
// The citizen's own Digital Identity Card - the mParivahan-style credential
// every registered user gets. Shows all profile data, the simulated
// fingerprint (a ridge pattern drawn from their biometric template seed) and the
// tamper-evident hash of the card. The "View Transaction" link appears only when
// a transaction actually exists; while the anchoring fee is unpaid the card says
// that plainly instead of implying a confirmation it does not have.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import ViewTransactionButton from "./ViewTransactionButton";
import { formatDateTime } from "../lib/display";
import { resolveStateCode, stateName } from "../lib/states";

interface IdCard {
  _id: string;
  cardNumber: string;
  version: number;
  issuedAt: string;
  holder: {
    name: string;
    role: string;
    email: string;
    phone?: string;
    address?: string;
    state?: string;
    district?: string;
    hasPhoto?: boolean;
  };
  identifiers: {
    aadhaarMasked?: string;
    dlNumber?: string;
    badgeNumber?: string;
    employeeId?: string;
    gstin?: string;
    organization?: string;
    did?: string;
    biochainDid?: string;
    walletAddress?: string;
  };
  biometric: {
    enrolled: boolean;
    templateId?: string;
    fingerprintSeed?: string;
    algorithm?: string;
    enrolledAt?: string;
  };
  kyc?: { documentType?: string; extractedViaOcr?: boolean };
  anchor?: {
    recordHash?: string;
    status?: string;
    txHash?: string | null;
    note?: string;
  };
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Vehicle Owner / Citizen",
  dealer: "Authorized Vehicle Dealer",
  rto: "RTO Officer",
  police: "Law Enforcement Officer",
  workshop: "Authorized Service Workshop",
  admin: "System Administrator",
};

// A card is read by a person, so identifiers are shortened only far enough to
// stay recognisable: the method prefix and the tail of the key remain visible.
const short = (v?: string, n = 10) =>
  v ? (v.length > 2 * n + 3 ? `${v.slice(0, n)}…${v.slice(-n)}` : v) : "—";

const shortDid = (v?: string) =>
  v ? (v.length > 34 ? `${v.slice(0, 22)}…${v.slice(-10)}` : v) : "—";

// Deterministic fingerprint ridges: the seed hex (from the biometric template)
// drives wobble, splits and the core whorl, so every person's print is unique
// and stable, while anybody without the template cannot reproduce it.
function FingerprintGlyph({ seed }: { seed?: string }) {
  const nums: number[] = [];
  const s = seed || "0123456789abcdef0123456789abcdef";
  for (let i = 0; i < 32; i += 2) nums.push(parseInt(s.slice(i, i + 2), 16));
  const w = (i: number) => (nums[i % 16] / 255) * 4 - 2; // -2..2 px wobble
  return (
    <svg width="90" height="112" viewBox="0 0 150 190">
      <ellipse
        cx={75 + w(0)}
        cy={95}
        rx={16 + w(1)}
        ry={22 + w(2)}
        fill="none"
        stroke="#37474f"
        strokeWidth="2"
      />
      {[...Array(9)].map((_, i) => (
        <path
          key={i}
          d={`M ${75 - 14 - i * 6.5 + w(i)} ${95 - 20 - i * 8 - w(i + 3)}
              Q ${75 + w(i + 5)} ${95 - 42 - i * 8}, ${75 + 14 + i * 6.5 - w(i + 7)} ${95 - 20 - i * 8 + w(i + 2)}
              Q ${75 + 20 + i * 7} ${95 + 15 + i * 6}, ${75 + w(i + 9)} ${95 + 30 + i * 7 + w(i)}`}
          fill="none"
          stroke="#455a64"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      ))}
      {/* core whorl */}
      <path
        d={`M ${75 + w(11)} ${88} Q ${88 + w(12)} ${96}, ${75 - w(13)} ${106} Q ${62 + w(14)} ${114}, ${76 + w(15)} ${120}`}
        fill="none"
        stroke="#263238"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function DigitalIdCard() {
  const { user, api } = useAuth();
  const [card, setCard] = useState<IdCard | null>(null);
  const [outOfDate, setOutOfDate] = useState<string[]>([]);
  const [photoUrl, setPhotoUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // Whether the last message was good or bad news. Reading it off the text
  // itself (msg.startsWith("")) made every message - including a successful
  // issuance - render in the error colour.
  const [msgIsError, setMsgIsError] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/id-card/me");
      setCard(data.hasCard ? data.card : null);
      setOutOfDate(Array.isArray(data.outOfDate) ? data.outOfDate : []);
    } catch {
      setCard(null);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  // Card photo = the profile photo uploaded at sign-up. Trust the live account
  // flag (user.hasProfilePhoto), not the card's stored holder.hasPhoto: a card
  // issued earlier can still say "has photo" after the bytes are gone, and the
  // request that follows then lands on a 404. The object URL is released when
  // the photo changes or the card closes, so reopening does not leak memory.
  useEffect(() => {
    if (!user?.hasProfilePhoto || !user?.id) {
      setPhotoUrl("");
      return;
    }
    let revoked = "";
    api
      .get(`/auth/users/${user.id}/photo`, { responseType: "blob" })
      .then((r) => {
        revoked = URL.createObjectURL(r.data);
        setPhotoUrl(revoked);
      })
      .catch(() => setPhotoUrl(""));
    return () => {
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [user?.hasProfilePhoto, user?.id, api]);

  const issue = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { data } = await api.post("/id-card/me");
      setCard(data.card);
      setOutOfDate([]);
      setMsg(data.message);
      setMsgIsError(false);
    } catch (err: unknown) {
      const m =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not issue the card";
      setMsg(`${m}`);
      setMsgIsError(true);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setMsg("");
    try {
      const { data } = await api.get("/id-card/me/verify");
      if (!data.verified) {
        setMsg(`${data.reason || "Verification failed"}`);
        setMsgIsError(true);
        return;
      }
      // What verification actually proves: the stored content still produces the
      // hash recorded on the card. Whether that hash reached the chain is a
      // separate fact, stated from the anchor record rather than assumed.
      const committed =
        data.anchorStatus === "anchored" && Boolean(data.txHash);
      setMsg(
        committed
          ? "Integrity verified: the card's content still produces its recorded hash, and that hash is committed on Polygon Amoy."
          : `Integrity verified: the card's content still produces its recorded hash. ${
              data.anchorStatus === "pending"
                ? "The chain commitment for this card is still awaiting its transaction fee."
                : "No chain commitment has been recorded for this card yet."
            }`,
      );
      setMsgIsError(false);
    } catch (err: unknown) {
      const m =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Verification failed";
      setMsg(`${m}`);
      setMsgIsError(true);
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return null;

  // ---------- Not issued yet: offer issuance ----------
  if (!card) {
    return (
      <div
        className="card"
        style={{ maxWidth: 720, margin: "0 auto 1.5rem", textAlign: "center" }}
      >
        <h3 style={{ color: "var(--color-cyan-dark)" }}>
          My Digital Identity Card
        </h3>
        <p style={{ color: "#666" }}>
          Every registered citizen gets a tamper-evident Digital ID Card — all
          your details, your biometric enrollment and a SHA-256 proof of the
          card's exact content, in one mParivahan-style card.
        </p>
        {msg && (
          <p style={{ color: msgIsError ? "var(--color-danger)" : "var(--color-success)" }}>
            {msg}
          </p>
        )}
        <button className="btn btn-success" onClick={issue} disabled={busy}>
          {busy
            ? "Hashing the card and recording it…"
            : "Issue My Digital ID Card"}
        </button>
      </div>
    );
  }

  const row = (label: string, value?: string | null) =>
    value ? (
      <div
        key={label}
        style={{ display: "flex", gap: 6, fontSize: 12.5, lineHeight: 1.5 }}
      >
        <span style={{ color: "#78909c", minWidth: 92, fontWeight: 700 }}>
          {label}
        </span>
        <span style={{ color: "#263238", wordBreak: "break-all" }}>
          {value}
        </span>
      </div>
    ) : null;

  return (
    <div style={{ maxWidth: 720, margin: "0 auto 1.5rem" }}>
      {/* ---------- THE CARD ---------- */}
      <div
        style={{
          borderRadius: 16,
          overflow: "hidden",
          border: "1px solid var(--color-border-light)",
          boxShadow: "0 4px 18px rgba(30,90,168,0.18)",
        }}
      >
        {/* tricolor + header */}
        <div style={{ display: "flex", height: 5 }}>
          <div style={{ flex: 1, background: "#ff9933" }} />
          <div style={{ flex: 1, background: "#ffffff" }} />
          <div style={{ flex: 1, background: "#138808" }} />
        </div>
        <div
          style={{
            background: "var(--color-cyan-dark)",
            color: "#fff",
            padding: "10px 18px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: 0.5 }}>
              भारत गणराज्य · REPUBLIC OF INDIA
            </div>
            <div style={{ fontSize: 11, opacity: 0.85 }}>
              Digital Citizen Identity Card · BioChain RTO (mParivahan-style)
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: 11, opacity: 0.9 }}>
            <div style={{ fontWeight: 700 }}>BIOCHAIN RTO</div>
            <div>Digital India Initiative</div>
          </div>
        </div>

        {/* body */}
        <div
          style={{
            background: "#fff",
            padding: "16px 18px",
            display: "flex",
            gap: 18,
          }}
        >
          {/* left: photo + biometric */}
          <div style={{ width: 120, flexShrink: 0, textAlign: "center" }}>
            <div
              style={{
                width: 96,
                height: 112,
                margin: "0 auto 8px",
                borderRadius: 8,
                overflow: "hidden",
                border: "2px solid var(--color-cyan-dark)",
                background: "linear-gradient(135deg,#1e5aa8,#16437e)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt="holder"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span
                  style={{ color: "#fff", fontSize: "2.2rem", fontWeight: 800 }}
                >
                  {(card.holder.name || "?").charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <div
              style={{
                border: "1px dashed #90a4ae",
                borderRadius: 8,
                padding: "4px 2px",
              }}
              title="Simulated fingerprint pattern generated from this holder's biometric template"
            >
              <FingerprintGlyph seed={card.biometric?.fingerprintSeed} />
              <div style={{ fontSize: 9.5, color: "#607d8b", fontWeight: 700 }}>
                BIOMETRIC {card.biometric?.enrolled ? "ENROLLED" : "—"}
              </div>
            </div>
          </div>

          {/* right: identity data */}
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: 20,
                fontWeight: 800,
                color: "var(--color-cyan-dark)",
              }}
            >
              {card.holder.name}
            </div>
            <div style={{ margin: "2px 0 8px" }}>
              <span
                style={{
                  background: "var(--color-bg-tertiary)",
                  color: "var(--color-cyan-dark)",
                  borderRadius: 12,
                  padding: "2px 10px",
                  fontSize: 11.5,
                  fontWeight: 700,
                }}
              >
                {ROLE_LABELS[card.holder.role] || card.holder.role}
              </span>
              <span
                style={{
                  marginLeft: 8,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: "#455a64",
                }}
              >
                {card.cardNumber} · v{card.version}
              </span>
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "2px 16px",
              }}
            >
              {row("Aadhaar", card.identifiers?.aadhaarMasked)}
              {row("DL Number", card.identifiers?.dlNumber)}
              {row("Badge No.", card.identifiers?.badgeNumber)}
              {row("Employee ID", card.identifiers?.employeeId)}
              {row("GSTIN", card.identifiers?.gstin)}
              {row("Organisation", card.identifiers?.organization)}
              {row("Phone", card.holder.phone)}
              {row(
                "State",
                stateName(resolveStateCode(card.holder.state)) || "Not recorded",
              )}
              {row("District", card.holder.district)}
              {row(
                "DID",
                shortDid(card.identifiers?.did || card.identifiers?.biochainDid),
              )}
              {row("Wallet", short(card.identifiers?.walletAddress))}
            </div>
            {card.holder.address && (
              <div style={{ fontSize: 12, color: "#263238", marginTop: 6 }}>
                <span style={{ color: "#78909c", fontWeight: 700 }}>
                  Address:{" "}
                </span>
                {card.holder.address}
              </div>
            )}
            {(card.kyc?.documentType || card.kyc?.extractedViaOcr) && (
              <div style={{ marginTop: 8, fontSize: 11.5 }}>
                <span
                  style={{
                    background: "#e8f5e9",
                    color: "var(--color-success)",
                    borderRadius: 10,
                    padding: "2px 8px",
                    fontWeight: 700,
                  }}
                >
                  KYC: {card.kyc.documentType || "document"}
                  {card.kyc.extractedViaOcr
                    ? " · fields auto-extracted via OCR"
                    : ""}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* anchor footer */}
        <div
          style={{
            background: "#f5f5f5",
            borderTop: "1px solid #e0e0e0",
            padding: "10px 18px",
            display: "flex",
            flexWrap: "wrap",
            gap: 10,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <div style={{ fontSize: 11, color: "#616161" }}>
            Issued {formatDateTime(card.issuedAt)} · Hash{" "}
            <code title={card.anchor?.recordHash}>
              {short(card.anchor?.recordHash, 8)}
            </code>{" "}
            {card.anchor?.txHash
              ? "committed on Polygon Amoy"
              : "recorded on this card; the chain commitment is awaiting its transaction fee"}
          </div>
          <ViewTransactionButton
            txHash={card.anchor?.txHash}
            status={card.anchor?.status}
            label="View Card Anchoring Tx"
            className="btn btn-sm btn-outline-success"
          />
        </div>
      </div>

      {/* ---------- actions under the card ---------- */}
      {outOfDate.length > 0 && (
        <p
          style={{
            textAlign: "center",
            fontSize: 12.5,
            color: "var(--color-warning)",
            marginTop: 10,
          }}
        >
          Some account details are newer than this card: {outOfDate.join(", ")}.
          Re-issue below to add them — a new version is created and hashed, and
          the previous one stays exactly as it was.
        </p>
      )}
      {msg && (
        <p
          style={{
            textAlign: "center",
            fontSize: 13,
            color: msgIsError
              ? "var(--color-danger)"
              : "var(--color-success)",
            marginTop: 10,
          }}
        >
          {msg}
        </p>
      )}
      <div
        style={{
          display: "flex",
          gap: 10,
          justifyContent: "center",
          marginTop: 10,
        }}
      >
        <button
          className="btn btn-primary btn-sm"
          onClick={verify}
          disabled={busy}
        >
          Verify Card Integrity
        </button>
        <button
          className="btn btn-outline-secondary btn-sm"
          onClick={issue}
          disabled={busy}
          title="Creates a new version with your latest profile data, hashes it, and records the hash"
        >
          Re-issue with Latest Details
        </button>
      </div>
    </div>
  );
}
