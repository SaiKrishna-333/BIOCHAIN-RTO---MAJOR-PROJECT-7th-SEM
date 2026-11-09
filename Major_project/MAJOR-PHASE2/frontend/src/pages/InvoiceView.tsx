import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import InvoiceTemplateModern from "../components/InvoiceTemplateModern";
import { notify } from "../lib/notify";

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;
  dealerName: string;
  dealerBusinessName: string;
  dealerGSTIN: string;
  dealerTIN: string;
  dealerLicense: string;
  dealerAddress: string;
  dealerPhone: string;
  dealerEmail: string;
  buyerName: string;
  buyerEmail: string;
  buyerAadhaar: string;
  buyerDL: string;
  buyerAddress: string;
  chassisNumber: string;
  engineNumber: string;
  make: string;
  model: string;
  year: number;
  exShowroomPrice: number;
  roadTax: number;
  registrationFee: number;
  insuranceAmount: number;
  handlingCharges: number;
  otherCharges: number;
  gstAmount: number;
  grandTotal: number;
  paymentMode: string;
  paymentStatus: string;
  verificationStatus: "pending" | "verified" | "rejected";
  verifiedBy?: string;
  verifiedAt?: string;
  verificationRemarks?: string;
  signatureHash?: string;
  blockchainTxHash?: string;
}

export default function InvoiceView() {
  const { requestId } = useParams<{ requestId: string }>();
  const { user, logout, api } = useAuth();
  const navigate = useNavigate();

  const [invoiceData, setInvoiceData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showVerifyModal, setShowVerifyModal] = useState(false);
  const [verifyRemarks, setVerifyRemarks] = useState("");
  const [verifyAction, setVerifyAction] = useState<"verified" | "rejected">(
    "verified",
  );

  const fetchInvoice = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/requests/${requestId}/invoice`);
      setInvoiceData(res.data);
      setError("");
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Failed to load invoice";
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [api, requestId]);

  useEffect(() => {
    fetchInvoice();
  }, [fetchInvoice]);

  const handleVerify = async () => {
    try {
      await api.put(`/requests/${requestId}/verify-invoice`, {
        status: verifyAction,
        remarks: verifyRemarks,
      });
      notify(`Invoice ${verifyAction} successfully.`, "success");
      setShowVerifyModal(false);
      fetchInvoice();
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Verification failed";
      notify(errorMessage, "error");
    }
  };

  if (loading) {
    return (
      <div className="container">
        <div className="card">
          <div className="loading-state">
            <p>Loading invoice...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !invoiceData) {
    return (
      <div className="container">
        <div className="card">
          <div className="error-state">
            <h3>Error Loading Invoice</h3>
            <p>{error || "Invoice not found"}</p>
            <button className="btn btn-primary" onClick={() => navigate(-1)}>
              Go Back
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container">
      <div className="navbar">
        <div className="container">
          <h2>BioChain RTO - Invoice</h2>
          <div className="nav-links">
            <span className={`role-badge role-${user?.role}`}>
              {user?.role?.toUpperCase()}
            </span>
            <button className="btn btn-secondary" onClick={() => navigate(-1)}>
              Back
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                logout();
                navigate("/");
              }}
            >
              Logout
            </button>
          </div>
        </div>
      </div>

      <InvoiceTemplateModern
        data={invoiceData}
        showActions={true}
        userRole={user?.role}
        onVerify={() => {
          setVerifyAction("verified");
          setShowVerifyModal(true);
        }}
        onReject={() => {
          setVerifyAction("rejected");
          setShowVerifyModal(true);
        }}
      />

      {/* Verification Modal */}
      {showVerifyModal && (
        <div
          className="modal-overlay"
          onClick={() => setShowVerifyModal(false)}
        >
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <h3>
              {verifyAction === "verified"
                ? "Verify Invoice"
                : "Reject Invoice"}
            </h3>
            <p>
              {verifyAction === "verified"
                ? "Confirm that all invoice details are correct and valid."
                : "Please provide a reason for rejection."}
            </p>
            <div className="form-group">
              <label>Remarks</label>
              <textarea
                value={verifyRemarks}
                onChange={(e) => setVerifyRemarks(e.target.value)}
                placeholder="Enter verification remarks..."
                rows={3}
              />
            </div>
            <div className="modal-actions">
              <button
                className={`btn ${
                  verifyAction === "verified" ? "btn-success" : "btn-danger"
                }`}
                onClick={handleVerify}
              >
                {verifyAction === "verified"
                  ? "Confirm Verification"
                  : "Confirm Rejection"}
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => setShowVerifyModal(false)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="dashboard-footer">
        <p>© 2026 BioChain RTO System • Digital India Initiative</p>
      </footer>
    </div>
  );
}
