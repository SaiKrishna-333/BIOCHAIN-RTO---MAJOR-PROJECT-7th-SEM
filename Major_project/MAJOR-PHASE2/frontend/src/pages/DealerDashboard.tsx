import { useState, useEffect } from "react";
import { useAuth } from "../context/useAuth";
import { useNavigate } from "react-router-dom";
import DualBiometricVerification from "../components/DualBiometricVerification";
import ViewTransactionButton from "../components/ViewTransactionButton";
import DashboardLayout from "../components/DashboardLayout";
import { OverviewBand } from "../lib/OverviewBand";
import { DataTable, StatusPill } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import { formatDate, enumLabel } from "../lib/display";
import { notify } from "../lib/notify";

export default function DealerDashboard() {
  const { user, api, refreshUser } = useAuth();
  const navigate = useNavigate();
  interface Request {
    _id: string;
    vehicle?: {
      make: string;
      model: string;
      year: string;
    };
    buyer?: {
      name: string;
    };
    status: string;
    createdAt: string;
    // Add other properties as needed
  }

  const [requests, setRequests] = useState<Request[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [formType, setFormType] = useState(""); // "dealer-details" or "showroom-details"
  interface VerificationResult {
    regNumber: string;
    make: string;
    model: string;
    year: string;
    status: "active" | "blocked";
    isStolen: boolean;
    currentOwner?: { name: string };
    blockchainOwner?: string;
    blockchainTxHash?: string;
  }

  interface DealerDetails {
    businessName: string;
    gstin: string;
    tin: string;
    licenseNumber: string;
    showroomAddress: string;
    contactPerson: string;
    contactPhone: string;
    contactEmail: string;
    phone: string;
  }

  const [formData, setFormData] = useState({
    buyerEmail: "",
    vehicleDetails: {
      chassisNumber: "",
      engineNumber: "",
      make: "",
      model: "",
      year: "",
    },
    exShowroomPrice: 0,
    roadTax: 0,
    registrationFee: 500,
    insuranceAmount: 0,
    handlingCharges: 5000,
    otherCharges: 0,
    paymentMode: "Full Payment",
  });
  const [regNumber, setRegNumber] = useState("");
  const [verificationResult, setVerificationResult] =
    useState<VerificationResult | null>(null);
  const [verificationMiss, setVerificationMiss] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("actions"); // 'actions', 'verification'
  const [showBiometricVerification, setShowBiometricVerification] =
    useState(false);
  const [pendingRequest, setPendingRequest] = useState<{
    buyerEmail: string;
    vehicleDetails: {
      chassisNumber: string;
      engineNumber: string;
      make: string;
      model: string;
      year: string;
    };
    exShowroomPrice: number;
    roadTax: number;
    registrationFee: number;
    insuranceAmount: number;
    handlingCharges: number;
    otherCharges: number;
    paymentMode: string;
  } | null>(null);

  // Initialize dealer details from user context
  const initialDealerDetails = (): DealerDetails => {
    if (user?.dealerDetails) {
      return {
        businessName: user.dealerDetails.businessName || "",
        gstin: user.dealerDetails.gstin || "",
        tin: user.dealerDetails.tin || "",
        licenseNumber: user.dealerDetails.licenseNumber || "",
        showroomAddress: user.dealerDetails.showroomAddress || "",
        contactPerson: user.dealerDetails.contactPerson || "",
        contactPhone: user.dealerDetails.contactPhone || "",
        contactEmail: user.dealerDetails.contactEmail || "",
        phone: user.dealerDetails.phone || "",
      };
    }
    return {
      businessName: "",
      gstin: "",
      tin: "",
      licenseNumber: "",
      showroomAddress: "",
      contactPerson: "",
      contactPhone: "",
      contactEmail: "",
      phone: "",
    };
  };

  const [dealerDetails, setDealerDetails] =
    useState<DealerDetails>(initialDealerDetails);

  const handleVehicleVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    // Every attempt starts from a clean slate, so a "not in the registry"
    // message from a previous lookup cannot sit next to a fresh result.
    setVerificationResult(null);
    setVerificationMiss(null);
    try {
      const res = await api.get(`/verification/vehicle/${regNumber}`);
      setVerificationResult(res.data);
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } }).response
        ?.status;
      if (status === 404) {
        setVerificationMiss(regNumber);
        return;
      }
      const errorMessage = err instanceof Error ? err.message : String(err);
      notify("Verification failed: " + errorMessage, "error");
    }
  };

  useEffect(() => {
    const loadRequests = async () => {
      try {
        const res = await api.get("/requests/my-requests");
        setRequests(res.data);
      } catch {
        // The list stays empty until the dealer's requests can be loaded.
      }
    };
    loadRequests();
  }, [api, user]);

  const fetchRequests = async () => {
    try {
      // /requests/all is RTO-only; the dealer's own list is served by
      // /requests/my-requests, which is already scoped server-side.
      const res = await api.get("/requests/my-requests");
      setRequests(res.data);
    } catch {
      // Keep the current list on screen if a refresh cannot be served.
    }
  };

  const handleDealerDetailsChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value } = e.target;
    setDealerDetails({
      ...dealerDetails,
      [name]: value,
    });
  };

  const handleSaveDealerDetails = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await api.put("/auth/update-dealer-details", {
        dealerDetails,
      });

      // Update user context with new dealer details
      refreshUser({ dealerDetails: response.data.dealerDetails });

      notify("Dealer details updated successfully.", "success");
      setShowForm(false);
      setFormType("");
    } catch (error: unknown) {
      // The message the API returns is the dealer-facing reason.
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to update dealer details";
      const axiosError = error as {
        response?: { data?: { message?: string } };
      };
      const serverMessage = axiosError.response?.data?.message || errorMessage;
      notify(serverMessage, "error");
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    if (name.includes("vehicleDetails")) {
      const field = name.split(".")[1];
      setFormData({
        ...formData,
        vehicleDetails: { ...formData.vehicleDetails, [field]: value },
      });
    } else {
      setFormData({ ...formData, [name]: value });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Store the form data and show biometric verification
    setPendingRequest(formData);
    setShowBiometricVerification(true);
  };

  const handleBiometricSuccess = async () => {
    if (!pendingRequest) return;

    try {
      const response = await api.post(
        "/requests/new-registration",
        pendingRequest,
      );
      const { requestId, invoiceNumber } = response.data;

      // The confirm() box used to block the whole page until someone clicked
      // it. The invoice now opens on its own once the request is stored.
      notify(
        `Registration request submitted. Invoice ${invoiceNumber} is ready.`,
        "success",
      );

      setShowForm(false);
      setFormType("");
      setShowBiometricVerification(false);
      setPendingRequest(null);
      setFormData({
        buyerEmail: "",
        vehicleDetails: {
          chassisNumber: "",
          engineNumber: "",
          make: "",
          model: "",
          year: "",
        },
        exShowroomPrice: 0,
        roadTax: 0,
        registrationFee: 500,
        insuranceAmount: 0,
        handlingCharges: 5000,
        otherCharges: 0,
        paymentMode: "Full Payment",
      });
      fetchRequests();

      if (requestId) {
        navigate(`/invoice/${requestId}`);
      }
    } catch {
      notify("Error submitting request", "error");
    }
  };

  return (
    <DashboardLayout
      title="Dealer Dashboard"
      subtitle="Register new vehicles and hand over to buyers"
      activeSection={activeTab}
    >
      <div className="container">
        {(() => {
          const pending = requests.filter(
            (r) => r.status !== "approved" && r.status !== "rejected",
          ).length;
          const approved = requests.filter(
            (r) => r.status === "approved",
          ).length;
          const rejected = requests.filter(
            (r) => r.status === "rejected",
          ).length;
          const kpis = [
            {
              label: "Requests",
              value: requests.length,
              sub: "Handovers & registrations",
              accent: BIO.blue,
            },
            {
              label: "Pending",
              value: pending,
              sub: "Awaiting buyer / RTO",
              accent: BIO.amber,
            },
            {
              label: "Approved",
              value: approved,
              sub: "Completed",
              accent: BIO.green,
            },
            {
              label: "Rejected",
              value: rejected,
              sub: "Declined",
              accent: BIO.red,
            },
          ];
          const pie = [
            {
              key: "pending",
              name: "Pending",
              value: pending,
              color: BIO.amber,
            },
            {
              key: "approved",
              name: "Approved",
              value: approved,
              color: BIO.green,
            },
            {
              key: "rejected",
              name: "Rejected",
              value: rejected,
              color: BIO.red,
            },
          ].filter((s) => s.value > 0);
          const monthKey = (d: string) =>
            `${new Date(d).getFullYear()}-${String(new Date(d).getMonth() + 1).padStart(2, "0")}`;
          const mm = new Map<
            string,
            { key: string; label: string; value: number }
          >();
          requests.forEach((r) => {
            if (!r.createdAt) return;
            const k = monthKey(r.createdAt);
            const cur = mm.get(k) || {
              key: k,
              label: new Intl.DateTimeFormat("en-IN", {
                month: "short",
                year: "numeric",
              }).format(new Date(r.createdAt)),
              value: 0,
            };
            cur.value++;
            mm.set(k, cur);
          });
          const bars = [...mm.values()].sort((a, b) =>
            a.key.localeCompare(b.key),
          );
          return (
            <OverviewBand
              kpis={kpis}
              pie={pie}
              pieTitle="Requests by status"
              bars={bars.length > 1 ? bars : undefined}
              barsTitle="Requests by month"
              note="Counts are derived live from your submitted requests."
            />
          );
        })()}
        <div className="card">
          <h3>Dealer Dashboard</h3>

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-btn ${activeTab === "actions" ? "active" : ""}`}
              onClick={() => setActiveTab("actions")}
            >
              Actions
            </button>
            <button
              className={`tab-btn ${
                activeTab === "verification" ? "active" : ""
              }`}
              onClick={() => setActiveTab("verification")}
            >
              Verify Vehicle
            </button>
          </div>

          {activeTab === "actions" && (
            <div>
              <h4>Choose Action</h4>
              <div
                style={{ display: "flex", gap: "20px", marginBottom: "20px" }}
              >
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    setFormType("dealer-details");
                    setShowForm(true);
                  }}
                >
                  Update Dealer Details
                </button>
                <button
                  className="btn btn-success"
                  onClick={() => {
                    setFormType("showroom-details");
                    setShowForm(true);
                  }}
                >
                  Register New Vehicle
                </button>
              </div>

              {/* Dual Biometric Verification Modal */}
              <DualBiometricVerification
                isOpen={showBiometricVerification}
                onClose={() => {
                  setShowBiometricVerification(false);
                  setPendingRequest(null);
                }}
                onSuccess={handleBiometricSuccess}
                person1Name={user?.name || "Dealer"}
                person1Role="dealer"
                person2Name="Buyer"
                person2Role="owner"
                transactionType="vehicle-sale"
              />
            </div>
          )}

          {activeTab === "verification" && (
            <div>
              <h4>Vehicle Verification</h4>
              <form onSubmit={handleVehicleVerification}>
                <div className="form-group">
                  <label>Registration Number</label>
                  <input
                    type="text"
                    value={regNumber}
                    onChange={(e) => setRegNumber(e.target.value)}
                    placeholder="Enter vehicle registration number"
                    required
                  />
                </div>
                <button type="submit" className="btn btn-primary">
                  Verify Vehicle
                </button>
              </form>

              {verificationMiss && (
                <div
                  className="alert alert-warning"
                  style={{ marginTop: "20px" }}
                  role="status"
                >
                  <strong>No record found.</strong> Registration number{" "}
                  {verificationMiss} is not in the vehicle registry. Check the
                  number, or wait for the RTO to approve the registration
                  request before verifying it.
                </div>
              )}

              {verificationResult && (
                <div className="history-section" style={{ marginTop: "20px" }}>
                  <h5>Verification Result</h5>
                  <p>
                    <strong>Registration No:</strong>{" "}
                    {verificationResult.regNumber}
                  </p>
                  <p>
                    <strong>Make & Model:</strong> {verificationResult.make}{" "}
                    {verificationResult.model}
                  </p>
                  <p>
                    <strong>Year:</strong> {verificationResult.year}
                  </p>
                  <p>
                    <strong>Status:</strong>
                    <span
                      className={
                        verificationResult.status === "active"
                          ? "status-active"
                          : "status-blocked"
                      }
                    >
                      {verificationResult.status.toUpperCase()}
                    </span>
                  </p>
                  <p>
                    <strong>Stolen Status:</strong>
                    <span
                      className={
                        verificationResult.isStolen
                          ? "status-stolen"
                          : "status-not-stolen"
                      }
                    >
                      {verificationResult.isStolen ? "STOLEN" : "NOT STOLEN"}
                    </span>
                  </p>
                  {verificationResult.currentOwner && (
                    <p>
                      <strong>Current Owner:</strong>{" "}
                      {verificationResult.currentOwner.name}
                    </p>
                  )}

                  <h6 style={{ marginTop: "15px" }}>Blockchain Info</h6>
                  <p>
                    <strong>Blockchain Owner:</strong>{" "}
                    {verificationResult.blockchainOwner
                      ? verificationResult.blockchainOwner.substring(0, 15) +
                        "..."
                      : "Not available"}
                  </p>
                  <p>
                    <strong>Last Blockchain Tx:</strong>{" "}
                    {verificationResult.blockchainTxHash
                      ? verificationResult.blockchainTxHash.substring(0, 15) +
                        "..."
                      : "None"}
                  </p>
                  <ViewTransactionButton
                    txHash={verificationResult.blockchainTxHash}
                    status="anchored"
                    label="View Transaction"
                    className="btn btn-sm btn-outline-success"
                  />
                </div>
              )}
            </div>
          )}

          {showForm && formType === "dealer-details" && (
            <form
              onSubmit={handleSaveDealerDetails}
              style={{ marginTop: "20px" }}
            >
              <h4>Dealer Details</h4>
              <div className="form-group">
                <label>Business Name</label>
                <input
                  type="text"
                  name="businessName"
                  value={dealerDetails.businessName}
                  onChange={handleDealerDetailsChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Business GSTIN</label>
                <input
                  type="text"
                  name="gstin"
                  value={dealerDetails.gstin}
                  onChange={handleDealerDetailsChange}
                />
              </div>
              <div className="form-group">
                <label>TIN Number</label>
                <input
                  type="text"
                  name="tin"
                  value={dealerDetails.tin}
                  onChange={handleDealerDetailsChange}
                />
              </div>
              <div className="form-group">
                <label>Showroom Address</label>
                <textarea
                  name="showroomAddress"
                  value={dealerDetails.showroomAddress}
                  onChange={handleDealerDetailsChange}
                  rows={3}
                ></textarea>
              </div>
              <div className="form-group">
                <label>Phone Number</label>
                <input
                  type="text"
                  name="phone"
                  value={dealerDetails.phone}
                  onChange={handleDealerDetailsChange}
                />
              </div>
              <div className="form-group">
                <label>License Number</label>
                <input
                  type="text"
                  name="licenseNumber"
                  value={dealerDetails.licenseNumber}
                  onChange={handleDealerDetailsChange}
                />
              </div>
              <button type="submit" className="btn btn-success">
                Save Dealer Details
              </button>
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </form>
          )}

          {showForm && formType === "showroom-details" && (
            <form onSubmit={handleSubmit} style={{ marginTop: "20px" }}>
              <h4>Register New Vehicle</h4>
              <div className="form-group">
                <label>Buyer Email</label>
                <input
                  type="email"
                  name="buyerEmail"
                  value={formData.buyerEmail}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Chassis Number</label>
                <input
                  type="text"
                  name="vehicleDetails.chassisNumber"
                  value={formData.vehicleDetails.chassisNumber}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Engine Number</label>
                <input
                  type="text"
                  name="vehicleDetails.engineNumber"
                  value={formData.vehicleDetails.engineNumber}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Make</label>
                <input
                  type="text"
                  name="vehicleDetails.make"
                  value={formData.vehicleDetails.make}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Model</label>
                <input
                  type="text"
                  name="vehicleDetails.model"
                  value={formData.vehicleDetails.model}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="form-group">
                <label>Year</label>
                <input
                  type="text"
                  name="vehicleDetails.year"
                  value={formData.vehicleDetails.year}
                  onChange={handleChange}
                  required
                />
              </div>
              <h5 style={{ marginTop: "20px", marginBottom: "15px" }}>
                Pricing Details
              </h5>
              <div className="form-group">
                <label>Ex-Showroom Price (₹)</label>
                <input
                  type="number"
                  name="exShowroomPrice"
                  value={formData.exShowroomPrice}
                  onChange={handleChange}
                  placeholder="e.g., 800000"
                  required
                />
                <small>Base price of the vehicle before taxes</small>
              </div>
              <div className="form-group">
                <label>Road Tax (₹)</label>
                <input
                  type="number"
                  name="roadTax"
                  value={formData.roadTax}
                  onChange={handleChange}
                  placeholder="e.g., 48000"
                  required
                />
                <small>
                  State road tax (typically 6% of ex-showroom price)
                </small>
              </div>
              <div className="form-group">
                <label>Insurance Amount (₹)</label>
                <input
                  type="number"
                  name="insuranceAmount"
                  value={formData.insuranceAmount}
                  onChange={handleChange}
                  placeholder="e.g., 32000"
                  required
                />
                <small>Annual insurance premium</small>
              </div>
              <div className="form-group">
                <label>Handling Charges (₹)</label>
                <input
                  type="number"
                  name="handlingCharges"
                  value={formData.handlingCharges}
                  onChange={handleChange}
                  placeholder="e.g., 5000"
                  required
                />
              </div>
              <div className="form-group">
                <label>Other Charges (₹)</label>
                <input
                  type="number"
                  name="otherCharges"
                  value={formData.otherCharges}
                  onChange={handleChange}
                  placeholder="e.g., 0"
                />
                <small>Any additional charges (optional)</small>
              </div>
              <div className="form-group">
                <label>Payment Mode</label>
                <select
                  name="paymentMode"
                  value={formData.paymentMode}
                  onChange={handleChange}
                  required
                >
                  <option value="Full Payment">Full Payment</option>
                  <option value="Loan">Loan/Financing</option>
                  <option value="Exchange">Exchange + Payment</option>
                </select>
              </div>
              <button type="submit" className="btn btn-success">
                Submit Request
              </button>
              <button
                type="button"
                className="btn btn-warning"
                onClick={() => setShowForm(false)}
              >
                Cancel
              </button>
            </form>
          )}
        </div>

        <div className="card">
          <h3>My Requests</h3>
          <DataTable<Request>
            rows={requests}
            rowKey={(r) => r._id}
            searchable
            searchPlaceholder="Search vehicle, buyer or status…"
            emptyTitle="No requests yet"
            emptyHint="Registered vehicles and handover requests will appear here."
            columns={[
              {
                key: "vehicle",
                header: "Vehicle",
                sortable: true,
                value: (r) =>
                  `${r.vehicle?.make ?? ""} ${r.vehicle?.model ?? ""}`,
              },
              {
                key: "buyer",
                header: "Buyer",
                sortable: true,
                value: (r) => r.buyer?.name || "—",
              },
              {
                key: "status",
                header: "Status",
                sortable: true,
                value: (r) => r.status,
                render: (r) => (
                  <StatusPill status={r.status} label={enumLabel(r.status)} />
                ),
              },
              {
                key: "createdAt",
                header: "Date",
                sortable: true,
                value: (r) => r.createdAt,
                render: (r) => <span>{formatDate(r.createdAt)}</span>,
              },
              {
                key: "actions",
                header: "Actions",
                sortable: false,
                render: (r) => (
                  <button
                    className="btn btn-info btn-sm"
                    onClick={() => navigate(`/invoice/${r._id}`)}
                  >
                    Invoice
                  </button>
                ),
              },
            ]}
          />
        </div>
        <footer className="dashboard-footer">
          <p>© 2026 BioChain RTO System • Digital India Initiative</p>
        </footer>
      </div>
    </DashboardLayout>
  );
}
