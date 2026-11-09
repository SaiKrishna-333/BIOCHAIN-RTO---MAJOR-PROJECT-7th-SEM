// IncomingOffers.tsx
// Buyer (Owner B) view of resale offers sent by vehicle owners.
// Shows the FULL vehicle intelligence bundled by the seller's authorized
// workshop before a decision. Accept = demo payment + biometric
// verification, exactly like the existing buy flow - then the RTO
// finalizes and every record follows the vehicle to the new owner.
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import DualBiometricVerification from "./DualBiometricVerification";
import DemoPaymentModal from "./DemoPaymentModal";
import { formatDate, formatMoney } from "../lib/display";

interface Offer {
  _id: string;
  createdAt: string;
  vehicle: {
    _id: string;
    regNumber?: string;
    make: string;
    model?: string;
    year?: number;
    fuelType?: string;
  } | null;
  seller: { name: string; email: string; phone?: string } | null;
  offer: {
    salePrice?: number;
    message?: string;
    attachIntel?: boolean;
    buyerAccepted?: boolean;
    buyerAcceptedAt?: string;
  };
  intel: {
    serviceRecords: number;
    latestService: { date: string; odometerKm: number; type: string } | null;
    partsTracked: number;
    damageEvents: number;
    battery: { currentSoH: number | null; lastTestedAt: string | null } | null;
  } | null;
}

export default function IncomingOffers() {
  const { user, api } = useAuth();
  const navigate = useNavigate();

  const [offers, setOffers] = useState<Offer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [payOffer, setPayOffer] = useState<Offer | null>(null);
  const [bioOffer, setBioOffer] = useState<Offer | null>(null);
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const fetchOffers = useCallback(async () => {
    try {
      const res = await api.get("/requests/incoming-offers");
      setOffers(res.data.offers || []);
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Failed to load offers",
      );
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchOffers();
  }, [fetchOffers]);

  const acceptAfterBiometric = async () => {
    if (!bioOffer) return;
    setBusy(bioOffer._id);
    try {
      const res = await api.post(`/requests/${bioOffer._id}/accept-buyer`, {
        paymentMode: "Demo Payment",
      });
      setMessage(res.data.message);
      setBioOffer(null);
      await fetchOffers();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not accept the offer",
      );
    } finally {
      setBusy(null);
    }
  };

  const decline = async (id: string) => {
    setBusy(id);
    try {
      const res = await api.post(`/requests/${id}/decline-buyer`, {
        reason: declineReason || undefined,
      });
      setMessage(res.data.message);
      setDecliningId(null);
      setDeclineReason("");
      await fetchOffers();
    } catch (err: unknown) {
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || "Could not decline the offer",
      );
    } finally {
      setBusy(null);
    }
  };

  if (loading) return <p>Loading incoming offers…</p>;

  return (
    <div>
      <h4 style={{ marginTop: 0 }}>Incoming Vehicle Purchase Offers</h4>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "0.9rem" }}>
        Everything below was uploaded by the authorized workshop for this
        vehicle and is delivered with the offer. Accept + pay + biometric verify
        - the RTO then finalizes the transfer and this history becomes part of
        YOUR vehicle record.
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

      {offers.length === 0 && (
        <div className="alert alert-secondary">
          No pending purchase offers right now.
        </div>
      )}

      {offers.map((o) => (
        <div
          key={o._id}
          className="card"
          style={{
            padding: 18,
            marginTop: 12,
            borderLeft: "4px solid var(--color-cyan-dark)",
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
              {o.vehicle?.regNumber || "Vehicle"} — {o.vehicle?.make}{" "}
              {o.vehicle?.model} ({o.vehicle?.year})
              {o.vehicle?.fuelType === "Electric" ? " " : ""}
            </strong>
            {o.offer.buyerAccepted ? (
              <span className="badge bg-success">
                You accepted — awaiting RTO approval
              </span>
            ) : (
              <span className="badge bg-warning text-dark">
                Offer from {formatDate(o.createdAt)}
              </span>
            )}
          </div>

          <p style={{ fontSize: "0.9rem", margin: "8px 0 4px" }}>
            Seller: <strong>{o.seller?.name}</strong> ({o.seller?.email})
            {o.offer.salePrice != null && (
              <>
                {" "}
                · Asking price:{" "}
                <strong>₹{formatMoney(o.offer.salePrice)}</strong>
              </>
            )}
          </p>
          {o.offer.message && (
            <p
              style={{
                fontStyle: "italic",
                color: "var(--color-text-secondary)",
                fontSize: "0.9rem",
              }}
            >
              “{o.offer.message}”
            </p>
          )}

          {/* Bundled vehicle intelligence */}
          <div style={{ margin: "10px 0" }}>
            <strong style={{ fontSize: "0.85rem" }}>
              Verified vehicle intelligence:
            </strong>{" "}
            {o.intel ? (
              <>
                <span className="intel-chip">
                  {o.intel.serviceRecords} service record(s)
                </span>
                {o.intel.latestService && (
                  <span className="intel-chip">
                    Odometer{" "}
                    {formatMoney(o.intel.latestService.odometerKm)} km @{" "}
                    {formatDate(o.intel.latestService.date)}
                  </span>
                )}
                <span className="intel-chip">
                  {o.intel.partsTracked} part(s) tracked
                </span>
                <span
                  className={`intel-chip ${o.intel.damageEvents > 0 ? "chip-warn" : ""}`}
                >
                  {o.intel.damageEvents} damage event(s)
                </span>
                {o.intel.battery && (
                  <span className="intel-chip">
                    Battery SOH{" "}
                    {o.intel.battery.currentSoH != null
                      ? `${o.intel.battery.currentSoH}%`
                      : "pending"}
                  </span>
                )}
              </>
            ) : (
              <span
                style={{
                  color: "var(--color-text-muted)",
                  fontSize: "0.85rem",
                }}
              >
                Seller attached no workshop report.
              </span>
            )}
          </div>

          <div
            style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}
          >
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => navigate(`/vehicle-history/${o.vehicle?._id}`)}
            >
              Inspect Full History & Documents
            </button>
            {!o.offer.buyerAccepted && (
              <>
                <button
                  className="btn btn-success btn-sm"
                  disabled={busy === o._id}
                  onClick={() => setPayOffer(o)}
                >
                  Accept & Pay
                </button>
                <button
                  className="btn btn-outline-danger btn-sm"
                  disabled={busy === o._id}
                  onClick={() =>
                    setDecliningId(decliningId === o._id ? null : o._id)
                  }
                >
                  Decline
                </button>
              </>
            )}
          </div>

          {decliningId === o._id && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                className="form-control form-control-sm"
                placeholder="Reason (optional)"
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                style={{ maxWidth: 300 }}
              />
              <button
                className="btn btn-danger btn-sm"
                disabled={busy === o._id}
                onClick={() => decline(o._id)}
              >
                Confirm Decline
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Step 1: demo payment */}
      <DemoPaymentModal
        isOpen={!!payOffer}
        onClose={() => setPayOffer(null)}
        amount={payOffer?.offer.salePrice || 0}
        title="Pay for Vehicle Purchase"
        description={
          payOffer
            ? `${payOffer.vehicle?.make} ${payOffer.vehicle?.model} from ${payOffer.seller?.name}`
            : ""
        }
        onSuccess={() => {
          const o = payOffer;
          setPayOffer(null);
          setBioOffer(o);
        }}
      />

      {/* Step 2: buyer biometric confirmation */}
      <DualBiometricVerification
        isOpen={!!bioOffer}
        onClose={() => setBioOffer(null)}
        onSuccess={acceptAfterBiometric}
        person1Name={user?.name || "Buyer"}
        person1Role="owner"
        person2Name={bioOffer?.seller?.name || "Seller"}
        person2Role="owner"
        transactionType="ownership-transfer"
      />
    </div>
  );
}
