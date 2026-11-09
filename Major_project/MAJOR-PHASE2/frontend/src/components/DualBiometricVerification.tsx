import { useState } from "react";
import BiometricCaptureModal from "./BiometricCaptureModal";

interface BiometricData {
  templateId: string;
  timestamp: string;
  quality: number;
}

interface DualBiometricVerificationProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  person1Name: string;
  person1Role: string;
  person2Name: string;
  person2Role: string;
  transactionType: string; // "vehicle-sale", "ownership-transfer", etc.
}

export default function DualBiometricVerification({
  isOpen,
  onClose,
  onSuccess,
  person1Name,
  person1Role,
  person2Name,
  person2Role,
  transactionType,
}: DualBiometricVerificationProps) {
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [biometric1, setBiometric1] = useState<BiometricData | null>(null);
  const [biometric2, setBiometric2] = useState<BiometricData | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [matchResult, setMatchResult] = useState<
    "pending" | "success" | "failed"
  >("pending");

  const handlePerson1Complete = (data: BiometricData) => {
    setBiometric1(data);
    setTimeout(() => {
      setCurrentStep(2);
    }, 1000);
  };

  const handlePerson2Complete = (data: BiometricData) => {
    setBiometric2(data);
    // Start verification
    setIsVerifying(true);
    setCurrentStep(3);

    // Simulate biometric matching
    setTimeout(() => {
      const match = Math.random() > 0.1; // 90% success rate for demo
      setMatchResult(match ? "success" : "failed");

      if (match) {
        setTimeout(() => {
          onSuccess();
        }, 2000);
      }
    }, 3000);
  };

  const handleClose = () => {
    setCurrentStep(1);
    setBiometric1(null);
    setBiometric2(null);
    setIsVerifying(false);
    setMatchResult("pending");
    onClose();
  };

  const getTransactionLabel = () => {
    switch (transactionType) {
      case "vehicle-sale":
        return "New Vehicle Sale";
      case "ownership-transfer":
        return "Ownership Transfer";
      case "inheritance":
        return "Inheritance Transfer";
      default:
        return "Biometric Verification";
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(10px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9998,
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "20px",
          padding: "40px",
          maxWidth: "600px",
          width: "90%",
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: "0 25px 70px rgba(0, 0, 0, 0.6)",
        }}
      >
        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "30px" }}>
          <h2
            style={{
              margin: "0 0 10px 0",
              color: "var(--color-cyan-dark)",
              fontSize: "1.5rem",
              fontWeight: "bold",
            }}
          >
            {getTransactionLabel()}
          </h2>
          <p style={{ color: "#666", margin: "5px 0", fontSize: "0.9rem" }}>
            Biometric verification required for all parties
          </p>

          {/* Progress Steps */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "15px",
              marginTop: "20px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                opacity: currentStep >= 1 ? 1 : 0.4,
              }}
            >
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  background:
                    currentStep > 1
                      ? "linear-gradient(135deg, #0e7c3b, #14854a)"
                      : currentStep === 1
                        ? "#1e5aa8"
                        : "#e0e0e0",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.9rem",
                  fontWeight: "bold",
                }}
              >
                {"1"}
              </div>
              <span style={{ fontSize: "0.8rem", color: "#666" }}>
                {person1Role}
              </span>
            </div>

            <div
              style={{
                width: "40px",
                height: "2px",
                background: currentStep >= 2 ? "#0e7c3b" : "#e0e0e0",
                alignSelf: "center",
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                opacity: currentStep >= 2 ? 1 : 0.4,
              }}
            >
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  background:
                    currentStep > 2
                      ? "linear-gradient(135deg, #0e7c3b, #14854a)"
                      : currentStep === 2
                        ? "#1e5aa8"
                        : "#e0e0e0",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.9rem",
                  fontWeight: "bold",
                }}
              >
                {"2"}
              </div>
              <span style={{ fontSize: "0.8rem", color: "#666" }}>
                {person2Role}
              </span>
            </div>

            <div
              style={{
                width: "40px",
                height: "2px",
                background: currentStep >= 3 ? "#0e7c3b" : "#e0e0e0",
                alignSelf: "center",
              }}
            />

            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                opacity: currentStep >= 3 ? 1 : 0.4,
              }}
            >
              <div
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "50%",
                  background:
                    matchResult === "success"
                      ? "linear-gradient(135deg, #0e7c3b, #14854a)"
                      : matchResult === "failed"
                        ? "#b91c1c"
                        : currentStep === 3
                          ? "#1e5aa8"
                          : "#e0e0e0",
                  color: "white",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.9rem",
                  fontWeight: "bold",
                }}
              >
                {matchResult === "failed" ? "×" : "3"}
              </div>
              <span style={{ fontSize: "0.8rem", color: "#666" }}>Verify</span>
            </div>
          </div>
        </div>

        {/* Step 1 & 2: Biometric Capture */}
        {(currentStep === 1 || currentStep === 2) && (
          <BiometricCaptureModal
            key={`step-${currentStep}-${currentStep === 1 ? person1Name : person2Name}`}
            isOpen={true}
            onClose={() => {}}
            onSuccess={
              currentStep === 1 ? handlePerson1Complete : handlePerson2Complete
            }
            personName={currentStep === 1 ? person1Name : person2Name}
            personRole={currentStep === 1 ? person1Role : person2Role}
            step={currentStep}
            totalSteps={3}
            instructionText={`Place your ${currentStep === 1 ? "right" : "left"} index finger on the scanner`}
            disableClose={true}
          />
        )}

        {/* Step 3: Verification */}
        {currentStep === 3 && (
          <div style={{ textAlign: "center" }}>
            {isVerifying && matchResult === "pending" && (
              <>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "20px",
                    marginBottom: "30px",
                  }}
                >
                  {/* Person 1 */}
                  <div
                    style={{
                      padding: "20px",
                      background: "#f5f5f5",
                      borderRadius: "12px",
                      minWidth: "150px",
                    }}
                  >
                    <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>
                      {person1Role === "dealer"
                        ? ""
                        : person1Role === "owner"
                          ? ""
                          : ""}
                    </div>
                    <p
                      style={{
                        margin: "5px 0",
                        fontWeight: "bold",
                        color: "#333",
                      }}
                    >
                      {person1Name}
                    </p>
                    <p
                      style={{
                        margin: "5px 0",
                        fontSize: "0.8rem",
                        color: "#666",
                      }}
                    >
                      {biometric1?.quality}% quality
                    </p>
                  </div>

                  {/* VS */}
                  <div
                    style={{
                      fontSize: "2rem",
                      fontWeight: "bold",
                      color: "#1e5aa8",
                    }}
                  >
                    ⟷
                  </div>

                  {/* Person 2 */}
                  <div
                    style={{
                      padding: "20px",
                      background: "#f5f5f5",
                      borderRadius: "12px",
                      minWidth: "150px",
                    }}
                  >
                    <div style={{ fontSize: "2.5rem", marginBottom: "10px" }}>
                      {person2Role === "dealer"
                        ? ""
                        : person2Role === "owner"
                          ? ""
                          : ""}
                    </div>
                    <p
                      style={{
                        margin: "5px 0",
                        fontWeight: "bold",
                        color: "#333",
                      }}
                    >
                      {person2Name}
                    </p>
                    <p
                      style={{
                        margin: "5px 0",
                        fontSize: "0.8rem",
                        color: "#666",
                      }}
                    >
                      {biometric2?.quality}% quality
                    </p>
                  </div>
                </div>

                {/* Processing Animation */}
                <div
                  style={{
                    width: "80px",
                    height: "80px",
                    margin: "0 auto 20px",
                    border: "5px solid #f3f3f3",
                    borderTop: "5px solid #1e5aa8",
                    borderRadius: "50%",
                    animation: "spin 1s linear infinite",
                  }}
                />
                <h3
                  style={{
                    color: "var(--color-cyan-dark)",
                    margin: "15px 0 10px",
                  }}
                >
                  Verifying Biometric Match...
                </h3>
                <p style={{ color: "#666", fontSize: "0.9rem" }}>
                  Comparing fingerprint templates and validating identity
                </p>
              </>
            )}

            {matchResult === "success" && (
              <>
                <div
                  style={{
                    width: "120px",
                    height: "120px",
                    margin: "0 auto 25px",
                    background: "linear-gradient(135deg, #0e7c3b, #14854a)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "1.6rem",
                    fontWeight: "bold",
                    letterSpacing: "1px",
                    color: "white",
                    animation: "scaleIn 0.5s ease-out",
                  }}
                >
                  OK
                </div>
                <h3
                  style={{
                    color: "#0e7c3b",
                    margin: "15px 0 10px",
                    fontSize: "1.5rem",
                  }}
                >
                  Biometric Match Confirmed
                </h3>
                <p
                  style={{
                    color: "#333",
                    fontSize: "1rem",
                    marginBottom: "20px",
                  }}
                >
                  Both parties have been successfully verified. Proceeding with{" "}
                  {getTransactionLabel().toLowerCase()}...
                </p>

                <div
                  style={{
                    background: "#e8f5e9",
                    borderRadius: "12px",
                    padding: "20px",
                    textAlign: "left",
                  }}
                >
                  <p style={{ margin: "8px 0", color: "#2e7d32" }}>
                    {person1Name} ({person1Role}) verified
                  </p>
                  <p style={{ margin: "8px 0", color: "#2e7d32" }}>
                    {person2Name} ({person2Role}) verified
                  </p>
                  <p
                    style={{
                      margin: "8px 0",
                      color: "#2e7d32",
                      fontWeight: "bold",
                    }}
                  >
                    Transaction authorized on blockchain
                  </p>
                </div>
              </>
            )}

            {matchResult === "failed" && (
              <>
                <div
                  style={{
                    width: "120px",
                    height: "120px",
                    margin: "0 auto 25px",
                    background: "linear-gradient(135deg, #b91c1c, #d33b2f)",
                    borderRadius: "50%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "4rem",
                    color: "white",
                    animation: "shake 0.5s ease-in-out",
                  }}
                >
                  ×
                </div>
                <h3
                  style={{
                    color: "#b91c1c",
                    margin: "15px 0 10px",
                    fontSize: "1.5rem",
                  }}
                >
                  Biometric Verification Failed
                </h3>
                <p
                  style={{
                    color: "#666",
                    fontSize: "1rem",
                    marginBottom: "20px",
                  }}
                >
                  Unable to match biometric templates. Please try again.
                </p>
                <button
                  onClick={handleClose}
                  style={{
                    padding: "12px 30px",
                    background: "linear-gradient(135deg, #1e5aa8, #16437e)",
                    color: "white",
                    border: "none",
                    borderRadius: "8px",
                    fontSize: "1rem",
                    fontWeight: "600",
                    cursor: "pointer",
                  }}
                >
                  Close
                </button>
              </>
            )}
          </div>
        )}

        {/* CSS Animations */}
        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          @keyframes scaleIn {
            0% {
              transform: scale(0);
              opacity: 0;
            }
            50% {
              transform: scale(1.1);
            }
            100% {
              transform: scale(1);
              opacity: 1;
            }
          }
          @keyframes shake {
            0%, 100% { transform: translateX(0); }
            25% { transform: translateX(-10px); }
            75% { transform: translateX(10px); }
          }
        `}</style>
      </div>
    </div>
  );
}
