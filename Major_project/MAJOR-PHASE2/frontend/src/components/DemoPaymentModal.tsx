import { useState } from "react";
import { formatMoney } from "../lib/display";

interface DemoPaymentModalProps {
  isOpen: boolean;
  onClose: () => void;
  amount: number;
  title: string;
  description: string;
  onSuccess: () => void;
}

export default function DemoPaymentModal({
  isOpen,
  onClose,
  amount,
  title,
  description,
  onSuccess,
}: DemoPaymentModalProps) {
  const [step, setStep] = useState<"card" | "otp" | "success">("card");
  const [cardDetails, setCardDetails] = useState({
    cardNumber: "",
    cardHolder: "",
    expiryDate: "",
    cvv: "",
  });
  const [otp, setOtp] = useState("");
  const [processing, setProcessing] = useState(false);
  const [transactionId, setTransactionId] = useState("");

  if (!isOpen) return null;

  const formatCardNumber = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    const matches = v.match(/\d{4,16}/g);
    const match = (matches && matches[0]) || "";
    const parts = [];

    for (let i = 0, len = match.length; i < len; i += 4) {
      parts.push(match.substring(i, i + 4));
    }

    if (parts.length) {
      return parts.join(" ");
    } else {
      return v;
    }
  };

  const formatExpiryDate = (value: string) => {
    const v = value.replace(/\s+/g, "").replace(/[^0-9]/gi, "");
    if (v.length >= 2) {
      return v.substring(0, 2) + "/" + v.substring(2, 4);
    }
    return v;
  };

  const handleCardSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    // Simulate processing
    setTimeout(() => {
      setProcessing(false);
      setStep("otp");
    }, 1500);
  };

  const handleOTPSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setProcessing(true);

    // Simulate OTP verification
    setTimeout(() => {
      setProcessing(false);
      setStep("success");
      setTransactionId(`TXN${Date.now()}`);

      // Call success callback
      setTimeout(() => {
        onSuccess();
      }, 2000);
    }, 2000);
  };

  const handleClose = () => {
    setStep("card");
    setCardDetails({
      cardNumber: "",
      cardHolder: "",
      expiryDate: "",
      cvv: "",
    });
    setOtp("");
    onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.7)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 10000,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "12px",
          maxWidth: "450px",
          width: "90%",
          maxHeight: "90vh",
          overflow: "auto",
        }}
      >
        {/* Header */}
        <div
          style={{
            background:
              "linear-gradient(135deg, var(--color-cyan-dark) 0%, var(--color-cyan) 100%)",
            color: "white",
            padding: "20px",
            borderRadius: "12px 12px 0 0",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: "18px" }}>{title}</h3>
            <p style={{ margin: "5px 0 0", fontSize: "13px", opacity: 0.9 }}>
              {description}
            </p>
          </div>
          <button
            onClick={handleClose}
            style={{
              background: "rgba(255,255,255,0.2)",
              border: "none",
              color: "white",
              width: "30px",
              height: "30px",
              borderRadius: "50%",
              cursor: "pointer",
              fontSize: "18px",
            }}
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div style={{ padding: "20px" }}>
          {step === "card" && (
            <form onSubmit={handleCardSubmit}>
              {/* Amount Display */}
              <div
                style={{
                  background: "#f5f5f5",
                  padding: "15px",
                  borderRadius: "8px",
                  textAlign: "center",
                  marginBottom: "20px",
                }}
              >
                <div style={{ fontSize: "13px", color: "#666" }}>
                  Payment Amount
                </div>
                <div
                  style={{
                    fontSize: "32px",
                    fontWeight: "bold",
                    color: "var(--color-cyan-dark)",
                  }}
                >
                  ₹{formatMoney(amount)}
                </div>
              </div>

              {/* Card Number */}
              <div style={{ marginBottom: "15px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "5px",
                    fontSize: "13px",
                    fontWeight: "500",
                  }}
                >
                  Card Number
                </label>
                <input
                  type="text"
                  value={cardDetails.cardNumber}
                  onChange={(e) =>
                    setCardDetails({
                      ...cardDetails,
                      cardNumber: formatCardNumber(e.target.value),
                    })
                  }
                  maxLength={19}
                  placeholder="1234 5678 9012 3456"
                  required
                  style={{
                    width: "100%",
                    padding: "12px",
                    border: "2px solid #e0e0e0",
                    borderRadius: "6px",
                    fontSize: "16px",
                    letterSpacing: "2px",
                  }}
                />
              </div>

              {/* Card Holder */}
              <div style={{ marginBottom: "15px" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "5px",
                    fontSize: "13px",
                    fontWeight: "500",
                  }}
                >
                  Card Holder Name
                </label>
                <input
                  type="text"
                  value={cardDetails.cardHolder}
                  onChange={(e) =>
                    setCardDetails({
                      ...cardDetails,
                      cardHolder: e.target.value.toUpperCase(),
                    })
                  }
                  placeholder="JOHN DOE"
                  required
                  style={{
                    width: "100%",
                    padding: "12px",
                    border: "2px solid #e0e0e0",
                    borderRadius: "6px",
                    fontSize: "14px",
                  }}
                />
              </div>

              {/* Expiry & CVV */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "15px",
                  marginBottom: "15px",
                }}
              >
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "5px",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    Expiry Date
                  </label>
                  <input
                    type="text"
                    value={cardDetails.expiryDate}
                    onChange={(e) =>
                      setCardDetails({
                        ...cardDetails,
                        expiryDate: formatExpiryDate(e.target.value),
                      })
                    }
                    maxLength={5}
                    placeholder="MM/YY"
                    required
                    style={{
                      width: "100%",
                      padding: "12px",
                      border: "2px solid #e0e0e0",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </div>
                <div>
                  <label
                    style={{
                      display: "block",
                      marginBottom: "5px",
                      fontSize: "13px",
                      fontWeight: "500",
                    }}
                  >
                    CVV
                  </label>
                  <input
                    type="password"
                    value={cardDetails.cvv}
                    onChange={(e) =>
                      setCardDetails({
                        ...cardDetails,
                        cvv: e.target.value
                          .replace(/[^0-9]/g, "")
                          .substring(0, 3),
                      })
                    }
                    maxLength={3}
                    placeholder="123"
                    required
                    style={{
                      width: "100%",
                      padding: "12px",
                      border: "2px solid #e0e0e0",
                      borderRadius: "6px",
                      fontSize: "14px",
                    }}
                  />
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={processing}
                style={{
                  width: "100%",
                  padding: "14px",
                  background: processing
                    ? "#ccc"
                    : "linear-gradient(135deg, var(--color-cyan-dark) 0%, var(--color-cyan) 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "16px",
                  fontWeight: "bold",
                  cursor: processing ? "not-allowed" : "pointer",
                }}
              >
                {processing
                  ? "Processing..."
                  : `Pay ₹${formatMoney(amount)}`}
              </button>
            </form>
          )}

          {step === "otp" && (
            <form onSubmit={handleOTPSubmit}>
              <div style={{ textAlign: "center", marginBottom: "20px" }}>
                <div
                  style={{
                    fontSize: "20px",
                    marginBottom: "10px",
                    color: "#1e5aa8",
                    fontWeight: 700,
                    letterSpacing: "2px",
                  }}
                >
                  OTP
                </div>
                <h4 style={{ margin: "0 0 10px" }}>Enter OTP</h4>
                <p style={{ margin: 0, fontSize: "13px", color: "#666" }}>
                  OTP sent to your registered mobile number
                </p>
              </div>

              <div style={{ marginBottom: "20px" }}>
                <input
                  type="text"
                  value={otp}
                  onChange={(e) =>
                    setOtp(
                      e.target.value.replace(/[^0-9]/g, "").substring(0, 6),
                    )
                  }
                  maxLength={6}
                  placeholder="Enter 6-digit OTP"
                  required
                  style={{
                    width: "100%",
                    padding: "15px",
                    border: "2px solid var(--color-cyan-dark)",
                    borderRadius: "6px",
                    fontSize: "24px",
                    textAlign: "center",
                    letterSpacing: "8px",
                  }}
                />
              </div>

              <button
                type="submit"
                disabled={processing || otp.length !== 6}
                style={{
                  width: "100%",
                  padding: "14px",
                  background:
                    processing || otp.length !== 6
                      ? "#ccc"
                      : "linear-gradient(135deg, var(--color-cyan-dark) 0%, var(--color-cyan) 100%)",
                  color: "white",
                  border: "none",
                  borderRadius: "6px",
                  fontSize: "16px",
                  fontWeight: "bold",
                  cursor:
                    processing || otp.length !== 6 ? "not-allowed" : "pointer",
                }}
              >
                {processing ? "Verifying..." : "Verify & Pay"}
              </button>
            </form>
          )}

          {step === "success" && (
            <div style={{ textAlign: "center", padding: "20px 0" }}>
              <div
                style={{
                  width: "80px",
                  height: "80px",
                  borderRadius: "50%",
                  background:
                    "linear-gradient(135deg, #0e7c3b 0%, #14854a 100%)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  margin: "0 auto 20px",
                  fontSize: "1.5rem",
                  fontWeight: "bold",
                  color: "#ffffff",
                }}
              >
                PAID
              </div>
              <h3 style={{ margin: "0 0 10px", color: "#0e7c3b" }}>
                Payment Successful
              </h3>
              <p style={{ margin: "0 0 5px", fontSize: "14px", color: "#666" }}>
                Amount: <strong>₹{formatMoney(amount)}</strong>
              </p>
              <p style={{ margin: 0, fontSize: "13px", color: "#999" }}>
                Transaction ID: {transactionId}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "15px 20px",
            borderTop: "1px solid #e0e0e0",
            textAlign: "center",
            fontSize: "11px",
            color: "#999",
          }}
        >
          Secure Payment Gateway (Demo Mode)
        </div>
      </div>
    </div>
  );
}
