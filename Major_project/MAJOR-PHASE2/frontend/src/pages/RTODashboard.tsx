import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../context/useAuth";
import { useNavigate, useLocation } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import ChallanManagement from "../components/ChallanManagement";
import AccidentEvidenceReview from "../components/AccidentEvidenceReview";
import InterStateApprovals from "../components/InterStateApprovals";
import VehicleDocuments from "../components/VehicleDocuments";

import type {
  TransferRequest,
  InheritanceRequest,
  TheftReportAdmin,
} from "../types/api";
import { formatDate } from "../lib/display";
import { notify } from "../lib/notify";
import { OverviewBand } from "../lib/OverviewBand";
import { BIO } from "../lib/ui-tokens";

export default function RTODashboard() {
  const { api } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [inheritanceRequests, setInheritanceRequests] = useState<
    InheritanceRequest[]
  >([]);
  const [theftReports, setTheftReports] = useState<TheftReportAdmin[]>([]);
  const [regNumber, setRegNumber] = useState("");
  const [activeTabState, setActiveTabState] = useState("requests");

  // A notification's action link (/rto?tab=accidents) opens the right section
  // directly: while the URL carries a tab it wins over local state.
  const urlTab = new URLSearchParams(location.search).get("tab");
  const activeTab = urlTab ?? activeTabState;
  const setActiveTab = (tab: string) => {
    setActiveTabState(tab);
    navigate(tab === "accidents" ? `/rto?tab=${tab}` : "/rto", {
      replace: true,
    });
  };
  const [approvedTxHashes, setApprovedTxHashes] = useState<{
    [key: string]: string;
  }>({});
  const [inheritanceTxHashes, setInheritanceTxHashes] = useState<{
    [key: string]: string;
  }>({});
  const [theftTxHashes, setTheftTxHashes] = useState<{
    [key: string]: string;
  }>({});

  // A rejection needs a reason on record, but prompt() freezes the entire page
  // until an answer arrives. The reason is typed into the row instead, and the
  // pending id decides which row shows the box.
  const [pendingReject, setPendingReject] = useState<string | null>(null);
  const [pendingInheritanceReject, setPendingInheritanceReject] = useState<
    string | null
  >(null);
  const [rejectReason, setRejectReason] = useState("");
  // Chart/KPI click-to-filter for the transfer-requests table (client-side only).
  const [statusFilter, setStatusFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<string | null>(null);

  const fetchAllData = useCallback(async () => {
    try {
      const reqRes = await api.get("/requests/all");
      setRequests(reqRes.data);

      const inhRes = await api.get("/inheritance/requests");
      setInheritanceRequests(inhRes.data);

      const theftRes = await api.get("/theft/reports");
      setTheftReports(theftRes.data);
    } catch {
      // Queues stay empty when the officer's listings cannot be served.
    }
  }, [api]);

  useEffect(() => {
    const fetchData = async () => {
      await fetchAllData();
    };
    fetchData();
  }, [fetchAllData]);

  const handleApprove = async (id: string) => {
    try {
      const response = await api.post(`/requests/${id}/approve`, { regNumber });
      notify("Request approved.", "success");
      setRegNumber("");

      // Capture transaction hash if returned
      if (response.data.txHash) {
        setApprovedTxHashes({
          ...approvedTxHashes,
          [id]: response.data.txHash,
        });
      }

      fetchAllData();
    } catch (err: unknown) {
      // The API's own reason (a blocked transfer, a missing document) is far more
      // useful to the officer than a generic "Error approving request".
      notify(
        err instanceof Error ? err.message : "Could not approve this request",
        "error",
      );
    }
  };

  const handleReject = async (id: string, remarks: string) => {
    try {
      await api.post(`/requests/${id}/reject`, { remarks });
      setPendingReject(null);
      setRejectReason("");
      notify("Request rejected.", "success");
      fetchAllData();
    } catch (err: unknown) {
      notify(
        err instanceof Error ? err.message : "Could not reject this request",
        "error",
      );
    }
  };

  // An officer cannot verify a document he has never seen. The bytes come out of
  // the verified store, so a file altered after upload is refused instead of shown.
  const openInheritanceDocument = async (id: string, index: number) => {
    try {
      const res = await api.get(
        `/inheritance/requests/${id}/documents/${index}`,
        { responseType: "blob" },
      );
      const url = URL.createObjectURL(res.data as Blob);
      const opened = window.open(url, "_blank");
      if (!opened) {
        notify(
          "The browser blocked this window. Allow pop-ups to view the document.",
          "error",
        );
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err: unknown) {
      notify(
        err instanceof Error ? err.message : "Could not open this document",
        "error",
      );
    }
  };

  const handleInheritanceDocumentVerify = async (id: string) => {
    try {
      await api.put(`/inheritance/requests/${id}/verify-documents`, {
        documentVerifications: [],
        remarks: "Documents verified by RTO officer",
      });
      fetchAllData();
    } catch (err: unknown) {
      notify(
        err instanceof Error ? err.message : "Could not verify these documents",
        "error",
      );
    }
  };

  const handleInheritanceApprove = async (id: string) => {
    try {
      const response = await api.put(`/inheritance/requests/${id}/approve`, {
        regNumber,
      });
      setRegNumber("");

      // Capture transaction hash if returned
      if (response.data.txHash) {
        setInheritanceTxHashes({
          ...inheritanceTxHashes,
          [id]: response.data.txHash,
        });
      }

      notify("Inheritance transfer approved.", "success");
      fetchAllData();
    } catch (err: unknown) {
      notify(
        err instanceof Error
          ? err.message
          : "Could not approve this inheritance transfer",
        "error",
      );
    }
  };

  const handleInheritanceReject = async (id: string, remarks: string) => {
    try {
      await api.put(`/inheritance/requests/${id}/reject`, { remarks });
      setPendingInheritanceReject(null);
      setRejectReason("");
      notify("Inheritance transfer rejected.", "success");
      fetchAllData();
    } catch (err: unknown) {
      notify(
        err instanceof Error
          ? err.message
          : "Could not reject this inheritance transfer",
        "error",
      );
    }
  };

  const handleTheftStatusUpdate = async (id: string, status: string) => {
    try {
      const response = await api.put(`/theft/reports/${id}`, { status });

      // Capture transaction hash if marking as recovered
      if (status === "recovered" && response.data.txHash) {
        setTheftTxHashes({ ...theftTxHashes, [id]: response.data.txHash });
      }

      fetchAllData();
    } catch (err: unknown) {
      notify(
        err instanceof Error
          ? err.message
          : "Could not update this theft report",
        "error",
      );
    }
  };

  // Every band figure is counted from the arrays this page already loaded -
  // nothing extra is fetched and no number is invented.
  const band = useMemo(() => {
    const count = <T,>(arr: T[], pred: (x: T) => boolean) =>
      arr.filter(pred).length;
    const pending = count(requests, (r) => r.status === "pending");
    const approved = count(requests, (r) => r.status === "approved");
    const rejected = count(requests, (r) => r.status === "rejected");
    const inhPending = count(
      inheritanceRequests,
      (r) => r.status !== "approved" && r.status !== "rejected",
    );
    const theftOpen = count(
      theftReports,
      (r) => r.status === "reported" || r.status === "under_investigation",
    );
    const theftRecovered = count(
      theftReports,
      (r) => r.status === "recovered" || r.status === "closed",
    );
    const kpis = [
      {
        label: "Transfer requests",
        value: requests.length,
        sub: "Loaded queue",
        accent: BIO.blue,
        onClick: () => {
          setStatusFilter(null);
          setTypeFilter(null);
        },
      },
      {
        label: "Pending transfers",
        value: pending,
        sub: "Awaiting your action",
        accent: BIO.amber,
        onClick: () =>
          setStatusFilter(statusFilter === "pending" ? null : "pending"),
      },
      {
        label: "Approved",
        value: approved,
        sub: "Cleared by this RTO",
        accent: BIO.green,
        onClick: () =>
          setStatusFilter(statusFilter === "approved" ? null : "approved"),
      },
      {
        label: "Inheritance pending",
        value: inhPending,
        sub: "Open claims",
        accent: BIO.violet,
        onClick: () => setActiveTab("inheritance"),
      },
      {
        label: "Theft open",
        value: theftOpen,
        sub: "Reported / investigating",
        accent: BIO.red,
        onClick: () => setActiveTab("theft"),
      },
      {
        label: "Theft recovered",
        value: theftRecovered,
        sub: "Recovered / closed",
        accent: BIO.green,
      },
    ];
    const pie = [
      { key: "pending", name: "Pending", value: pending, color: BIO.amber },
      { key: "approved", name: "Approved", value: approved, color: BIO.green },
      { key: "rejected", name: "Rejected", value: rejected, color: BIO.red },
    ].filter((s) => s.value > 0);
    const typeMap = new Map<string, number>();
    requests.forEach((r) => {
      const t = r.type || "other";
      typeMap.set(t, (typeMap.get(t) || 0) + 1);
    });
    const bars = [...typeMap.entries()].map(([label, value]) => ({
      key: label,
      label,
      value,
    }));
    return { kpis, pie, bars };
  }, [requests, inheritanceRequests, theftReports, statusFilter, typeFilter]);

  const visibleRequests = requests.filter(
    (r) =>
      (!statusFilter || r.status === statusFilter) &&
      (!typeFilter || r.type === typeFilter),
  );
  const bandFilter =
    [
      statusFilter && `status: ${statusFilter}`,
      typeFilter && `type: ${typeFilter}`,
    ]
      .filter(Boolean)
      .join("  \u00b7  ") || null;

  return (
    <DashboardLayout
      title="RTO Administrative Dashboard"
      subtitle="Approve transfers, theft and inheritance requests"
      activeSection={activeTab}
    >
      <div className="container">
        <OverviewBand
          kpis={band.kpis}
          pie={band.pie}
          pieTitle="Transfer requests by status"
          bars={band.bars}
          barsTitle="Requests by type"
          activeSliceKey={statusFilter}
          activeBarKey={typeFilter}
          onPieSelect={(k) => setStatusFilter(statusFilter === k ? null : k)}
          onBarSelect={(k) => setTypeFilter(typeFilter === k ? null : k)}
          filterLabel={bandFilter}
          onClearFilter={() => {
            setStatusFilter(null);
            setTypeFilter(null);
          }}
        />
        <div className="card">
          <h3>Administrative Dashboard</h3>

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-btn ${activeTab === "requests" ? "active" : ""}`}
              onClick={() => setActiveTab("requests")}
            >
              Transfer Requests
            </button>
            <button
              className={`tab-btn ${activeTab === "inheritance" ? "active" : ""}`}
              onClick={() => setActiveTab("inheritance")}
            >
              Inheritance Transfers
            </button>
            <button
              className={`tab-btn ${activeTab === "theft" ? "active" : ""}`}
              onClick={() => setActiveTab("theft")}
            >
              Theft Reports
            </button>
            <button
              className={`tab-btn ${activeTab === "challans" ? "active" : ""}`}
              onClick={() => setActiveTab("challans")}
            >
              Challans
            </button>
            <button
              className={`tab-btn ${activeTab === "interstate" ? "active" : ""}`}
              onClick={() => setActiveTab("interstate")}
            >
              Inter-State
            </button>
            <button
              className={`tab-btn ${activeTab === "documents" ? "active" : ""}`}
              onClick={() => setActiveTab("documents")}
            >
              Vehicle Documents
            </button>
            <button
              className={`tab-btn ${activeTab === "accidents" ? "active" : ""}`}
              onClick={() => setActiveTab("accidents")}
            >
              Accident Uploads
            </button>
          </div>

          {/* Transfer Requests Tab */}
          {activeTab === "requests" && (
            <div>
              <h4>Pending Transfer Requests</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Type</th>
                    <th>Vehicle</th>
                    <th>Seller</th>
                    <th>Buyer</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRequests.map((req) => (
                    <tr key={req._id}>
                      <td>{req.type}</td>
                      <td>
                        {req.vehicle?.make} {req.vehicle?.model} (
                        {req.vehicle?.regNumber || "N/A"})
                      </td>
                      <td>{req.seller?.name || req.dealer?.name}</td>
                      <td>{req.buyer?.name}</td>
                      <td>
                        <span
                          className={`role-badge ${
                            req.status === "approved"
                              ? "role-rto"
                              : req.status === "rejected"
                                ? "role-reject"
                                : "role-owner"
                          }`}
                        >
                          {req.status}
                        </span>
                        {req.type === "transfer" && req.offer && (
                          <div style={{ marginTop: "6px" }}>
                            {req.offer.buyerAccepted ? (
                              <span className="role-badge role-rto">
                                Buyer accepted
                              </span>
                            ) : (
                              <span className="role-badge role-dealer">
                                Awaiting buyer
                              </span>
                            )}
                            {req.offer.attachIntel && (
                              <span
                                className="role-badge role-owner"
                                title="Full vehicle intelligence attached for the buyer"
                              >
                                Intel
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td>
                        {req.status === "pending" && (
                          <>
                            {req.type === "newRegistration" && (
                              <>
                                <button
                                  className="btn btn-info"
                                  onClick={() =>
                                    navigate(`/invoice/${req._id}`)
                                  }
                                  style={{ marginRight: "8px" }}
                                >
                                  View Invoice
                                </button>
                                <input
                                  type="text"
                                  placeholder="Reg Number"
                                  value={regNumber}
                                  onChange={(e) => setRegNumber(e.target.value)}
                                  style={{
                                    width: "120px",
                                    marginRight: "10px",
                                  }}
                                />
                              </>
                            )}
                            <button
                              className="btn btn-success"
                              onClick={() => handleApprove(req._id)}
                              disabled={
                                req.type === "newRegistration" &&
                                regNumber.trim() === ""
                              }
                              title={
                                req.type === "newRegistration"
                                  ? "Type the registration number to issue before approving"
                                  : "Approve this request"
                              }
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-danger"
                              style={{ marginLeft: "5px" }}
                              onClick={() => {
                                setRejectReason("");
                                setPendingInheritanceReject(null);
                                setPendingReject(
                                  pendingReject === req._id ? null : req._id,
                                );
                              }}
                            >
                              Reject
                            </button>
                            {pendingReject === req._id && (
                              <span
                                style={{
                                  marginLeft: "8px",
                                  display: "inline-flex",
                                  gap: "6px",
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  type="text"
                                  placeholder="Reason for rejection"
                                  value={rejectReason}
                                  onChange={(e) =>
                                    setRejectReason(e.target.value)
                                  }
                                  style={{ width: "180px" }}
                                />
                                <button
                                  className="btn btn-danger"
                                  disabled={rejectReason.trim() === ""}
                                  onClick={() =>
                                    handleReject(req._id, rejectReason.trim())
                                  }
                                >
                                  Confirm Reject
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => {
                                    setPendingReject(null);
                                    setRejectReason("");
                                  }}
                                >
                                  Cancel
                                </button>
                              </span>
                            )}
                          </>
                        )}
                        {req.status === "approved" && req.vehicle?._id && (
                          <div
                            className="action-buttons"
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              gap: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <button
                              className="btn btn-info"
                              onClick={() =>
                                navigate(`/rc-card/${req.vehicle?._id}`)
                              }
                              style={{ display: "inline-flex" }}
                            >
                              RC Certificate
                            </button>
                            {req.vehicle.blockchainTxHash ? (
                              <a
                                href={`https://amoy.polygonscan.com/tx/${req.vehicle.blockchainTxHash}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-info"
                                style={{
                                  textDecoration: "none",
                                  display: "inline-flex",
                                }}
                              >
                                View Blockchain Tx
                              </a>
                            ) : req.status === "approved" ? (
                              <span
                                style={{
                                  padding: "8px 16px",
                                  background: "#b45309",
                                  color: "white",
                                  borderRadius: "6px",
                                  fontSize: "12px",
                                  fontWeight: "bold",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: "6px",
                                }}
                                title="Blockchain transaction pending - will be created when next available"
                              >
                                Blockchain Pending
                              </span>
                            ) : null}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Inheritance Transfers Tab */}
          {activeTab === "inheritance" && (
            <div>
              <h4>Inheritance Transfer Requests</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Deceased Owner</th>
                    <th>Legal Heir</th>
                    <th>Death Cert</th>
                    <th>Documents</th>
                    <th>Relationship</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {inheritanceRequests.map((req) => (
                    <tr key={req._id}>
                      <td>
                        {req.vehicle?.regNumber || "N/A"} <br />{" "}
                        {req.vehicle?.make} {req.vehicle?.model}
                      </td>
                      <td>{req.deceasedOwner?.name}</td>
                      <td>{req.legalHeir?.name}</td>
                      <td>{req.deathCertificateNumber}</td>
                      <td>
                        {req.documents?.length ? (
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              gap: "4px",
                            }}
                          >
                            {req.documents.map((doc, index) =>
                              doc.documentUrl ? (
                                <button
                                  key={`${doc.documentType}-${index}`}
                                  className="btn btn-secondary"
                                  style={{
                                    padding: "2px 8px",
                                    fontSize: "12px",
                                  }}
                                  onClick={() =>
                                    openInheritanceDocument(req._id, index)
                                  }
                                >
                                  {doc.documentType.replace(/_/g, " ")}
                                  {doc.verified ? " (verified)" : ""}
                                </button>
                              ) : (
                                // Claim recorded before documents were kept on
                                // file: list it, but never offer a button that
                                // has nothing behind it.
                                <span
                                  key={`${doc.documentType}-${index}`}
                                  className="text-muted"
                                  style={{ fontSize: "12px" }}
                                  title="This claim was recorded before document storage was in place, so no copy is held"
                                >
                                  {doc.documentType.replace(/_/g, " ")} (no
                                  stored copy)
                                </span>
                              ),
                            )}
                          </div>
                        ) : (
                          <span>No document attached</span>
                        )}
                      </td>
                      <td>{req.relationshipToDeceased}</td>
                      <td>
                        <span
                          className={`role-badge ${
                            req.status === "approved"
                              ? "role-rto"
                              : req.status === "rejected"
                                ? "role-reject"
                                : "role-owner"
                          }`}
                        >
                          {req.status}
                        </span>
                      </td>
                      <td>
                        {req.status === "submitted" && (
                          <div
                            className="action-buttons"
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              gap: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <button
                              className="btn btn-primary"
                              onClick={() =>
                                handleInheritanceDocumentVerify(req._id)
                              }
                              style={{ display: "inline-flex" }}
                            >
                              Verify Docs
                            </button>
                            {(req.vehicle?.blockchainTxHash ||
                              inheritanceTxHashes[req._id]) && (
                              <a
                                href={`https://amoy.polygonscan.com/tx/${
                                  req.vehicle?.blockchainTxHash ||
                                  inheritanceTxHashes[req._id]
                                }`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-info"
                                style={{
                                  textDecoration: "none",
                                  display: "inline-flex",
                                }}
                              >
                                View Blockchain Tx
                              </a>
                            )}
                          </div>
                        )}
                        {req.status === "documents_verified" && (
                          <div
                            className="action-buttons"
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              gap: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <input
                              type="text"
                              placeholder="Reg Number"
                              value={regNumber}
                              onChange={(e) => setRegNumber(e.target.value)}
                              style={{ width: "120px" }}
                            />
                            <button
                              className="btn btn-success"
                              onClick={() => handleInheritanceApprove(req._id)}
                              style={{ display: "inline-flex" }}
                            >
                              Approve
                            </button>
                            <button
                              className="btn btn-danger"
                              onClick={() => {
                                setRejectReason("");
                                setPendingReject(null);
                                setPendingInheritanceReject(
                                  pendingInheritanceReject === req._id
                                    ? null
                                    : req._id,
                                );
                              }}
                              style={{ display: "inline-flex" }}
                            >
                              Reject
                            </button>
                            {pendingInheritanceReject === req._id && (
                              <span
                                style={{
                                  display: "inline-flex",
                                  gap: "6px",
                                  alignItems: "center",
                                }}
                              >
                                <input
                                  type="text"
                                  placeholder="Reason for rejection"
                                  value={rejectReason}
                                  onChange={(e) =>
                                    setRejectReason(e.target.value)
                                  }
                                  style={{ width: "160px" }}
                                />
                                <button
                                  className="btn btn-danger"
                                  disabled={rejectReason.trim() === ""}
                                  onClick={() =>
                                    handleInheritanceReject(
                                      req._id,
                                      rejectReason.trim(),
                                    )
                                  }
                                >
                                  Confirm
                                </button>
                                <button
                                  className="btn btn-secondary"
                                  onClick={() => {
                                    setPendingInheritanceReject(null);
                                    setRejectReason("");
                                  }}
                                >
                                  Cancel
                                </button>
                              </span>
                            )}
                            {(req.vehicle?.blockchainTxHash ||
                              inheritanceTxHashes[req._id]) && (
                              <a
                                href={`https://amoy.polygonscan.com/tx/${
                                  req.vehicle?.blockchainTxHash ||
                                  inheritanceTxHashes[req._id]
                                }`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-info"
                                style={{
                                  textDecoration: "none",
                                  display: "inline-flex",
                                }}
                              >
                                View Blockchain Tx
                              </a>
                            )}
                          </div>
                        )}
                        {req.status === "approved" && req.vehicle?._id && (
                          <div
                            className="action-buttons"
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              gap: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <button
                              className="btn btn-info"
                              onClick={() =>
                                navigate(`/rc-card/${req.vehicle?._id}`)
                              }
                              style={{ display: "inline-flex" }}
                            >
                              RC Certificate
                            </button>
                            {(req.vehicle.blockchainTxHash ||
                              inheritanceTxHashes[req._id]) && (
                              <a
                                href={`https://amoy.polygonscan.com/tx/${
                                  req.vehicle.blockchainTxHash ||
                                  inheritanceTxHashes[req._id]
                                }`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-info"
                                style={{
                                  textDecoration: "none",
                                  display: "inline-flex",
                                }}
                              >
                                View Blockchain Tx
                              </a>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Theft Reports Tab */}
          {activeTab === "theft" && (
            <div>
              <h4>Active Theft Reports</h4>
              <table className="table">
                <thead>
                  <tr>
                    <th>Vehicle</th>
                    <th>Reporter</th>
                    <th>Police Station</th>
                    <th>FIR Number</th>
                    <th>Incident Date</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {theftReports.map((report) => (
                    <tr key={report._id}>
                      <td>
                        {report.vehicle?.regNumber || "N/A"} <br />{" "}
                        {report.vehicle?.make} {report.vehicle?.model}
                      </td>
                      <td>{report.reporter?.name}</td>
                      <td>{report.policeStation}</td>
                      <td>{report.firNumber}</td>
                      <td>{formatDate(report.incidentDate)}</td>
                      <td>
                        <span
                          className={`role-badge ${
                            report.status === "recovered"
                              ? "role-rto"
                              : report.status === "closed"
                                ? "role-owner"
                                : "role-reject"
                          }`}
                        >
                          {report.status}
                        </span>
                      </td>
                      <td>
                        {report.status === "reported" && (
                          <div
                            className="action-buttons"
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              gap: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <select
                              onChange={(e) =>
                                handleTheftStatusUpdate(
                                  report._id,
                                  e.target.value,
                                )
                              }
                              defaultValue=""
                              style={{ width: "120px" }}
                            >
                              <option value="" disabled>
                                Select Action
                              </option>
                              <option value="under_investigation">
                                Under Investigation
                              </option>
                              <option value="recovered">
                                Mark as Recovered
                              </option>
                              <option value="closed">Close Case</option>
                            </select>
                            {(report.vehicle?.blockchainTxHash ||
                              theftTxHashes[report._id]) && (
                              <a
                                href={`https://amoy.polygonscan.com/tx/${
                                  report.vehicle?.blockchainTxHash ||
                                  theftTxHashes[report._id]
                                }`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-info"
                                style={{
                                  textDecoration: "none",
                                  display: "inline-flex",
                                }}
                              >
                                View Blockchain Tx
                              </a>
                            )}
                          </div>
                        )}
                        {report.status === "under_investigation" && (
                          <div
                            className="action-buttons"
                            style={{
                              display: "flex",
                              flexDirection: "row",
                              gap: "8px",
                              whiteSpace: "nowrap",
                            }}
                          >
                            <select
                              onChange={(e) =>
                                handleTheftStatusUpdate(
                                  report._id,
                                  e.target.value,
                                )
                              }
                              defaultValue=""
                              style={{ width: "120px" }}
                            >
                              <option value="" disabled>
                                Select Action
                              </option>
                              <option value="recovered">
                                Mark as Recovered
                              </option>
                              <option value="closed">Close Case</option>
                            </select>
                            {(report.vehicle?.blockchainTxHash ||
                              theftTxHashes[report._id]) && (
                              <a
                                href={`https://amoy.polygonscan.com/tx/${
                                  report.vehicle?.blockchainTxHash ||
                                  theftTxHashes[report._id]
                                }`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="btn btn-info"
                                style={{
                                  textDecoration: "none",
                                  display: "inline-flex",
                                }}
                              >
                                View Blockchain Tx
                              </a>
                            )}
                          </div>
                        )}
                        {report.status === "recovered" &&
                          report.vehicle?._id && (
                            <div
                              className="action-buttons"
                              style={{
                                display: "flex",
                                flexDirection: "row",
                                gap: "8px",
                                whiteSpace: "nowrap",
                              }}
                            >
                              <button
                                className="btn btn-info"
                                onClick={() =>
                                  navigate(`/rc-card/${report.vehicle?._id}`)
                                }
                                style={{ display: "inline-flex" }}
                              >
                                RC Certificate
                              </button>
                              {(report.vehicle.blockchainTxHash ||
                                theftTxHashes[report._id]) && (
                                <a
                                  href={`https://amoy.polygonscan.com/tx/${
                                    report.vehicle.blockchainTxHash ||
                                    theftTxHashes[report._id]
                                  }`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="btn btn-info"
                                  style={{
                                    textDecoration: "none",
                                    display: "inline-flex",
                                  }}
                                >
                                  View Blockchain Tx
                                </a>
                              )}
                            </div>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Challans Tab - RTO officers can issue and manage traffic fines */}
          {activeTab === "challans" && <ChallanManagement />}

          {/* Inter-State Tab - NOC + destination approval workflow */}
          {activeTab === "interstate" && <InterStateApprovals />}

          {/* Vehicle Documents Tab - IPFS records with verification and signature */}
          {activeTab === "documents" && <VehicleDocuments />}

          {/* Owner-uploaded accident evidence, for RTO verification as well */}
          {activeTab === "accidents" && <AccidentEvidenceReview />}
        </div>
        <footer className="dashboard-footer">
          <p>© 2026 BioChain RTO System • Digital India Initiative</p>
        </footer>
      </div>
    </DashboardLayout>
  );
}
