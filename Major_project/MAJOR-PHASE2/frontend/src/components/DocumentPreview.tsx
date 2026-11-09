import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { formatDate } from "../lib/display";

interface DocumentPreviewProps {
  vehicleId: string;
  documentId: string;
  onClose: () => void;
  onVerify?: (status: "verified" | "rejected", remarks: string) => void;
  onSign?: () => void;
  userRole?: string;
}

interface DocumentData {
  documentId: string;
  name: string;
  type: string;
  mimeType: string;
  fileUrl?: string;
  ipfsHash?: string;
  // "local-verified-store" when the bytes sit on this server under their own
  // SHA-256, "ipfs" for a real CID, null when nothing was stored.
  storage?: "local-verified-store" | "ipfs" | null;
  contentAvailable?: boolean;
  verificationStatus: "pending" | "verified" | "rejected";
  hasSignature: boolean;
  uploadedAt: string;
}

export default function DocumentPreview({
  vehicleId,
  documentId,
  onClose,
  onVerify,
  onSign,
  userRole,
}: DocumentPreviewProps) {
  const { api } = useAuth();
  const [document, setDocument] = useState<DocumentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [contentUrl, setContentUrl] = useState("");
  const [contentError, setContentError] = useState("");
  const [verifyRemarks, setVerifyRemarks] = useState("");
  const [showVerifyForm, setShowVerifyForm] = useState(false);
  const [verifyAction, setVerifyAction] = useState<"verified" | "rejected">(
    "verified",
  );

  const fetchDocumentPreview = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(
        `/documents-mgmt/preview/${vehicleId}/${documentId}`,
      );
      setDocument(res.data);
      setError("");
    } catch (err) {
      // The dialog itself reports the failure, with the API's reason attached.
      setError(
        err instanceof Error ? err.message : "Failed to load document preview",
      );
    } finally {
      setLoading(false);
    }
  }, [api, vehicleId, documentId]);

  useEffect(() => {
    fetchDocumentPreview();
  }, [fetchDocumentPreview]);

  // The bytes come back through an authenticated call and become a blob URL:
  // a plain <img src> cannot carry the token, and a public IPFS gateway cannot
  // know this server's access rules.
  useEffect(() => {
    if (!document?.contentAvailable) return;
    let revoked = "";
    let cancelled = false;
    const loadContent = async () => {
      try {
        const res = await api.get(
          `/documents-mgmt/content/${vehicleId}/${documentId}`,
          { responseType: "blob" },
        );
        // Axios hands back JSON errors as a blob too - read the server's reason.
        if (res.data.type?.includes("application/json")) {
          const text = await res.data.text();
          throw new Error(JSON.parse(text)?.message || "Content unavailable");
        }
        if (cancelled) return;
        revoked = URL.createObjectURL(res.data as Blob);
        setContentUrl(revoked);
        setContentError("");
      } catch (err) {
        if (!cancelled) {
          setContentError(
            err instanceof Error
              ? err.message
              : "Could not load the stored file",
          );
        }
      }
    };
    loadContent();
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
      setContentUrl("");
    };
  }, [api, document?.contentAvailable, documentId, vehicleId]);

  // Formal document-type abbreviations (government register, no pictographs)
  const getDocumentIcon = (type: string) => {
    switch (type) {
      case "rc":
        return "RC";
      case "insurance":
        return "INS";
      case "puc":
        return "PUC";
      case "transfer":
        return "TRF";
      case "invoice":
        return "INV";
      default:
        return "DOC";
    }
  };

  const getVerificationBadge = (status: string) => {
    switch (status) {
      case "verified":
        return { text: "Verified", class: "verified" };
      case "rejected":
        return { text: "Rejected", class: "rejected" };
      default:
        return { text: "Pending", class: "pending" };
    }
  };

  const isImage = (mimeType?: string) => {
    return mimeType?.startsWith("image/");
  };

  const isPDF = (mimeType?: string) => {
    return mimeType === "application/pdf";
  };

  // What to show when the bytes are not on screen. Only a real IPFS CID gets an
  // external gateway link: a hash stored on this server has nothing to open
  // there, and sending a reviewer to a dead gateway would be a false claim.
  const storageFallback = (doc: DocumentData, kind: string) => (
    <div className="ipfs-placeholder">
      <p>{kind}</p>
      {contentError && <p className="ipfs-hash">{contentError}</p>}
      <p className="ipfs-hash">
        {doc.storage === "local-verified-store"
          ? `Verified local store - SHA-256 ${(doc.ipfsHash || "").replace("sha256:", "").substring(0, 20)}...`
          : `IPFS: ${(doc.ipfsHash || "").substring(0, 20)}...`}
      </p>
      {doc.storage === "ipfs" && doc.ipfsHash ? (
        <a
          href={`https://gateway.ipfs.io/ipfs/${doc.ipfsHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-primary"
        >
          View on IPFS
        </a>
      ) : null}
      {!contentError ? (
        <p>
          {doc.storage === "local-verified-store"
            ? "The file is served by this application and re-hashed on every open."
            : "Waiting for the stored copy to load."}
        </p>
      ) : null}
    </div>
  );

  const handleVerify = () => {
    if (onVerify) {
      onVerify(verifyAction, verifyRemarks);
      setShowVerifyForm(false);
      setVerifyRemarks("");
    }
  };

  if (loading) {
    return (
      <div className="document-preview-modal" onClick={onClose}>
        <div
          className="document-preview-content"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="document-preview-loading">
            <p>Loading document...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error || !document) {
    return (
      <div className="document-preview-modal" onClick={onClose}>
        <div
          className="document-preview-content"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="document-preview-error">
            <p>{error || "Document not found"}</p>
            <button className="btn btn-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  const badge = getVerificationBadge(document.verificationStatus);

  return (
    <div className="document-preview-modal" onClick={onClose}>
      <div
        className="document-preview-content"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="document-preview-header">
          <div className="document-preview-title">
            <span className="document-icon">
              {getDocumentIcon(document.type)}
            </span>
            <div>
              <h3>{document.name}</h3>
              <span className={`verification-badge ${badge.class}`}>
                {badge.text}
              </span>
              {document.hasSignature && (
                <span className="signature-badge">Digitally Signed</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="close-btn"
            aria-label="Close document preview"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Preview Area */}
        <div className="document-preview-body">
          {isImage(document.mimeType) ? (
            <div className="image-preview">
              {contentUrl ? (
                <img src={contentUrl} alt={document.name} />
              ) : document.ipfsHash || document.fileUrl ? (
                storageFallback(document, "Image Preview")
              ) : (
                <p>No preview available</p>
              )}
            </div>
          ) : isPDF(document.mimeType) ? (
            <div className="pdf-preview">
              {contentUrl ? (
                <iframe
                  src={contentUrl}
                  title={document.name}
                  width="100%"
                  height="500px"
                />
              ) : document.ipfsHash || document.fileUrl ? (
                storageFallback(document, "PDF Document")
              ) : (
                <p>No preview available</p>
              )}
            </div>
          ) : (
            <div className="generic-preview">
              <div className="document-icon-large">
                {getDocumentIcon(document.type)}
              </div>
              <p>{document.name}</p>
              <p className="mime-type">{document.mimeType || "Unknown type"}</p>
              {document.ipfsHash && (
                <p className="ipfs-hash">
                  {document.storage === "local-verified-store"
                    ? `Stored here under SHA-256 ${document.ipfsHash.replace("sha256:", "")}`
                    : `IPFS: ${document.ipfsHash}`}
                </p>
              )}
              {contentUrl && (
                <a
                  href={contentUrl}
                  download={document.name}
                  className="btn btn-primary"
                >
                  Open file
                </a>
              )}
            </div>
          )}
        </div>

        {/* Footer / Actions */}
        <div className="document-preview-footer">
          <div className="document-meta">
            <p>
              Uploaded: {formatDate(document.uploadedAt)}
            </p>
            <p>Type: {document.type.toUpperCase()}</p>
          </div>

          <div className="document-actions">
            {userRole === "rto" &&
              document.verificationStatus === "pending" && (
                <>
                  {!showVerifyForm ? (
                    <>
                      <button
                        className="btn btn-success"
                        onClick={() => {
                          setVerifyAction("verified");
                          setShowVerifyForm(true);
                        }}
                      >
                        Verify
                      </button>
                      <button
                        className="btn btn-danger"
                        onClick={() => {
                          setVerifyAction("rejected");
                          setShowVerifyForm(true);
                        }}
                      >
                        Reject
                      </button>
                      {!document.hasSignature && onSign && (
                        <button className="btn btn-primary" onClick={onSign}>
                          Sign Document
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="verify-form">
                      <textarea
                        placeholder="Add remarks (optional)..."
                        value={verifyRemarks}
                        onChange={(e) => setVerifyRemarks(e.target.value)}
                        rows={2}
                      />
                      <div className="verify-actions">
                        <button
                          className={`btn ${
                            verifyAction === "verified"
                              ? "btn-success"
                              : "btn-danger"
                          }`}
                          onClick={handleVerify}
                        >
                          Confirm{" "}
                          {verifyAction === "verified"
                            ? "Verification"
                            : "Rejection"}
                        </button>
                        <button
                          className="btn btn-secondary"
                          onClick={() => setShowVerifyForm(false)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}

            {(contentUrl || document.fileUrl) && (
              <a
                href={contentUrl || document.fileUrl}
                download={document.name}
                className="btn btn-primary"
              >
                Download
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
