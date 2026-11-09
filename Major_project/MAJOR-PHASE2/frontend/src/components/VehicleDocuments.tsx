// VehicleDocuments.tsx
// Owner/RTO surface for the vehicle document record (Workflow 2 - document
// storage under a content hash, RTO verification and digital signature).
// Upload stores the file content and registers the metadata row; the RTO
// officer then verifies or rejects and may apply a digital signature.
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../context/useAuth";
import DocumentPreview from "./DocumentPreview";
import { formatDate, enumLabel } from "../lib/display";

interface VehicleOption {
  _id: string;
  regNumber?: string;
  make?: string;
  model?: string;
}

interface VehicleDocument {
  _id: string;
  type: string;
  name: string;
  ipfsHash?: string;
  fileUrl?: string;
  mimeType?: string;
  verificationStatus: "pending" | "verified" | "rejected";
  expiryDate?: string;
  daysUntilExpiry?: number;
  expiryStatus?: "expired" | "expiring-soon" | "valid";
  digitalSignature?: { signature?: string };
  uploadedAt?: string;
}

const DOCUMENT_TYPES = [
  { value: "rc", label: "Registration Certificate" },
  { value: "insurance", label: "Insurance" },
  { value: "puc", label: "Pollution Under Control (PUC)" },
  { value: "transfer", label: "Transfer Forms" },
  { value: "invoice", label: "Invoice" },
  { value: "other", label: "Other Document" },
];

const typeLabel = (type: string) =>
  DOCUMENT_TYPES.find((t) => t.value === type)?.label || type.toUpperCase();

const statusStyle = (status: string): React.CSSProperties => {
  const token =
    status === "verified"
      ? "var(--color-success)"
      : status === "rejected"
        ? "var(--color-danger)"
        : "var(--color-warning)";
  return {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 999,
    border: `1px solid ${token}`,
    color: token,
    background: "var(--color-bg-secondary)",
    fontSize: 12,
    fontWeight: 700,
  };
};

export default function VehicleDocuments() {
  const { api, user } = useAuth();
  const role = user?.role || "";
  const isRto = role === "rto";
  const isPolice = role === "police";

  const [vehicles, setVehicles] = useState<VehicleOption[]>([]);
  const [vehicleId, setVehicleId] = useState("");
  const [documents, setDocuments] = useState<VehicleDocument[]>([]);
  const [regNumber, setRegNumber] = useState("");
  const [loadingList, setLoadingList] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewDocId, setPreviewDocId] = useState("");
  const [busy, setBusy] = useState("");
  // Removal is confirmed inside the row. window.confirm() blocks the entire
  // console and cannot be styled, so it has no place in a recordable demo.
  const [pendingRemovalId, setPendingRemovalId] = useState("");

  const [file, setFile] = useState<File | null>(null);
  const [documentType, setDocumentType] = useState("insurance");
  const [expiryDate, setExpiryDate] = useState("");

  // Owners list their own vehicles; officers search the register. A dealer has
  // neither ownable vehicles nor read access to the register, so no request is
  // made at all instead of one the server would refuse with a 403.
  const canLoadVehicles =
    role === "owner" || role === "rto" || role === "police" || role === "admin";
  const loadVehicles = useCallback(async () => {
    if (!canLoadVehicles) {
      setVehicles([]);
      return;
    }
    try {
      if (role === "owner") {
        const res = await api.get("/vehicles/my");
        setVehicles(Array.isArray(res.data) ? res.data : []);
      } else {
        const res = await api.get("/vehicles/search?limit=100");
        setVehicles(res.data?.vehicles || []);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load vehicles");
    }
  }, [api, role, canLoadVehicles]);

  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

  const loadDocuments = useCallback(async () => {
    if (!vehicleId) {
      setDocuments([]);
      return;
    }
    setLoadingList(true);
    setMessage("");
    try {
      const res = await api.get(`/documents-mgmt/vehicle/${vehicleId}`);
      setDocuments(res.data?.documents || []);
      setRegNumber(res.data?.regNumber || "");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Could not load documents");
      setDocuments([]);
    } finally {
      setLoadingList(false);
    }
  }, [api, vehicleId]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const selectedVehicle = vehicles.find((v) => v._id === vehicleId);

  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || !vehicleId) {
      setError("Select a vehicle and a document file first.");
      return;
    }
    setError("");
    setMessage("");
    setBusy("upload");
    try {
      // Step 1: store the content and get back the reference it is addressed by.
      const fd = new FormData();
      fd.append("document", file);
      fd.append("documentType", documentType);
      const stored = await api.post(
        `/upload/vehicle-document/${vehicleId}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );

      // Step 2: register the metadata row so verification, signature and expiry
      // reminders can act on it.
      await api.post(`/documents-mgmt/upload/${vehicleId}`, {
        type: documentType,
        name: file.name,
        ipfsHash: stored.data?.ipfsHash,
        fileUrl: stored.data?.ipfsUrl,
        mimeType: file.type,
        fileSize: file.size,
        expiryDate: expiryDate || undefined,
      });

      setMessage(
        stored.data?.storage === "local-verified-vault"
          ? "Document stored under its SHA-256 in this server's verified store and registered against the vehicle."
          : "Document stored on IPFS and registered against the vehicle record.",
      );
      setFile(null);
      setExpiryDate("");
      await loadDocuments();
    } catch (err: unknown) {
      // The API explains the real reason it could not keep the file; showing it
      // as-is means nothing is recorded without the user knowing why.
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusy("");
    }
  };

  const handleVerify = async (
    status: "verified" | "rejected",
    remarks: string,
  ) => {
    if (!previewDocId) return;
    setBusy("verify");
    try {
      await api.put(`/documents-mgmt/verify/${vehicleId}/${previewDocId}`, {
        status,
        remarks,
      });
      setMessage(`Document ${status}.`);
      setPreviewDocId("");
      await loadDocuments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setBusy("");
    }
  };

  const handleSign = async () => {
    if (!previewDocId) return;
    setBusy("sign");
    try {
      await api.post(`/documents-mgmt/sign/${vehicleId}/${previewDocId}`, {});
      setMessage(
        "Verification seal applied - a SHA-256 over this officer, the vehicle and the document's content reference.",
      );
      setPreviewDocId("");
      await loadDocuments();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Signing failed.");
    } finally {
      setBusy("");
    }
  };

  const handleDelete = async (documentId: string) => {
    setBusy(documentId);
    try {
      await api.delete(`/documents-mgmt/${vehicleId}/${documentId}`);
      setMessage("Document removed.");
      setPendingRemovalId("");
      await loadDocuments();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Could not remove document.",
      );
    } finally {
      setBusy("");
    }
  };

  if (role === "dealer") {
    return null;
  }

  return (
    <div className="card">
      <h3>Vehicle Documents</h3>
      <p style={{ color: "var(--color-text-secondary)", marginTop: 0 }}>
        Every file is kept under its own SHA-256 hash and recorded against the
        vehicle - on IPFS when a gateway is configured, otherwise in this
        server's verified store, which the preview labels honestly. An RTO
        officer verifies each record and applies a SHA-256 verification seal
        binding the officer, the vehicle and the stored document together.
      </p>

      {!canLoadVehicles ? (
        <p style={{ fontSize: 14 }}>
          This panel lists documents attached to a vehicle. A dealer account
          does not hold vehicles, so there is nothing to show here - the
          invoices a dealer raises appear below.
        </p>
      ) : (
      <div className="form-group">
        <label htmlFor="vd-vehicle">Vehicle</label>
        <select
          id="vd-vehicle"
          value={vehicleId}
          onChange={(e) => setVehicleId(e.target.value)}
        >
          <option value="">
            {vehicles.length === 0
              ? "-- No vehicles available --"
              : "-- Select Vehicle --"}
          </option>
          {vehicles.map((v) => (
            <option key={v._id} value={v._id}>
              {v.regNumber || v._id}
              {v.make ? ` - ${v.make} ${v.model || ""}` : ""}
            </option>
          ))}
        </select>
      </div>
      )}

      {vehicleId && regNumber && (
        <p style={{ fontSize: 13, color: "var(--color-text-secondary)" }}>
          {selectedVehicle?.make
            ? `${selectedVehicle.regNumber} - ${selectedVehicle.make} ${selectedVehicle.model || ""}`
            : `Register number ${regNumber}`}
        </p>
      )}

      {error && (
        <div
          role="alert"
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--color-danger)",
            color: "var(--color-danger)",
            background: "var(--color-bg-secondary)",
            marginBottom: 12,
          }}
        >
          {error}
        </div>
      )}
      {message && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            border: "1px solid var(--color-success)",
            color: "var(--color-success)",
            background: "var(--color-bg-secondary)",
            marginBottom: 12,
          }}
        >
          {message}
        </div>
      )}

      {!isPolice && (
        <form
          onSubmit={handleUpload}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
            gap: 12,
            alignItems: "end",
            padding: 14,
            border: "1px solid var(--color-border)",
            borderRadius: 10,
            marginBottom: 18,
          }}
        >
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="vd-file">Document file</label>
            <input
              id="vd-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="vd-type">Document type</label>
            <select
              id="vd-type"
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value)}
            >
              {DOCUMENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label htmlFor="vd-expiry">Expiry date (if applicable)</label>
            <input
              id="vd-expiry"
              type="date"
              value={expiryDate}
              onChange={(e) => setExpiryDate(e.target.value)}
            />
          </div>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={busy === "upload" || !file || !vehicleId}
          >
            {busy === "upload" ? "Storing..." : "Upload Document"}
          </button>
        </form>
      )}

      {loadingList ? (
        <p>Loading documents...</p>
      ) : documents.length === 0 ? (
        <p style={{ color: "var(--color-text-secondary)" }}>
          {vehicleId
            ? "No documents recorded for this vehicle yet."
            : "Select a vehicle to see its recorded documents."}
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>Document</th>
                <th>Type</th>
                <th>Status</th>
                <th>Verification Seal</th>
                <th>Expiry</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc._id}>
                  <td>{doc.name}</td>
                  <td>{typeLabel(doc.type)}</td>
                  <td>
                    <span style={statusStyle(doc.verificationStatus)}>
                      {enumLabel(doc.verificationStatus)}
                    </span>
                  </td>
                  <td>
                    {doc.digitalSignature?.signature
                      ? "Sealed"
                      : "Not sealed"}
                  </td>
                  <td>
                    {doc.expiryDate
                      ? `${formatDate(doc.expiryDate)}${
                          doc.expiryStatus === "expired"
                            ? " (expired)"
                            : doc.expiryStatus === "expiring-soon"
                              ? ` in ${doc.daysUntilExpiry} day(s)`
                              : ""
                        }`
                      : "Not applicable"}
                  </td>
                  <td>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setPreviewDocId(doc._id)}
                    >
                      View
                    </button>
                    {(role === "owner" || isRto) && (
                      <span style={{ marginLeft: 8 }}>
                        <button
                          className="btn btn-danger"
                          disabled={busy === doc._id}
                          onClick={() =>
                            pendingRemovalId === doc._id
                              ? handleDelete(doc._id)
                              : setPendingRemovalId(doc._id)
                          }
                        >
                          {pendingRemovalId === doc._id
                            ? "Confirm Remove"
                            : "Remove"}
                        </button>
                        {pendingRemovalId === doc._id && (
                          <button
                            className="btn btn-secondary"
                            style={{ marginLeft: 6 }}
                            onClick={() => setPendingRemovalId("")}
                          >
                            Keep
                          </button>
                        )}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {previewDocId && (
        <DocumentPreview
          vehicleId={vehicleId}
          documentId={previewDocId}
          userRole={role}
          onClose={() => setPreviewDocId("")}
          onVerify={isRto ? handleVerify : undefined}
          onSign={isRto && busy !== "sign" ? handleSign : undefined}
        />
      )}
    </div>
  );
}
