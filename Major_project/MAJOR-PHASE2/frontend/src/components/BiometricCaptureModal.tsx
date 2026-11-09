import { useState, useEffect } from "react";
import { formatDateTime } from "../lib/display";

interface BiometricCaptureModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (biometricData: {
    templateId: string;
    timestamp: string;
    quality: number;
  }) => void;
  personName: string;
  personRole: string;
  step?: number;
  totalSteps?: number;
  instructionText?: string;
  disableClose?: boolean;
}

export default function BiometricCaptureModal({
  isOpen,
  onClose,
  onSuccess,
  personName,
  personRole,
  step = 1,
  totalSteps = 1,
  instructionText,
  disableClose = false,
}: BiometricCaptureModalProps) {
  const [captureState, setCaptureState] = useState<
    "idle" | "positioning" | "scanning" | "processing" | "success" | "failed"
  >("idle");
  const [scanProgress, setScanProgress] = useState(0);
  const [qualityScore, setQualityScore] = useState(0);
  const [templateId, setTemplateId] = useState("");

  useEffect(() => {
    if (isOpen && captureState === "idle") {
      // Auto-start positioning after a brief delay
      const timer = setTimeout(() => {
        setCaptureState("positioning");
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [isOpen, captureState]);

  useEffect(() => {
    if (captureState === "positioning") {
      // Wait 2 seconds for "positioning", then start scanning
      const timer = setTimeout(() => {
        setCaptureState("scanning");
        setScanProgress(0);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [captureState]);

  useEffect(() => {
    if (captureState === "scanning") {
      // Progress reads the elapsed time, not the number of ticks. A browser
      // slows timers down in a background window, and a step counter would then
      // leave a citizen standing at 18% with no scanner movement for minutes.
      // Measured against the clock, the scan always reads 100% three seconds
      // after it began, whenever the next tick happens to arrive.
      const SCAN_MS = 3000;
      const startedAt = Date.now();
      const interval = setInterval(() => {
        const pct = Math.min(
          100,
          Math.round(((Date.now() - startedAt) / SCAN_MS) * 100),
        );
        setScanProgress(pct);
      }, 60);
      const finish = setTimeout(() => {
        clearInterval(interval);
        setScanProgress(100);
        setCaptureState("processing");
      }, SCAN_MS + 120);
      return () => {
        clearInterval(interval);
        clearTimeout(finish);
      };
    }
  }, [captureState]);

  useEffect(() => {
    if (captureState === "processing") {
      // Simulate processing delay
      const timer = setTimeout(() => {
        // The capture is simulated, and this simulation always completes: a
        // random rejection would make an enrollment demo fail on a whim while
        // proving nothing about the registry. The quality score is random
        // because a real reader reports one per swipe.
        const success = true; // Always succeed in simulation mode
        const quality = Math.floor(Math.random() * 20) + 80; // 80-100
        const template = `bio_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        setQualityScore(quality);
        setTemplateId(template);

        if (success) {
          setCaptureState("success");
          setTimeout(() => {
            onSuccess({
              templateId: template,
              timestamp: new Date().toISOString(),
              quality: quality,
            });
          }, 1500);
        } else {
          setCaptureState("failed");
        }
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [captureState, onSuccess]);

  const handleRetry = () => {
    setCaptureState("idle");
    setScanProgress(0);
    setQualityScore(0);
    setTemplateId("");
  };

  const handleClose = () => {
    setCaptureState("idle");
    setScanProgress(0);
    setQualityScore(0);
    setTemplateId("");
    onClose();
  };

  if (!isOpen) return null;

  const defaultInstruction =
    instructionText ||
    `Place your ${personRole === "dealer" ? "right" : "left"} index finger on the biometric scanner`;

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0, 0, 0, 0.7)",
        backdropFilter: "blur(8px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        animation: "fadeIn 0.3s ease-in-out",
      }}
    >
      <div
        style={{
          background:
            "linear-gradient(135deg, #0B1120 0%, #1a2332 50%, #0B1120 100%)",
          borderRadius: "20px",
          padding: "40px",
          maxWidth: "500px",
          width: "90%",
          boxShadow:
            "0 20px 60px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(0, 212, 255, 0.2)",
          animation: "slideUp 0.4s ease-out",
          position: "relative",
          border: "1px solid rgba(0, 212, 255, 0.3)",
        }}
      >
        {/* Close Button */}
        {captureState === "idle" && !disableClose && (
          <button
            onClick={handleClose}
            style={{
              position: "absolute",
              top: "15px",
              right: "15px",
              background: "rgba(255, 255, 255, 0.2)",
              border: "none",
              borderRadius: "50%",
              width: "35px",
              height: "35px",
              color: "white",
              fontSize: "1.5rem",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            ×
          </button>
        )}

        {/* Step Indicator */}
        {totalSteps > 1 && (
          <div
            style={{
              textAlign: "center",
              marginBottom: "20px",
              color: "rgba(255, 255, 255, 0.8)",
              fontSize: "0.9rem",
            }}
          >
            Step {step} of {totalSteps}
          </div>
        )}

        {/* Person Info */}
        <div
          style={{
            background: "rgba(0, 212, 255, 0.1)",
            borderRadius: "12px",
            padding: "15px",
            marginBottom: "25px",
            textAlign: "center",
            border: "1px solid rgba(0, 212, 255, 0.2)",
          }}
        >
          <div style={{ fontSize: "2rem", marginBottom: "8px" }}>
            {personRole === "dealer"
              ? ""
              : personRole === "owner"
                ? ""
                : personRole === "rto"
                  ? ""
                  : ""}
          </div>
          <div
            style={{
              color: "white",
              fontSize: "1.3rem",
              fontWeight: "bold",
              marginBottom: "5px",
            }}
          >
            {personName}
          </div>
          <div
            style={{
              color: "rgba(255, 255, 255, 0.8)",
              fontSize: "0.9rem",
              textTransform: "uppercase",
              letterSpacing: "1px",
            }}
          >
            {personRole.toUpperCase()}
          </div>
        </div>

        {/* Biometric Scanner Animation */}
        <div
          style={{
            background: "rgba(11, 17, 32, 0.95)",
            borderRadius: "15px",
            padding: "30px",
            marginBottom: "25px",
            textAlign: "center",
            border: "1px solid rgba(0, 212, 255, 0.2)",
          }}
        >
          {captureState === "positioning" && (
            <>
              <div
                style={{
                  width: "150px",
                  height: "180px",
                  margin: "0 auto 20px",
                  position: "relative",
                  border: "3px dashed #667eea",
                  borderRadius: "15px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  animation: "pulse 1.5s infinite",
                }}
              >
                <span style={{ fontSize: "2rem", fontWeight: 700 }}>SCAN</span>
              </div>
              <p
                style={{
                  color: "#F9FAFB",
                  fontSize: "1rem",
                  fontWeight: "600",
                  margin: "10px 0",
                }}
              >
                {defaultInstruction}
              </p>
              <p style={{ color: "#9CA3AF", fontSize: "0.85rem" }}>
                Please position your finger correctly on the scanner
              </p>
            </>
          )}

          {captureState === "scanning" && (
            <>
              <div
                style={{
                  width: "150px",
                  height: "180px",
                  margin: "0 auto 20px",
                  position: "relative",
                  border: "3px solid #667eea",
                  borderRadius: "15px",
                  overflow: "hidden",
                  background: "#0a0e27",
                }}
              >
                {/* Realistic Fingerprint Ridge Pattern Animation */}
                <svg
                  width="150"
                  height="180"
                  viewBox="0 0 150 180"
                  style={{
                    position: "absolute",
                    top: "50%",
                    left: "50%",
                    transform: "translate(-50%, -50%)",
                    opacity: 0.9,
                  }}
                >
                  {/* Concentric fingerprint ridges (ovals) */}
                  {[...Array(12)].map((_, i) => (
                    <ellipse
                      key={`ridge-${i}`}
                      cx="75"
                      cy="90"
                      rx={12 + i * 5}
                      ry={18 + i * 6}
                      fill="none"
                      stroke="#667eea"
                      strokeWidth="1.5"
                      opacity={
                        scanProgress > i * 8
                          ? 0.3 + (scanProgress - i * 8) / 100
                          : 0
                      }
                      style={{
                        transition: "opacity 0.3s ease",
                      }}
                    />
                  ))}

                  {/* Vertical ridge lines */}
                  {[...Array(8)].map((_, i) => (
                    <line
                      key={`v-${i}`}
                      x1={28 + i * 13}
                      y1="20"
                      x2={28 + i * 13}
                      y2="160"
                      stroke="#667eea"
                      strokeWidth="1"
                      strokeDasharray="3,2"
                      opacity={scanProgress > 10 + i * 10 ? 0.5 : 0}
                      style={{
                        transition: "opacity 0.3s ease",
                      }}
                    />
                  ))}

                  {/* Horizontal ridge lines */}
                  {[...Array(10)].map((_, i) => (
                    <line
                      key={`h-${i}`}
                      x1="20"
                      y1={22 + i * 15}
                      x2="130"
                      y2={22 + i * 15}
                      stroke="#667eea"
                      strokeWidth="1"
                      strokeDasharray="4,2"
                      opacity={scanProgress > 15 + i * 8 ? 0.5 : 0}
                      style={{
                        transition: "opacity 0.3s ease",
                      }}
                    />
                  ))}

                  {/* Core pattern (center swirl - distinctive fingerprint feature) */}
                  <path
                    d="M 75 65 Q 88 75, 75 90 Q 62 105, 75 115"
                    fill="none"
                    stroke="#764ba2"
                    strokeWidth="2.5"
                    opacity={scanProgress > 50 ? 0.7 : 0}
                    style={{
                      transition: "opacity 0.5s ease",
                    }}
                  />
                  <path
                    d="M 75 72 Q 84 82, 75 95 Q 66 108, 75 108"
                    fill="none"
                    stroke="#764ba2"
                    strokeWidth="2"
                    opacity={scanProgress > 60 ? 0.6 : 0}
                    style={{
                      transition: "opacity 0.5s ease",
                    }}
                  />
                  <path
                    d="M 75 78 Q 80 86, 75 98 Q 70 106, 75 102"
                    fill="none"
                    stroke="#00ff88"
                    strokeWidth="1.5"
                    opacity={scanProgress > 70 ? 0.8 : 0}
                    style={{
                      transition: "opacity 0.5s ease",
                    }}
                  />
                </svg>

                {/* Scanning line animation */}
                <div
                  style={{
                    position: "absolute",
                    top: `${scanProgress}%`,
                    left: 0,
                    right: 0,
                    height: "3px",
                    background:
                      "linear-gradient(90deg, transparent, #00ff88, transparent)",
                    boxShadow: "0 0 15px #00ff88, 0 0 30px #00ff88",
                    transition: "top 0.06s linear",
                  }}
                />

                {/* Scan area overlay */}
                <div
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    height: `${scanProgress}%`,
                    background:
                      "linear-gradient(180deg, rgba(0, 255, 136, 0.15), transparent)",
                  }}
                />
              </div>

              {/* Progress Bar */}
              <div
                style={{
                  width: "100%",
                  height: "8px",
                  background: "#e0e0e0",
                  borderRadius: "4px",
                  overflow: "hidden",
                  marginBottom: "15px",
                }}
              >
                <div
                  style={{
                    width: `${scanProgress}%`,
                    height: "100%",
                    background: "linear-gradient(90deg, #00D4FF, #00a8cc)",
                    transition: "width 0.06s linear",
                    borderRadius: "4px",
                  }}
                />
              </div>

              <p
                style={{
                  color: "#F9FAFB",
                  fontSize: "1rem",
                  fontWeight: "600",
                  margin: "10px 0",
                }}
              >
                Capturing Biometric Data...
              </p>
              <p style={{ color: "#9CA3AF", fontSize: "0.85rem" }}>
                {scanProgress}% complete
              </p>
            </>
          )}

          {captureState === "processing" && (
            <>
              <div
                style={{
                  width: "100px",
                  height: "100px",
                  margin: "0 auto 20px",
                  border: "5px solid #f3f3f3",
                  borderTop: "5px solid #667eea",
                  borderRadius: "50%",
                  animation: "spin 1s linear infinite",
                }}
              />
              <p
                style={{
                  color: "#F9FAFB",
                  fontSize: "1rem",
                  fontWeight: "600",
                  margin: "10px 0",
                }}
              >
                Processing Biometric Template...
              </p>
              <p style={{ color: "#9CA3AF", fontSize: "0.85rem" }}>
                Extracting minutiae points and generating secure hash
              </p>
            </>
          )}

          {captureState === "success" && (
            <>
              <div
                style={{
                  width: "100px",
                  height: "100px",
                  margin: "0 auto 20px",
                  background: "linear-gradient(135deg, #0e7c3b, #14854a)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "1.5rem",
                  fontWeight: "bold",
                  letterSpacing: "1px",
                  color: "#ffffff",
                  animation: "scaleIn 0.5s ease-out",
                }}
              >
                OK
              </div>
              <p
                style={{
                  color: "#00D4FF",
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                  margin: "10px 0",
                }}
              >
                Biometric Captured Successfully
              </p>
              <div
                style={{
                  background: "rgba(0, 212, 255, 0.1)",
                  borderRadius: "8px",
                  padding: "12px",
                  marginTop: "15px",
                  border: "1px solid rgba(0, 212, 255, 0.2)",
                }}
              >
                <p
                  style={{
                    color: "#F9FAFB",
                    fontSize: "0.85rem",
                    margin: "5px 0",
                  }}
                >
                  <strong>Quality Score:</strong> {qualityScore}%
                </p>
                <p
                  style={{
                    color: "#F9FAFB",
                    fontSize: "0.85rem",
                    margin: "5px 0",
                  }}
                >
                  <strong>Template ID:</strong> {templateId.substring(0, 20)}...
                </p>
                <p
                  style={{
                    color: "#F9FAFB",
                    fontSize: "0.85rem",
                    margin: "5px 0",
                  }}
                >
                  <strong>Timestamp:</strong> {formatDateTime(new Date())}
                </p>
              </div>
            </>
          )}

          {captureState === "failed" && (
            <>
              <div
                style={{
                  width: "100px",
                  height: "100px",
                  margin: "0 auto 20px",
                  background: "linear-gradient(135deg, #b91c1c, #d33b2f)",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "3.5rem",
                  color: "white",
                  animation: "shake 0.5s ease-in-out",
                }}
              ></div>
              <p
                style={{
                  color: "#eb3349",
                  fontSize: "1.2rem",
                  fontWeight: "bold",
                  margin: "10px 0",
                }}
              >
                Biometric Capture Failed
              </p>
              <p
                style={{ color: "#666", fontSize: "0.9rem", margin: "10px 0" }}
              >
                Please ensure proper finger placement and try again
              </p>
              <button
                onClick={handleRetry}
                style={{
                  marginTop: "15px",
                  padding: "10px 25px",
                  background: "linear-gradient(135deg, #00D4FF, #00a8cc)",
                  color: "white",
                  border: "none",
                  borderRadius: "8px",
                  fontSize: "1rem",
                  fontWeight: "600",
                  cursor: "pointer",
                }}
              >
                Retry
              </button>
            </>
          )}
        </div>

        {/* Status Message */}
        <div
          style={{
            textAlign: "center",
            color: "rgba(255, 255, 255, 0.9)",
            fontSize: "0.9rem",
          }}
        >
          {captureState === "positioning" && "Awaiting biometric input..."}
          {captureState === "scanning" && "Capturing biometric data..."}
          {captureState === "processing" && "Processing biometric template..."}
          {captureState === "success" && "Biometric enrolled successfully"}
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideUp {
          from {
            opacity: 0;
            transform: translateY(50px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes pulse {
          0%, 100% {
            transform: scale(1);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
            opacity: 0.8;
          }
        }
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
  );
}
