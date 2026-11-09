// SentOffers.tsx
// Seller (Owner A) view of resale offers they sent to buyers.
// Shows the live state of each offer: awaiting buyer decision, buyer
// accepted (awaiting RTO), transferred, or declined - closing the loop
// of the intel-enhanced resale workflow for the sending side.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import { formatDate, formatDateTime, formatMoney } from "../lib/display";

interface SentOffer {
  _id: string;
  createdAt: string;
  status: string;
  state:
    | "awaiting-buyer"
    | "buyer-accepted"
    | "awaiting-rto"
    | "transferred"
    | "declined-by-buyer"
    | "rejected-by-rto";
  vehicle: {
    _id: string;
    regNumber?: string;
    make: string;
    model?: string;
    year?: number;
  } | null;
  buyer: { name: string; email: string } | null;
  offer: {
    salePrice?: number;
    message?: string;
    attachIntel?: boolean;
    buyerAccepted?: boolean;
    buyerAcceptedAt?: string;
  } | null;
  declineReason: string | null;
}

const STATE_BADGE: Record<SentOffer["state"], { label: string; cls: string }> =
  {
    "awaiting-buyer": {
      label: "Sent — awaiting buyer decision",
      cls: "badge bg-warning text-dark",
    },
    "buyer-accepted": {
      label: "Buyer accepted — awaiting RTO approval",
      cls: "badge bg-info text-dark",
    },
    "awaiting-rto": {
      label: "Submitted — awaiting RTO approval",
      cls: "badge bg-info text-dark",
    },
    transferred: { label: "Ownership transferred", cls: "badge bg-success" },
    "declined-by-buyer": {
      label: "Declined by buyer",
      cls: "badge bg-danger",
    },
    "rejected-by-rto": { label: "Rejected by RTO", cls: "badge bg-danger" },
  };

export default function SentOffers() {
  const { api } = useAuth();

  const [offers, setOffers] = useState<SentOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchSent = useCallback(async () => {
    try {
      const res = await api.get("/requests/my-offers");
      setOffers(res.data.offers || []);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Failed to load your sent offers",
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchSent();
  }, [fetchSent]);

  if (loading) return <p>Loading your sent offers…</p>;

  return (
    <div className="card" style={{ padding: 18, marginBottom: 16 }}>
      <h4 style={{ marginTop: 0 }}>Offers You Have Sent</h4>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
        Track what happens after you send a sale offer — the buyer's decision
        and the RTO's final approval appear here live.
      </p>

      {error && (
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      )}

      {offers.length === 0 && (
        <div className="alert alert-secondary">
          You have not sent any sale offers yet. Use{" "}
          <strong>Sell Vehicle</strong> in the My Vehicles tab to send one.
        </div>
      )}

      {offers.map((o) => {
        const badge = STATE_BADGE[o.state];
        return (
          <div
            key={o._id}
            style={{
              borderLeft: "4px solid var(--color-cyan-dark)",
              padding: "10px 12px",
              marginTop: 10,
              background: "rgba(30, 90, 168, 0.05)",
              borderRadius: 6,
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
                {o.vehicle?.regNumber || "Vehicle"} — {o.vehicle?.make}{" "}
                {o.vehicle?.model} ({o.vehicle?.year})
              </strong>
              <span className={badge.cls}>{badge.label}</span>
            </div>
            <p style={{ fontSize: "0.9rem", margin: "6px 0 0" }}>
              Buyer: <strong>{o.buyer?.name}</strong> ({o.buyer?.email}) · Sent{" "}
              {formatDate(o.createdAt)}
              {o.offer?.salePrice != null && (
                <>
                  {" "}
                  · Price:{" "}
                  <strong>₹{formatMoney(o.offer.salePrice)}</strong>
                </>
              )}
              {o.offer?.attachIntel && <> · intelligence attached</>}
            </p>
            {o.declineReason &&
              (o.state === "declined-by-buyer" ||
                o.state === "rejected-by-rto") && (
                <p
                  style={{
                    fontStyle: "italic",
                    color: "var(--color-danger)",
                    fontSize: "0.85rem",
                    margin: "4px 0 0",
                  }}
                >
                  Reason: {o.declineReason}
                </p>
              )}
            {o.offer?.buyerAcceptedAt && o.state !== "awaiting-buyer" && (
              <p
                style={{
                  color: "var(--color-text-secondary)",
                  fontSize: "0.85rem",
                  margin: "4px 0 0",
                }}
              >
                Buyer accepted on{" "}
                {formatDateTime(o.offer.buyerAcceptedAt)}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
