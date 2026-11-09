import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import VehicleDocuments from "../components/VehicleDocuments";
import {
  DataTable,
  SectionCard,
  KpiCard,
  KpiStrip,
  StatusPill,
  type Column,
} from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import { formatDate } from "../lib/display";

interface RegistrationCertificate {
  id: string;
  regNumber: string;
  vehicle: string;
  type: string;
}

interface TransferCertificate {
  id: string;
  vehicle: string;
  status: "approved" | "rejected" | "pending";
  date: string;
}

interface Invoice {
  id: string;
  vehicle: string;
  invoiceNumber: string;
  status: "approved" | "rejected" | "pending";
  date: string;
}

interface UserDocuments {
  registrationCertificates: RegistrationCertificate[];
  transferCertificates: TransferCertificate[];
  invoices: Invoice[];
}

const Documents = () => {
  const { api } = useAuth();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<UserDocuments | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchUserDocuments = useCallback(async () => {
    try {
      setLoading(true);
      const response = await api.get("/documents/user-documents");
      setDocuments(response.data);
      setError("");
    } catch {
      // The error banner below is the user-facing signal; nothing goes to the log.
      setError("Failed to load documents");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchUserDocuments();
  }, [fetchUserDocuments]);

  // The certificates and invoices each have a printable view in the app, so the
  // actions navigate there instead of pretending to download a file.
  const handleViewRegistrationCertificate = (vehicleId: string) => {
    navigate(`/rc-card/${vehicleId}`);
  };

  const rcColumns: Column<RegistrationCertificate>[] = [
    { key: "regNumber", header: "Reg Number", value: (r) => r.regNumber || "N/A" },
    { key: "vehicle", header: "Vehicle" },
    { key: "type", header: "Type" },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (r) => (
        <button
          className="btn btn-sm btn-primary"
          onClick={() => handleViewRegistrationCertificate(r.id)}
        >
          View RC
        </button>
      ),
    },
  ];

  const tcColumns: Column<TransferCertificate>[] = [
    { key: "vehicle", header: "Vehicle" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={r.status}
          label={r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        />
      ),
    },
    { key: "date", header: "Date", value: (r) => r.date, render: (r) => formatDate(r.date) },
    {
      key: "action",
      header: "Outcome",
      sortable: false,
      render: (r) =>
        r.status === "approved"
          ? "Issued"
          : r.status === "rejected"
            ? "Not issued"
            : "Awaiting RTO approval",
    },
  ];

  const invColumns: Column<Invoice>[] = [
    {
      key: "invoiceNumber",
      header: "Invoice No.",
      value: (r) => r.invoiceNumber || "Number not recorded",
    },
    { key: "vehicle", header: "Vehicle" },
    {
      key: "status",
      header: "Status",
      render: (r) => (
        <StatusPill
          status={r.status}
          label={r.status.charAt(0).toUpperCase() + r.status.slice(1)}
        />
      ),
    },
    { key: "date", header: "Date", value: (r) => r.date, render: (r) => formatDate(r.date) },
    {
      key: "actions",
      header: "Actions",
      sortable: false,
      render: (r) => (
        <button
          className="btn btn-sm btn-primary"
          onClick={() => navigate(`/invoice/${r.id}`)}
        >
          View Invoice
        </button>
      ),
    },
  ];

  if (loading) {
    return (
      <div className="container">
        <SectionCard title="Loading Documents">
          <p>Please wait while we fetch your documents.</p>
        </SectionCard>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container">
        <SectionCard title="Error Loading Documents">
          <p>{error}</p>
          <button className="btn btn-primary" onClick={fetchUserDocuments}>
            Retry
          </button>
        </SectionCard>
      </div>
    );
  }

  return (
    <DashboardLayout
      title="My Documents"
      subtitle="Registration certificates, transfer certificates and invoices"
    >
      <div className="container">
        <VehicleDocuments />

        <div style={{ marginBottom: 16 }}>
          <KpiStrip>
            <KpiCard
              label="Registration Certificates"
              value={documents?.registrationCertificates.length ?? 0}
              sub="issued RC cards"
              accent={BIO.blue}
            />
            <KpiCard
              label="Transfer Certificates"
              value={documents?.transferCertificates.length ?? 0}
              sub={`${(documents?.transferCertificates ?? []).filter((t) => t.status === "pending").length} awaiting approval`}
              accent={BIO.violet}
            />
            <KpiCard
              label="Invoices"
              value={documents?.invoices.length ?? 0}
              sub="purchase invoices"
              accent={BIO.green}
            />
          </KpiStrip>
        </div>

        <SectionCard
          title="Registration Certificates"
          subtitle="Printable RC cards recorded against your vehicles"
          style={{ marginBottom: 16 }}
        >
          <DataTable
            rows={documents?.registrationCertificates ?? []}
            columns={rcColumns}
            rowKey={(r) => r.id}
            emptyTitle="No registration certificates"
            emptyHint="RC cards appear here once a vehicle registration is recorded."
          />
        </SectionCard>

        <SectionCard
          title="Transfer Certificates"
          subtitle="Ownership transfer outcomes"
          style={{ marginBottom: 16 }}
        >
          <DataTable
            rows={documents?.transferCertificates ?? []}
            columns={tcColumns}
            rowKey={(r) => r.id}
            emptyTitle="No transfer certificates"
            emptyHint="Transfer certificates appear here after a transfer is processed."
          />
        </SectionCard>

        <SectionCard
          title="Invoices"
          subtitle="Purchase invoices raised for your vehicles"
          style={{ marginBottom: 16 }}
        >
          <DataTable
            rows={documents?.invoices ?? []}
            columns={invColumns}
            rowKey={(r) => r.id}
            emptyTitle="No invoices"
            emptyHint="Purchase invoices appear here after registration."
          />
        </SectionCard>
      </div>
    </DashboardLayout>
  );
};

export default Documents;
