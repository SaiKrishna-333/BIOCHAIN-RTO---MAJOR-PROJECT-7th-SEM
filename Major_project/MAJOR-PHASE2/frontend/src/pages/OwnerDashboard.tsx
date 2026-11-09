interface VehicleHistoryRecord {
  fromOwner?: { name: string };
  toOwner?: { name: string };
  transferType?: string;
  timestamp: string;
  blockchainTxHash?: string;
}

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { useNavigate, useLocation } from "react-router-dom";
import { OverviewBand } from "../lib/OverviewBand";
import { BIO } from "../lib/ui-tokens";
import DualBiometricVerification from "../components/DualBiometricVerification";
import DocumentExpiryAlerts from "../components/DocumentExpiryAlerts";
import DemoPaymentModal from "../components/DemoPaymentModal";
import DashboardLayout from "../components/DashboardLayout";
import ViewTransactionButton from "../components/ViewTransactionButton";
import VehicleReports from "../components/VehicleReports";
import AccidentReportUpload from "../components/AccidentReportUpload";
import IncomingOffers from "../components/IncomingOffers";
import SentOffers from "../components/SentOffers";
import { STATES } from "../lib/states";

import type { Vehicle } from "../types/api";
import { formatDate, formatMoney } from "../lib/display";
import { notify } from "../lib/notify";

interface VehicleHistoryRecord {
  fromOwner?: { name: string };
  toOwner?: { name: string };
  transferType?: string;
  timestamp: string;
  blockchainTxHash?: string;
}

export default function OwnerDashboard() {
  const { user, api } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [vehicleHistory, setVehicleHistory] = useState<{
    [key: string]: VehicleHistoryRecord[];
  }>({});
  const [invoices, setInvoices] = useState<
    Array<{
      _id: string;
      invoiceNumber: string;
      vehicle: { make: string; model: string; regNumber: string };
      status: string;
      createdAt: string;
    }>
  >([]);
  const [showForm, setShowForm] = useState(false);
  const [activeTabState, setActiveTabState] = useState("myVehicles"); // 'myVehicles', 'reports', 'offers', 'theft', 'profile', 'invoices'

  // Sidebar deep-links (/?tab=reports etc.) drive the visible section -
  // the URL is the source of truth, no state-sync effect needed.
  const urlTab = new URLSearchParams(location.search).get("tab");
  const activeTab = urlTab ?? activeTabState;
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    const query = tab === "reports" || tab === "offers" ? `?tab=${tab}` : "";
    navigate(`/owner${query}`, { replace: true });
  };
  const [formData, setFormData] = useState({
    vehicleId: "",
    buyerEmail: "",
    salePrice: "",
    message: "",
    attachIntel: true,
  });

  // Live workshop intelligence for the vehicle being sold
  const [sellIntel, setSellIntel] = useState<{
    serviceRecords: number;
    latestService: { date: string; odometerKm: number; type: string } | null;
    partsTracked: number;
    damageEvents: number;
    battery: { currentSoH: number | null } | null;
  } | null>(null);

  const [theftFormData, setTheftFormData] = useState({
    vehicleId: "",
    policeStation: "",
    firNumber: "",
    incidentDate: "",
    incidentLocation: "",
    description: "",
  });

  const [inheritanceFormData, setInheritanceFormData] = useState({
    vehicleRegNumber: "",
    deceasedOwnerId: "",
    deathCertificateNumber: "",
    relationshipToDeceased: "",
    successionCertificateNumber: "",
    courtOrderNumber: "",
    deathCertificateDoc: null as File | null,
    successionCertificateDoc: null as File | null,
    courtOrderDoc: null as File | null,
    relationshipProofDoc: null as File | null,
  });

  // Inter-state transfer form state. The origin state is never chosen here - the
  // server derives it from the registration number, so the UI only displays it.
  const [interStateFormData, setInterStateFormData] = useState({
    vehicleId: "",
    toState: "",
    newAddress: "",
  });
  const [interStatePassport, setInterStatePassport] = useState<{
    passportId?: string;
    passportHash?: string;
    passport?: { vehicle?: { state?: string } };
  } | null>(null);

  // Indian State Codes
  const STATE_CODES: { [key: string]: string } = {
    KA: "Karnataka",
    MH: "Maharashtra",
    TN: "Tamil Nadu",
    AP: "Andhra Pradesh",
    TS: "Telangana",
    KL: "Kerala",
    DL: "Delhi",
    GJ: "Gujarat",
    RJ: "Rajasthan",
    MP: "Madhya Pradesh",
    UP: "Uttar Pradesh",
    WB: "West Bengal",
    PB: "Punjab",
    HR: "Haryana",
    JK: "Jammu & Kashmir",
    GA: "Goa",
    OR: "Odisha",
    CG: "Chhattisgarh",
    JH: "Jharkhand",
    BR: "Bihar",
    AS: "Assam",
    NE: "Northeast States",
  };

  // Same rule the server uses (crossStateInteroperability.extractStateFromRegNumber),
  // so what the owner sees is exactly what the RTO offices will be matched on.
  const interStateVehicle = vehicles.find(
    (v) => v._id === interStateFormData.vehicleId,
  );
  const originStateCode = interStateVehicle?.regNumber
    ? (/^([A-Z]{2})/.exec(interStateVehicle.regNumber)?.[1] ?? "")
    : "";
  const originStateName = originStateCode
    ? (STATE_CODES[originStateCode] ?? originStateCode)
    : "";

  const [profileData, setProfileData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    aadhaarNumber: "",
    dlNumber: "",
  });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string>("");
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [showBiometricVerification, setShowBiometricVerification] =
    useState(false);
  const [pendingTransfer, setPendingTransfer] = useState<{
    vehicleId: string;
    buyerEmail: string;
    salePrice: string;
    message: string;
    attachIntel: boolean;
  } | null>(null);

  // Challan state
  const [pendingChallans, setPendingChallans] = useState<
    {
      _id: string;
      regNumber: string;
      violationType: string;
      violationDescription: string;
      fineAmount: number;
      paidAmount: number;
      paymentStatus: string;
    }[]
  >([]);
  // Whether the challan list was actually read. "No pending challans" and "I could
  // not check" are different statements, and the screen used to show the first
  // one for the second.
  const [challanListState, setChallanListState] = useState<
    "loading" | "loaded" | "failed"
  >("loading");
  const [totalPendingAmount, setTotalPendingAmount] = useState(0);
  const [showChallanPayment, setShowChallanPayment] = useState(false);
  const [selectedChallan, setSelectedChallan] = useState<{
    _id: string;
    amount: number;
    description: string;
  } | null>(null);

  const loadProfileData = useCallback(async () => {
    // Load from user context (which has data from login)
    if (user) {
      setProfileData({
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        address: user.address || "",
        aadhaarNumber: user.aadhaarNumber || "",
        dlNumber: user.dlNumber || "",
      });

      // Only attempt to load photo if user has profilePhoto data
      if (user.profilePhoto && user.profilePhoto.data) {
        try {
          const photoRes = await api.get(`/auth/users/${user.id}/photo`, {
            responseType: "blob",
          });
          const photoUrl = URL.createObjectURL(photoRes.data);
          setProfilePhotoUrl(photoUrl);
        } catch {
          // No photo on record - the initial-based avatar is used instead.
        }
      }
    }
  }, [user, api]);

  // Load profile data when clicking on profile tab
  const handleProfileTabClick = () => {
    setActiveTab("profile");
    loadProfileData();
  };

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    try {
      // If there's a new photo, upload it first
      if (profilePhotoFile) {
        const formData = new FormData();
        formData.append("profilePhoto", profilePhotoFile);

        await api.put(`/auth/${user.id}/photo`, formData, {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        });
      }

      // Update other profile data
      await api.put(`/auth/users/${user.id}`, profileData);
      notify("Profile updated successfully.", "success");
      setIsEditingProfile(false);
      setProfilePhotoFile(null);
      loadProfileData();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update profile";
      notify(msg, "error");
    }
  };

  const fetchVehicles = useCallback(async () => {
    try {
      const res = await api.get("/vehicles/my");
      setVehicles(res.data);
    } catch {
      // The vehicles list simply stays empty; the page itself is still usable.
    }
  }, [api]);

  const fetchInvoices = useCallback(async () => {
    try {
      const res = await api.get("/requests/my-invoices");
      setInvoices(res.data);
    } catch {
      // No invoices to show rather than an error dialog on every dashboard open.
    }
  }, [api]);

  const fetchPendingChallans = useCallback(async () => {
    setChallanListState("loading");
    try {
      const res = await api.get("/challans/pending");
      setPendingChallans(res.data.challans);
      setTotalPendingAmount(res.data.totalPending);
      setChallanListState("loaded");
    } catch {
      setPendingChallans([]);
      setTotalPendingAmount(0);
      setChallanListState("failed");
    }
  }, [api]);

  const handleChallanPayment = async () => {
    if (!selectedChallan) return;
    try {
      const res = await api.put(`/challans/${selectedChallan._id}/pay`, {
        paymentMethod: "online",
        paidAmount: selectedChallan.amount,
      });
      // The server says what the payment did: cleared, or only part of a fine.
      notify(res.data?.message || "Payment recorded.", "success");
      setShowChallanPayment(false);
      setSelectedChallan(null);
      await fetchPendingChallans();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to pay challan";
      notify(msg, "error");
    }
  };

  const fetchVehicleHistory = async (vehicleId: string, regNumber: string) => {
    try {
      const res = await api.get(`/vehicles/history/${regNumber}`);
      setVehicleHistory((prev) => ({
        ...prev,
        [vehicleId]: res.data,
      }));
    } catch (err: unknown) {
      // Say why there is no history, using the reason the API returned.
      notify(
        err instanceof Error
          ? err.message
          : "No ownership history available for this vehicle yet.",
        "error",
      );
    }
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const target = e.target as HTMLInputElement;
    setFormData({
      ...formData,
      [target.name]: target.type === "checkbox" ? target.checked : target.value,
    });
  };

  const handleTheftChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) => {
    setTheftFormData({ ...theftFormData, [e.target.name]: e.target.value });
  };

  const handleInheritanceChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>,
  ) => {
    setInheritanceFormData({
      ...inheritanceFormData,
      [e.target.name]: e.target.value,
    });
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, files } = e.target;
    if (files && files[0]) {
      setInheritanceFormData((prev) => ({
        ...prev,
        [name]: files[0],
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Pre-flight: a vehicle with unsettled challans cannot be listed for sale.
    // Failing here (not just at RTO approval) means the seller sees the reason
    // instantly, before the biometric prompt even opens. If the check itself
    // errors out we still fall through - the backend's approve-time gate will
    // catch it as a defense-in-depth.
    if (formData.vehicleId) {
      try {
        const chk = await api.get(`/challans/check/${formData.vehicleId}`);
        if (chk.data?.hasPendingChallans) {
          notify(
            `Vehicle has ${chk.data.count} pending challan(s) totalling \u20b9${chk.data.totalPending}. Settle all dues before listing it for sale.`,
            "error",
          );
          // Close the Sell modal so the PENDING CHALLANS tab underneath becomes
          // clickable. Leaving it open means the fixed backdrop intercepts every
          // subsequent click and the seller gets stuck on the error.
          setShowForm(false);
          return;
        }
      } catch {
        /* fall through to backend enforcement */
      }
    }

    // Store the transfer data (incl. offer details) and show biometric verification
    setPendingTransfer({ ...formData });
    setShowBiometricVerification(true);
  };

  const handleBiometricSuccess = async () => {
    if (!pendingTransfer) return;

    try {
      await api.post("/requests/transfer", pendingTransfer);
      notify(
        "Transfer request submitted with biometric verification.",
        "success",
      );
      setShowForm(false);
      setShowBiometricVerification(false);
      setPendingTransfer(null);
      setFormData({
        vehicleId: "",
        buyerEmail: "",
        salePrice: "",
        message: "",
        attachIntel: true,
      });
      fetchVehicles();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      notify(
        "Error submitting request: " +
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message || errorMessage,
        "error",
      );
    }
  };

  const handleTheftSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.post("/theft/report", theftFormData);
      notify("Theft report submitted.", "success");
      setShowForm(false);
      setTheftFormData({
        vehicleId: "",
        policeStation: "",
        firNumber: "",
        incidentDate: "",
        incidentLocation: "",
        description: "",
      });
      fetchVehicles();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      notify(
        "Error submitting theft report: " +
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message || errorMessage,
        "error",
      );
    }
  };

  const handleInheritanceSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Create FormData for file upload
      const formData = new FormData();
      formData.append("vehicleRegNumber", inheritanceFormData.vehicleRegNumber);
      formData.append("deceasedOwnerId", inheritanceFormData.deceasedOwnerId);
      formData.append(
        "deathCertificateNumber",
        inheritanceFormData.deathCertificateNumber,
      );
      formData.append(
        "relationshipToDeceased",
        inheritanceFormData.relationshipToDeceased,
      );
      formData.append(
        "successionCertificateNumber",
        inheritanceFormData.successionCertificateNumber,
      );
      formData.append("courtOrderNumber", inheritanceFormData.courtOrderNumber);

      // Append files if they exist
      if (inheritanceFormData.deathCertificateDoc) {
        formData.append(
          "deathCertificate",
          inheritanceFormData.deathCertificateDoc,
        );
      }
      if (inheritanceFormData.successionCertificateDoc) {
        formData.append(
          "successionCertificate",
          inheritanceFormData.successionCertificateDoc,
        );
      }
      if (inheritanceFormData.courtOrderDoc) {
        formData.append("courtOrder", inheritanceFormData.courtOrderDoc);
      }
      if (inheritanceFormData.relationshipProofDoc) {
        formData.append(
          "relationshipProof",
          inheritanceFormData.relationshipProofDoc,
        );
      }

      await api.post("/inheritance/request", formData, {
        headers: {
          "Content-Type": "multipart/form-data",
        },
      });
      notify("Inheritance transfer request submitted.", "success");
      setShowForm(false);
      setInheritanceFormData({
        vehicleRegNumber: "",
        deceasedOwnerId: "",
        deathCertificateNumber: "",
        relationshipToDeceased: "",
        successionCertificateNumber: "",
        courtOrderNumber: "",
        deathCertificateDoc: null,
        successionCertificateDoc: null,
        courtOrderDoc: null,
        relationshipProofDoc: null,
      });
      fetchVehicles();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      notify(
        "Error submitting inheritance request: " +
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message || errorMessage,
        "error",
      );
    }
  };

  // Handle Inter-State Transfer Submit
  const handleInterStateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Persist an actual inter-state transfer request: this generates the
      // vehicle passport server-side AND queues the request for source/destination
      // RTO approval (mounted under /api/inter-state).
      const response = await api.post("/inter-state/create", {
        vehicleId: interStateFormData.vehicleId,
        targetState: interStateFormData.toState,
        newAddress: interStateFormData.newAddress,
      });

      const details = response.data?.transferRequest?.interStateDetails;

      if (details?.vehiclePassport) {
        setInterStatePassport({
          passportId: details.vehiclePassport.passportId,
          passportHash: details.passportHash,
          passport: {
            ...details.vehiclePassport,
            vehicle: {
              ...details.vehiclePassport.vehicle,
              state: details.currentState,
            },
          },
        });
        notify(
          "Inter-state transfer request submitted. Passport valid for 30 days.",
          "success",
        );
      } else {
        notify(
          "Inter-state transfer request submitted. RTO approval pending.",
          "success",
        );
      }

      setInterStateFormData({
        vehicleId: "",
        toState: "",
        newAddress: "",
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      notify(
        "Error requesting inter-state transfer: " +
          (err as { response?: { data?: { message?: string } } })?.response
            ?.data?.message || errorMessage,
        "error",
      );
    }
  };

  // Load vehicles and profile on mount
  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    const loadData = async () => {
      await fetchVehicles();
      await loadProfileData();
      await fetchInvoices();
      await fetchPendingChallans();
    };
    loadData();
  }, [
    user,
    navigate,
    fetchVehicles,
    loadProfileData,
    fetchInvoices,
    fetchPendingChallans,
  ]);

  // Premium overview band: every value is derived live from the vehicles,
  // challans and invoices already loaded for this owner - nothing is invented.
  const ownerBand = (() => {
    const statusCounts: Record<string, number> = {};
    vehicles.forEach((v) => {
      const s = v.status || "unknown";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    const colorFor = (s: string) =>
      s === "active" ? BIO.green : s === "sold" ? BIO.slate : BIO.amber;
    const pie = Object.entries(statusCounts).map(([name, value]) => ({
      key: name,
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value,
      color: colorFor(name),
    }));

    const challanCounts: Record<string, number> = {};
    pendingChallans.forEach((c) => {
      const t = c.violationType || "Other";
      challanCounts[t] = (challanCounts[t] || 0) + 1;
    });
    const bars = Object.entries(challanCounts)
      .map(([label, value]) => ({ key: label, label, value }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);

    const kpis = [
      {
        label: "Registered Vehicles",
        value: vehicles.length,
        sub: vehicles.filter((v) => v.status === "active").length + " active",
        accent: BIO.blue,
        hint: "Jump to your vehicle list",
        onClick: () => setActiveTab("myVehicles"),
      },
      {
        label: "Pending Challans",
        value: pendingChallans.length,
        sub: "awaiting payment",
        accent: BIO.amber,
        hint: "Jump to pending challans",
        onClick: () => setActiveTab("challans"),
      },
      {
        label: "Total Dues",
        value: formatMoney(totalPendingAmount),
        sub: "across pending challans",
        accent: BIO.red,
        hint: "Jump to pending challans",
        onClick: () => setActiveTab("challans"),
      },
      {
        label: "Invoices",
        value: invoices.length,
        sub:
          invoices.filter((i) => i.status === "paid").length +
          " paid, " +
          invoices.filter((i) => i.status !== "paid").length +
          " open",
        accent: BIO.violet,
        hint: "Jump to my invoices",
        onClick: () => setActiveTab("invoices"),
      },
    ];

    return { kpis, pie, bars };
  })();

  return (
    <DashboardLayout
      title="Owner Dashboard"
      subtitle="Register, sell and track your vehicles with on-chain proof"
      activeSection={activeTab}
    >
      <div className="container">
        <OverviewBand
          kpis={ownerBand.kpis}
          pie={ownerBand.pie}
          pieTitle="Vehicles by status"
          bars={ownerBand.bars}
          barsTitle="Pending challans by violation"
          note="Counts are derived live from the vehicles, challans and invoices on your account. Select a KPI to jump to that section."
        />

        {/* Document Expiry Alerts */}
        <DocumentExpiryAlerts />

        <div className="card">
          <h3>Owner Dashboard</h3>

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-btn ${activeTab === "myVehicles" ? "active" : ""}`}
              onClick={() => setActiveTab("myVehicles")}
            >
              My Vehicles
            </button>
            <button
              className={`tab-btn ${activeTab === "reports" ? "active" : ""}`}
              onClick={() => setActiveTab("reports")}
            >
              Vehicle Reports
            </button>
            <button
              className={`tab-btn ${activeTab === "offers" ? "active" : ""}`}
              onClick={() => setActiveTab("offers")}
            >
              Resale Offers
            </button>
            <button
              className={`tab-btn ${activeTab === "theft" ? "active" : ""}`}
              onClick={() => setActiveTab("theft")}
            >
              Report Theft
            </button>
            <button
              className={`tab-btn ${activeTab === "accident" ? "active" : ""}`}
              onClick={() => setActiveTab("accident")}
            >
              Report Accident
            </button>
            <button
              className={`tab-btn ${activeTab === "inheritance" ? "active" : ""}`}
              onClick={() => setActiveTab("inheritance")}
            >
              Inheritance Transfer
            </button>
            <button
              className={`tab-btn ${activeTab === "interState" ? "active" : ""}`}
              onClick={() => setActiveTab("interState")}
            >
              Inter-State Transfer
            </button>
            <button
              className={`tab-btn ${activeTab === "invoices" ? "active" : ""}`}
              onClick={() => setActiveTab("invoices")}
            >
              My Invoices
            </button>
            <button
              className={`tab-btn ${activeTab === "challans" ? "active" : ""}`}
              onClick={() => setActiveTab("challans")}
            >
              Pending Challans
              {pendingChallans.length > 0 && (
                <span
                  style={{
                    background: "#ef4444",
                    color: "white",
                    borderRadius: "50%",
                    padding: "2px 8px",
                    fontSize: "12px",
                    marginLeft: "5px",
                  }}
                >
                  {pendingChallans.length}
                </span>
              )}
            </button>
            <button
              className={`tab-btn ${activeTab === "profile" ? "active" : ""}`}
              onClick={handleProfileTabClick}
            >
              Profile
            </button>
          </div>

          {/* My Vehicles Tab */}
          {activeTab === "myVehicles" && (
            <div>
              <h4>My Registered Vehicles</h4>
              {vehicles.length === 0 && (
                <div className="alert alert-secondary">
                  No vehicles yet. Ask your dealer to register a new vehicle for
                  you, or wait for an RTO-approved transfer — your vehicles will
                  appear here automatically.
                </div>
              )}
              {vehicles.length > 0 && (
                <table className="table">
                  <thead>
                    <tr>
                      <th>Reg No</th>
                      <th>Make & Model</th>
                      <th>Year</th>
                      <th>Status</th>
                      <th>Blockchain Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v) => (
                      <tr key={v._id}>
                        <td>{v.regNumber || "Not Assigned"}</td>
                        <td>
                          {v.make} {v.model}
                        </td>
                        <td>{v.year}</td>
                        <td>
                          <span
                            className={`role-badge ${
                              v.status === "active"
                                ? "role-owner"
                                : "role-reject"
                            }`}
                          >
                            {v.status.toUpperCase()}
                          </span>
                        </td>
                        <td>
                          {v.blockchainTxHash ? (
                            <span
                              className="role-badge role-owner"
                              title={v.blockchainTxHash}
                            >
                              On Blockchain
                            </span>
                          ) : (
                            <span className="role-badge role-dealer">
                              Registry copy only - on-chain pending
                            </span>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-success"
                            onClick={() => {
                              if (v.blockchainTxHash) {
                                window.open(
                                  `https://amoy.polygonscan.com/tx/${v.blockchainTxHash}`,
                                  "_blank",
                                );
                              } else {
                                notify(
                                  "Blockchain registration pending. This vehicle hasn't been registered on blockchain yet.",
                                  "info",
                                );
                              }
                            }}
                            title={
                              v.blockchainTxHash
                                ? "View on Blockchain"
                                : "No on-chain reference has been recorded for this vehicle yet"
                            }
                            disabled={!v.blockchainTxHash}
                          >
                            Blockchain
                          </button>
                          <button
                            className="btn btn-info"
                            onClick={() => {
                              navigate(`/rc-card/${v._id}`);
                            }}
                            title="View RC Card"
                          >
                            RC Card
                          </button>
                          <button
                            className="btn btn-secondary"
                            onClick={() => {
                              navigate(`/vehicle-history/${v._id}`);
                            }}
                            title="View Verified Service & Odometer History"
                          >
                            Service History
                          </button>
                          <button
                            className="btn btn-primary"
                            onClick={() => {
                              setFormData({ ...formData, vehicleId: v._id });
                              setShowForm(true);
                              setSellIntel(null);
                              api
                                .get(
                                  `/vehicle-intelligence/vehicle-summary/${v._id}`,
                                )
                                .then((r) => setSellIntel(r.data.summary))
                                .catch(() => setSellIntel(null));
                            }}
                          >
                            Sell
                          </button>
                          <button
                            className="btn btn-warning"
                            onClick={() => {
                              if (v.regNumber) {
                                fetchVehicleHistory(v._id, v.regNumber);
                              } else {
                                notify("Registration number not assigned yet.");
                              }
                            }}
                            title="View Ownership History"
                          >
                            Owners
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {/* Vehicle History Section */}
              {Object.keys(vehicleHistory).length > 0 && (
                <div>
                  <h4>Vehicle History</h4>
                  {Object.entries(vehicleHistory).map(
                    ([vehicleId, history]: [
                      string,
                      VehicleHistoryRecord[],
                    ]) => (
                      <div key={vehicleId} className="history-section">
                        <h5>History for Vehicle ID: {vehicleId}</h5>
                        <table className="table">
                          <thead>
                            <tr>
                              <th>From</th>
                              <th>To</th>
                              <th>Type</th>
                              <th>Date</th>
                              <th>Blockchain Tx</th>
                            </tr>
                          </thead>
                          <tbody>
                            {history.map(
                              (record: VehicleHistoryRecord, index) => (
                                <tr key={index}>
                                  <td>{record.fromOwner?.name || "Unknown"}</td>
                                  <td>{record.toOwner?.name || "Unknown"}</td>
                                  <td>{record.transferType || "transfer"}</td>
                                  <td>{formatDate(record.timestamp)}</td>
                                  <td>
                                    {record.blockchainTxHash ? (
                                      <ViewTransactionButton
                                        txHash={record.blockchainTxHash}
                                        status="hashed_only"
                                        label="View Tx"
                                        className="btn btn-info"
                                      />
                                    ) : (
                                      "N/A"
                                    )}
                                  </td>
                                </tr>
                              ),
                            )}
                          </tbody>
                        </table>
                      </div>
                    ),
                  )}
                </div>
              )}
            </div>
          )}

          {/* Vehicle Reports Tab - workshop intelligence request workflow */}
          {activeTab === "reports" && <VehicleReports />}

          {/* Report Accident Tab - owner uploads dashcam evidence for officer review */}
          {activeTab === "accident" && <AccidentReportUpload />}

          {/* Resale Offers Tab - seller tracks sent offers, buyer decides */}
          {activeTab === "offers" && (
            <>
              <SentOffers />
              <IncomingOffers />
            </>
          )}

          {/* Report Theft Tab */}
          {activeTab === "theft" && (
            <div>
              <h4>Report Vehicle Theft</h4>
              <form onSubmit={handleTheftSubmit}>
                <div className="form-group">
                  <label>Vehicle</label>
                  <select
                    name="vehicleId"
                    value={theftFormData.vehicleId}
                    onChange={handleTheftChange}
                    required
                  >
                    <option value="">Select Vehicle</option>
                    {vehicles.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.make} {v.model} ({v.regNumber || "Not Assigned"})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label>Police Station</label>
                  <input
                    type="text"
                    name="policeStation"
                    value={theftFormData.policeStation}
                    onChange={handleTheftChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>FIR Number</label>
                  <input
                    type="text"
                    name="firNumber"
                    value={theftFormData.firNumber}
                    onChange={handleTheftChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Incident Date</label>
                  <input
                    type="date"
                    name="incidentDate"
                    value={theftFormData.incidentDate}
                    onChange={handleTheftChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Incident Location</label>
                  <input
                    type="text"
                    name="incidentLocation"
                    value={theftFormData.incidentLocation}
                    onChange={handleTheftChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea
                    name="description"
                    value={theftFormData.description}
                    onChange={handleTheftChange}
                    required
                    rows={3}
                  ></textarea>
                </div>
                <button type="submit" className="btn btn-danger">
                  Report Theft
                </button>
              </form>
            </div>
          )}

          {/* Inheritance Transfer Tab */}
          {activeTab === "inheritance" && (
            <div>
              <h4>Initiate Inheritance Transfer</h4>
              <div className="card">
                <p style={{ color: "#666", marginBottom: "20px" }}>
                  <strong>Note:</strong> This form is used to transfer vehicle
                  ownership in case of death of the owner. All legal documents
                  must be uploaded for verification.
                </p>

                <form onSubmit={handleInheritanceSubmit}>
                  <div className="form-group">
                    <label>
                      Vehicle Registration Number{" "}
                      <span style={{ color: "red" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="vehicleRegNumber"
                      value={inheritanceFormData.vehicleRegNumber}
                      onChange={handleInheritanceChange}
                      placeholder="KA01AB1234"
                      required
                    />
                    <small>
                      Enter the registration number of the deceased owner's
                      vehicle (e.g., KA01AB1234)
                    </small>
                  </div>

                  <div className="form-group">
                    <label>
                      Deceased Owner Name{" "}
                      <span style={{ color: "red" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="deceasedOwnerId"
                      value={inheritanceFormData.deceasedOwnerId}
                      onChange={handleInheritanceChange}
                      placeholder="Enter deceased owner's full name"
                      required
                    />
                    <small>Full name of the deceased vehicle owner</small>
                  </div>

                  <div className="form-group">
                    <label>
                      Death Certificate Number{" "}
                      <span style={{ color: "red" }}>*</span>
                    </label>
                    <input
                      type="text"
                      name="deathCertificateNumber"
                      value={inheritanceFormData.deathCertificateNumber}
                      onChange={handleInheritanceChange}
                      placeholder="DC-2024-123456"
                      required
                    />
                  </div>

                  <div className="form-group">
                    <label>
                      Relationship to Deceased{" "}
                      <span style={{ color: "red" }}>*</span>
                    </label>
                    <select
                      name="relationshipToDeceased"
                      value={inheritanceFormData.relationshipToDeceased}
                      onChange={handleInheritanceChange}
                      required
                    >
                      <option value="">Select Relationship</option>
                      <option value="spouse">Spouse (Husband/Wife)</option>
                      <option value="child">Child (Son/Daughter)</option>
                      <option value="parent">Parent (Father/Mother)</option>
                      <option value="sibling">Sibling (Brother/Sister)</option>
                      <option value="legal_heir">Legal Heir</option>
                    </select>
                  </div>

                  <div className="form-group">
                    <label>Succession Certificate Number (Optional)</label>
                    <input
                      type="text"
                      name="successionCertificateNumber"
                      value={inheritanceFormData.successionCertificateNumber}
                      onChange={handleInheritanceChange}
                      placeholder="SC-2024-789012"
                    />
                    <small>
                      Court-issued succession certificate number (if applicable)
                    </small>
                  </div>

                  <div className="form-group">
                    <label>Court Order Number (Optional)</label>
                    <input
                      type="text"
                      name="courtOrderNumber"
                      value={inheritanceFormData.courtOrderNumber}
                      onChange={handleInheritanceChange}
                      placeholder="CO-2024-345678"
                    />
                    <small>
                      Court order number for inheritance (if applicable)
                    </small>
                  </div>

                  <div style={{ marginTop: "30px", marginBottom: "20px" }}>
                    <h5>Upload Required Documents</h5>

                    <div className="form-group">
                      <label>
                        1. Death Certificate{" "}
                        <span style={{ color: "red" }}>*</span>
                      </label>
                      <input
                        type="file"
                        name="deathCertificateDoc"
                        onChange={handleFileChange}
                        accept=".pdf,.jpg,.jpeg,.png"
                        required
                      />
                      <small>
                        Upload scanned copy of official death certificate
                        (PDF/Image)
                      </small>
                    </div>

                    <div className="form-group">
                      <label>2. Succession Certificate</label>
                      <input
                        type="file"
                        name="successionCertificateDoc"
                        onChange={handleFileChange}
                        accept=".pdf,.jpg,.jpeg,.png"
                      />
                      <small>
                        Upload court-issued succession certificate if available
                        (PDF/Image)
                      </small>
                    </div>

                    <div className="form-group">
                      <label>3. Court Order</label>
                      <input
                        type="file"
                        name="courtOrderDoc"
                        onChange={handleFileChange}
                        accept=".pdf,.jpg,.jpeg,.png"
                      />
                      <small>
                        Upload court order for inheritance if applicable
                        (PDF/Image)
                      </small>
                    </div>

                    <div className="form-group">
                      <label>
                        4. Relationship Proof{" "}
                        <span style={{ color: "red" }}>*</span>
                      </label>
                      <input
                        type="file"
                        name="relationshipProofDoc"
                        onChange={handleFileChange}
                        accept=".pdf,.jpg,.jpeg,.png"
                        required
                      />
                      <small>
                        Upload proof of relationship (Birth certificate,
                        Marriage certificate, Affidavit, etc.)
                      </small>
                    </div>
                  </div>

                  <button type="submit" className="btn btn-success">
                    Submit Inheritance Request
                  </button>
                </form>
              </div>
            </div>
          )}

          {/* Inter-State Transfer Tab */}
          {activeTab === "interState" && (
            <div className="card">
              <h3>Inter-State Vehicle Transfer</h3>
              <p style={{ color: "#666", marginBottom: "20px" }}>
                Transfer your vehicle to a different state. Generate a vehicle
                passport for seamless RTO verification.
              </p>

              <form onSubmit={handleInterStateSubmit}>
                <div className="form-group">
                  <label>Select Vehicle</label>
                  <select
                    value={interStateFormData.vehicleId}
                    onChange={(e) =>
                      setInterStateFormData({
                        ...interStateFormData,
                        vehicleId: e.target.value,
                      })
                    }
                    required
                  >
                    <option value="">-- Select Vehicle --</option>
                    {vehicles.map((v) => (
                      <option key={v._id} value={v._id}>
                        {v.regNumber} - {v.make} {v.model}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label>From State (from registration number)</label>
                  <input
                    type="text"
                    value={originStateName}
                    readOnly
                    placeholder="Select a vehicle first"
                  />
                </div>

                <div className="form-group">
                  <label>To State</label>
                  <select
                    value={interStateFormData.toState}
                    onChange={(e) =>
                      setInterStateFormData({
                        ...interStateFormData,
                        toState: e.target.value,
                      })
                    }
                    required
                  >
                    <option value="">-- Select State --</option>
                    {STATES.filter((s) => s.code !== originStateCode).map(
                      (s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ),
                    )}
                  </select>
                </div>

                <div className="form-group">
                  <label>New Address in Destination State</label>
                  <input
                    type="text"
                    value={interStateFormData.newAddress}
                    onChange={(e) =>
                      setInterStateFormData({
                        ...interStateFormData,
                        newAddress: e.target.value,
                      })
                    }
                    placeholder="Enter new address"
                    required
                  />
                </div>

                <button type="submit" className="btn btn-success">
                  Request Inter-State Transfer
                </button>
              </form>

              {interStatePassport && (
                <div
                  style={{
                    marginTop: "20px",
                    padding: "15px",
                    background: "#e8f5e9",
                    borderRadius: "8px",
                  }}
                >
                  <h4>Vehicle Passport Generated</h4>
                  <p>
                    <strong>Passport ID:</strong>{" "}
                    {interStatePassport.passportId}
                  </p>
                  <p>
                    <strong>From State:</strong>{" "}
                    {interStatePassport.passport?.vehicle?.state}
                  </p>
                  <p>
                    <strong>To State:</strong> {interStateFormData.toState}
                  </p>
                  <p>
                    <strong>Valid For:</strong> 30 days
                  </p>
                  <p style={{ fontSize: "12px", color: "#666" }}>
                    <strong>Passport Hash:</strong>{" "}
                    {interStatePassport.passportHash?.substring(0, 20)}...
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Invoices Tab */}
        {activeTab === "invoices" && (
          <div className="card">
            <h3>My Invoices</h3>
            {invoices && invoices.length > 0 ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>Invoice No.</th>
                    <th>Vehicle</th>
                    <th>Status</th>
                    <th>Date</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr key={invoice._id}>
                      <td>{invoice.invoiceNumber}</td>
                      <td>
                        {invoice.vehicle?.make} {invoice.vehicle?.model}
                        {invoice.vehicle?.regNumber &&
                          ` (${invoice.vehicle.regNumber})`}
                      </td>
                      <td>
                        <span
                          className={`role-badge ${
                            invoice.status === "approved"
                              ? "role-rto"
                              : invoice.status === "rejected"
                                ? "role-reject"
                                : "role-owner"
                          }`}
                        >
                          {invoice.status.toUpperCase()}
                        </span>
                      </td>
                      <td>{formatDate(invoice.createdAt)}</td>
                      <td>
                        <button
                          className="btn btn-info"
                          onClick={() => navigate(`/invoice/${invoice._id}`)}
                        >
                          View Invoice
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p>
                No invoices found. Your vehicle purchase invoices will appear
                here after registration.
              </p>
            )}
          </div>
        )}

        {/* Challans Tab */}
        {activeTab === "challans" && (
          <div className="card">
            <h4>Pending Traffic Challans</h4>

            {totalPendingAmount > 0 && (
              <div
                style={{
                  background: "#fef3c7",
                  padding: "15px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                  border: "2px solid #f59e0b",
                }}
              >
                <strong style={{ fontSize: "16px", color: "#92400e" }}>
                  Total Pending Amount: ₹{formatMoney(totalPendingAmount)}
                </strong>
                <p
                  style={{
                    margin: "5px 0 0",
                    fontSize: "13px",
                    color: "#92400e",
                  }}
                >
                  Note: Vehicle transfer is blocked until all challans are
                  cleared. RTO will not approve any transfer requests with
                  pending dues.
                </p>
              </div>
            )}

            {challanListState === "loading" ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "50px 20px",
                  color: "#666",
                }}
              >
                <h3 style={{ margin: "0 0 8px" }}>
                  Checking the challan register…
                </h3>
              </div>
            ) : challanListState === "failed" ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "40px 20px",
                  background: "#fef3c7",
                  border: "2px solid #f59e0b",
                  borderRadius: "8px",
                  color: "#92400e",
                }}
              >
                <h3 style={{ margin: "0 0 8px" }}>
                  The challan list could not be read
                </h3>
                <p style={{ margin: "0 0 14px", fontSize: "14px" }}>
                  Nothing is claimed about your clearance while the register is
                  unreachable - it is not the same as having no dues.
                </p>
                <button
                  className="btn btn-outline-primary"
                  onClick={fetchPendingChallans}
                >
                  Try again
                </button>
              </div>
            ) : pendingChallans.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  padding: "60px 20px",
                  color: "#0e7c3b",
                }}
              >
                <div
                  style={{
                    display: "inline-block",
                    padding: "6px 18px",
                    border: "1px solid #0e7c3b",
                    borderRadius: 999,
                    color: "#0e7c3b",
                    fontWeight: 700,
                    letterSpacing: "1px",
                    fontSize: "14px",
                    textTransform: "uppercase",
                    marginBottom: "20px",
                  }}
                >
                  Clearance Verified
                </div>
                <h3 style={{ margin: "0 0 10px" }}>No Pending Challans</h3>
                <p style={{ margin: 0, fontSize: "14px", color: "#666" }}>
                  Your vehicle record is clear of all challan liabilities.
                </p>
              </div>
            ) : (
              <>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Vehicle</th>
                      <th>Violation Type</th>
                      <th>Description</th>
                      <th>Fine Amount</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingChallans.map((challan) => (
                      <tr key={challan._id}>
                        <td>
                          <strong>{challan.regNumber}</strong>
                        </td>
                        <td>
                          <span
                            className="role-badge"
                            style={{
                              background:
                                challan.violationType === "drunk_driving"
                                  ? "#ef4444"
                                  : "#f59e0b",
                              color: "white",
                            }}
                          >
                            {challan.violationType
                              .replace(/_/g, " ")
                              .toUpperCase()}
                          </span>
                        </td>
                        <td>{challan.violationDescription}</td>
                        <td>
                          <strong
                            style={{ color: "#ef4444", fontSize: "16px" }}
                          >
                            ₹
                            {formatMoney(
                              challan.fineAmount - (challan.paidAmount || 0),
                            )}
                          </strong>
                          {challan.paidAmount > 0 && (
                            <div style={{ fontSize: "12px", color: "#666" }}>
                              of ₹{formatMoney(challan.fineAmount)} — ₹
                              {formatMoney(challan.paidAmount)} already paid
                            </div>
                          )}
                        </td>
                        <td>
                          <button
                            className="btn btn-success"
                            onClick={() => {
                              setSelectedChallan({
                                _id: challan._id,
                                amount:
                                  challan.fineAmount -
                                  (challan.paidAmount || 0),
                                description: `${challan.violationType.replace(/_/g, " ").toUpperCase()} - ${challan.regNumber}`,
                              });
                              setShowChallanPayment(true);
                            }}
                            style={{
                              background:
                                "linear-gradient(135deg, #0e7c3b 0%, #14854a 100%)",
                            }}
                          >
                            Pay Now
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <div
                  style={{
                    marginTop: "20px",
                    padding: "15px",
                    background: "#f3f4f6",
                    borderRadius: "8px",
                    textAlign: "center",
                  }}
                >
                  <strong>Total Challans:</strong> {pendingChallans.length} |{" "}
                  <strong>Total Amount:</strong> ₹
                  {formatMoney(totalPendingAmount)}
                </div>
              </>
            )}
          </div>
        )}

        {/* Profile Tab */}
        {activeTab === "profile" && (
          <div className="card">
            <div className="profile-header">
              <h3>My Profile</h3>
              {!isEditingProfile ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => setIsEditingProfile(true)}
                >
                  Edit Profile
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    setIsEditingProfile(false);
                    loadProfileData();
                  }}
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="profile-photo-container">
              {profilePhotoUrl ? (
                <img
                  src={profilePhotoUrl}
                  alt="Profile"
                  className="profile-photo"
                />
              ) : (
                <div className="profile-photo-placeholder">
                  {profileData.name.charAt(0).toUpperCase()}
                </div>
              )}
              {isEditingProfile && (
                <div style={{ marginTop: "15px", textAlign: "center" }}>
                  <label
                    style={{
                      display: "inline-block",
                      padding: "8px 16px",
                      background: "#1e5aa8",
                      color: "#ffffff",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: "600",
                      fontSize: "0.85rem",
                    }}
                  >
                    Change Photo
                    <input
                      type="file"
                      accept="image/*"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          setProfilePhotoFile(file);
                          // Show preview
                          const previewUrl = URL.createObjectURL(file);
                          setProfilePhotoUrl(previewUrl);
                        }
                      }}
                    />
                  </label>
                  {profilePhotoFile && (
                    <p
                      style={{
                        color: "#0e7c3b",
                        fontSize: "0.8rem",
                        marginTop: "5px",
                      }}
                    >
                      New photo selected: {profilePhotoFile.name}
                    </p>
                  )}
                </div>
              )}
            </div>
            <form onSubmit={handleProfileSubmit}>
              <div className="row">
                <div className="col">
                  <div className="form-group">
                    <label>Full Name *</label>
                    <input
                      type="text"
                      name="name"
                      value={profileData.name}
                      onChange={(e) =>
                        setProfileData({ ...profileData, name: e.target.value })
                      }
                      required
                      disabled={!isEditingProfile}
                    />
                  </div>
                  <div className="form-group">
                    <label>Email *</label>
                    <input
                      type="email"
                      name="email"
                      value={profileData.email}
                      onChange={(e) =>
                        setProfileData({
                          ...profileData,
                          email: e.target.value,
                        })
                      }
                      required
                      disabled
                    />
                    <small style={{ color: "#666" }}>
                      Email cannot be changed
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Phone Number</label>
                    <input
                      type="tel"
                      name="phone"
                      value={profileData.phone}
                      onChange={(e) =>
                        setProfileData({
                          ...profileData,
                          phone: e.target.value,
                        })
                      }
                      placeholder="+91 9876543210"
                      disabled={!isEditingProfile}
                    />
                  </div>
                </div>
                <div className="col">
                  <div className="form-group">
                    <label>Address</label>
                    <textarea
                      name="address"
                      value={profileData.address}
                      onChange={(e) =>
                        setProfileData({
                          ...profileData,
                          address: e.target.value,
                        })
                      }
                      rows={3}
                      placeholder="Enter your full address"
                      disabled={!isEditingProfile}
                    />
                  </div>
                  <div className="form-group">
                    <label>Aadhaar Number </label>
                    <input
                      type="text"
                      name="aadhaarNumber"
                      value={profileData.aadhaarNumber}
                      placeholder="XXXX-XXXX-XXXX"
                      maxLength={12}
                      disabled={true}
                      style={{
                        backgroundColor: "#f5f5f5",
                        cursor: "not-allowed",
                      }}
                    />
                    <small
                      style={{
                        color: "var(--color-danger)",
                        fontWeight: "bold",
                      }}
                    >
                      Aadhaar number cannot be changed for security reasons
                    </small>
                  </div>
                  <div className="form-group">
                    <label>Driving License Number </label>
                    <input
                      type="text"
                      name="dlNumber"
                      value={profileData.dlNumber}
                      placeholder="DL Number"
                      disabled={true}
                      style={{
                        backgroundColor: "#f5f5f5",
                        cursor: "not-allowed",
                      }}
                    />
                    <small
                      style={{
                        color: "var(--color-danger)",
                        fontWeight: "bold",
                      }}
                    >
                      DL number cannot be changed for security reasons
                    </small>
                  </div>
                </div>
              </div>
              {isEditingProfile && (
                <button type="submit" className="btn btn-primary">
                  Save Profile
                </button>
              )}
            </form>
          </div>
        )}

        {showForm && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.5)",
              display: "flex",
              justifyContent: "center",
              alignItems: "center",
              zIndex: 2000,
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: "500px",
                width: "90%",
                maxHeight: "80vh",
                overflowY: "auto",
                backgroundColor: "white",
                padding: "30px",
                borderRadius: "8px",
                boxShadow: "0 4px 20px rgba(0, 0, 0, 0.15)",
              }}
            >
              <h3 style={{ marginBottom: "20px", color: "#2c3e50" }}>
                Sell Your Vehicle
              </h3>
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Vehicle ID: {formData.vehicleId}</label>
                  <p style={{ color: "#666", fontSize: "0.9rem" }}>
                    {vehicles.find((v) => v._id === formData.vehicleId)?.make}{" "}
                    {vehicles.find((v) => v._id === formData.vehicleId)?.model}{" "}
                    (
                    {vehicles.find((v) => v._id === formData.vehicleId)
                      ?.regNumber || "Not Assigned"}
                    )
                  </p>
                </div>
                <div className="form-group">
                  <label>Buyer Email *</label>
                  <input
                    type="email"
                    name="buyerEmail"
                    value={formData.buyerEmail}
                    onChange={handleChange}
                    placeholder="Enter buyer's email address"
                    required
                  />
                </div>

                {/* Workshop intelligence snapshot for this vehicle */}
                {sellIntel && (
                  <div className="form-group">
                    <label>Vehicle Intelligence (from workshop records)</label>
                    <div
                      style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}
                    >
                      <span className="intel-chip">
                        {sellIntel.serviceRecords} service record
                        {sellIntel.serviceRecords === 1 ? "" : "s"}
                      </span>
                      {sellIntel.latestService && (
                        <span className="intel-chip">
                          {" "}
                          {formatMoney(sellIntel.latestService.odometerKm) ??
                            sellIntel.latestService.odometerKm}{" "}
                          km
                          {sellIntel.latestService.date
                            ? ` (${formatDate(sellIntel.latestService.date)})`
                            : ""}
                        </span>
                      )}
                      <span className="intel-chip">
                        {sellIntel.partsTracked} parts tracked
                      </span>
                      <span
                        className={`intel-chip ${sellIntel.damageEvents > 0 ? "chip-warn" : ""}`}
                      >
                        {sellIntel.damageEvents} damage event
                        {sellIntel.damageEvents === 1 ? "" : "s"}
                      </span>
                      {sellIntel.battery?.currentSoH != null && (
                        <span
                          className={`intel-chip ${sellIntel.battery.currentSoH < 70 ? "chip-warn" : ""}`}
                        >
                          Battery {sellIntel.battery.currentSoH}% SOH
                        </span>
                      )}
                    </div>
                    <small style={{ color: "#666" }}>
                      This data is attached to the vehicle and will be inherited
                      by the buyer after transfer.
                    </small>
                  </div>
                )}

                <div className="form-group">
                  <label>Sale Price (₹)</label>
                  <input
                    type="number"
                    name="salePrice"
                    min="0"
                    value={formData.salePrice}
                    onChange={handleChange}
                    placeholder="e.g. 450000"
                  />
                </div>
                <div className="form-group">
                  <label>Message to Buyer</label>
                  <textarea
                    name="message"
                    value={formData.message}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Optional note shown with the offer (reason for sale, contact info, etc.)"
                  />
                </div>
                <div className="form-group">
                  <label
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="checkbox"
                      name="attachIntel"
                      checked={formData.attachIntel}
                      onChange={handleChange}
                      style={{ width: "auto" }}
                    />
                    Attach full vehicle intelligence report to this transfer
                  </label>
                  <small style={{ color: "#666" }}>
                    The buyer will see service history, odometer timeline, parts
                    provenance, damage events and battery passport before
                    accepting.
                  </small>
                </div>

                <div
                  style={{
                    display: "flex",
                    gap: "10px",
                    marginTop: "20px",
                  }}
                >
                  <button type="submit" className="btn btn-success">
                    Send Sale Offer to Buyer
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setShowForm(false)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
        <footer className="dashboard-footer">
          <p>© 2026 BioChain RTO System • Digital India Initiative</p>
        </footer>

        {/* Dual Biometric Verification Modal */}
        <DualBiometricVerification
          isOpen={showBiometricVerification}
          onClose={() => {
            setShowBiometricVerification(false);
            setPendingTransfer(null);
          }}
          onSuccess={handleBiometricSuccess}
          person1Name={user?.name || "Seller"}
          person1Role="owner"
          person2Name="Buyer"
          person2Role="owner"
          transactionType="ownership-transfer"
        />

        {/* Challan Payment Modal */}
        <DemoPaymentModal
          isOpen={showChallanPayment}
          onClose={() => {
            setShowChallanPayment(false);
            setSelectedChallan(null);
          }}
          amount={selectedChallan?.amount || 0}
          title="Pay Traffic Challan"
          description={selectedChallan?.description || "Traffic Violation Fine"}
          onSuccess={handleChallanPayment}
        />
      </div>
    </DashboardLayout>
  );
}
