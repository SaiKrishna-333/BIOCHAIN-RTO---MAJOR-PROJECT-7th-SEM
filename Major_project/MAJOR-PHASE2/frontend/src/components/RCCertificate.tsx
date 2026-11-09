import { useRef } from "react";
import { useReactToPrint } from "react-to-print";
import { QRCodeSVG } from "qrcode.react";
import { formatDate, enumLabel, maskAadhaar } from "../lib/display";

// A certificate may only print what the registry actually holds. Fields the
// database has no value for are shown as "Not recorded"; nothing here falls
// back to a plausible-looking sample.
interface RCCertificateProps {
  vehicle: {
    regNumber: string;
    chassisNumber?: string;
    engineNumber?: string;
    make: string;
    model: string;
    year?: number | string;
    status?: string;
  };
  owner: {
    name: string;
    address?: string;
    aadhaarNumber?: string;
  };
  registrationDate?: string;
  validUpto?: string;
  rtoOffice?: string;
  issuedByOfficer?: string;
  blockchainTxHash?: string;
  insuranceValidUpto?: string;
  pucValidUpto?: string;
  ipfsHash?: string;
  biometricHash?: string;
  transferType?: "new" | "second-hand" | "inheritance";
}

export default function RCCertificate({
  vehicle,
  owner,
  registrationDate,
  validUpto,
  rtoOffice,
  issuedByOfficer,
  blockchainTxHash,
  insuranceValidUpto,
  pucValidUpto,
  ipfsHash,
  biometricHash,
  transferType = "new",
}: RCCertificateProps) {
  const printRef = useRef<HTMLDivElement>(null);

  // One test decides every chain claim on this page: is there a real
  // transaction hash against this record?
  const hasChainRecord = Boolean(
    blockchainTxHash && blockchainTxHash !== "0x0",
  );

  const handlePrint = useReactToPrint({
    contentRef: printRef,
    documentTitle: `RC_${vehicle.regNumber || "UNREGISTERED"}`,
  });

  // The QR carries the record summary the certificate itself prints, so a scan
  // shows exactly what this page shows - no more, no less.
  const qrData = JSON.stringify({
    regNumber: vehicle.regNumber,
    chassisNumber: vehicle.chassisNumber || null,
    engineNumber: vehicle.engineNumber || null,
    make: vehicle.make,
    model: vehicle.model,
    year: vehicle.year ?? null,
    owner: owner.name,
    registrationDate: registrationDate || null,
    validUpto: validUpto || null,
    rtoOffice: rtoOffice || null,
    issuedByOfficer: issuedByOfficer || null,
    blockchainTxHash: hasChainRecord ? blockchainTxHash : null,
    recordStatus: hasChainRecord
      ? "COMMITTED_ON_CHAIN"
      : "AWAITING_CHAIN_COMMIT",
    status: vehicle.status || null,
  });

  const getTransferTypeLabel = () => {
    switch (transferType) {
      case "new":
        return "First Ownership - Vehicle Purchase";
      case "second-hand":
        return "Second Hand Sale - Ownership Transfer";
      case "inheritance":
        return "Inheritance Transfer - Legal Heir";
      default:
        return "First Ownership - Vehicle Purchase";
    }
  };

  const getTransferTypeBadge = () => {
    switch (transferType) {
      case "new":
        return { text: "New Registration", class: "rc-badge-new" };
      case "second-hand":
        return { text: "Second-Hand Sale", class: "rc-badge-resale" };
      case "inheritance":
        return { text: "Inheritance", class: "rc-badge-inheritance" };
      default:
        return { text: "New Registration", class: "rc-badge-new" };
    }
  };

  const badge = getTransferTypeBadge();

  return (
    <div className="rc-certificate-wrapper">
      {/* Action Buttons */}
      <div className="rc-actions">
        <button className="btn btn-primary" onClick={handlePrint}>
          Download / Print RC
        </button>
        {hasChainRecord && (
          <button
            className="btn btn-info"
            onClick={() => {
              const url = `https://amoy.polygonscan.com/tx/${blockchainTxHash}`;
              window.open(url, "_blank", "noopener,noreferrer");
            }}
          >
            View on Explorer
          </button>
        )}
      </div>

      {/* RC Certificate - Sovereign Dark Theme */}
      <div ref={printRef} className="rc-certificate">
        {/* Government Header */}
        <div className="rc-header">
          <div className="rc-header-left">
            <div className="rc-emblem">IN</div>
            <div className="rc-header-text">
              <div className="rc-gov-label">GOVERNMENT OF INDIA</div>
              <div className="rc-ministry">
                Ministry of Road Transport & Highways
              </div>
            </div>
          </div>
          <div className="rc-header-right">
            <span className={badge.class}>{badge.text}</span>
          </div>
        </div>

        {/* Certificate Title Section */}
        <div className="rc-title-section">
          <div className="rc-title-left">
            <div className="rc-title-text">
              <div className="rc-authority">
                {/* The chain wording follows the record: a committed record says
                    so, one still waiting for its fee says that instead. */}
                {hasChainRecord
                  ? "BIOCHAIN RTO AUTHORITY · COMMITTED ON POLYGON AMOY"
                  : "BIOCHAIN RTO AUTHORITY · CHAIN COMMIT PENDING"}
              </div>
              <h2 className="rc-title">Registration Certificate</h2>
              <div className="rc-subtitle">{getTransferTypeLabel()}</div>
            </div>
          </div>
          <div className="rc-title-right">
            <span
              className={
                vehicle.status === "active" || vehicle.status === "registered"
                  ? "rc-status-active"
                  : "rc-status-inactive"
              }
            >
              {enumLabel(vehicle.status)}
            </span>
            <div className="rc-validity">
              {validUpto
                ? `Valid upto ${formatDate(validUpto)}`
                : "Validity not recorded"}
            </div>
          </div>
        </div>

        {/* Registration Number */}
        <div className="rc-reg-section">
          <span className="rc-reg-label">REG#</span>
          <span className="rc-reg-number">{vehicle.regNumber}</span>
        </div>

        {/* Vehicle & Owner Details Grid */}
        <div className="rc-details-grid">
          <div className="rc-detail-item">
            <label>OWNER NAME</label>
            <span className="rc-detail-value">{owner.name}</span>
          </div>
          <div className="rc-detail-item">
            <label>AADHAAR (MASKED)</label>
            <span className="rc-detail-value rc-mono">
              {owner.aadhaarNumber
                ? maskAadhaar(owner.aadhaarNumber)
                : "Not recorded"}
            </span>
          </div>
          <div className="rc-detail-item">
            <label>ISSUE DATE</label>
            <span className="rc-detail-value">
              {formatDate(registrationDate, "Not recorded")}
            </span>
          </div>

          <div className="rc-detail-item">
            <label>MAKE / MODEL</label>
            <span className="rc-detail-value">
              {vehicle.make} {vehicle.model}
            </span>
          </div>
          <div className="rc-detail-item">
            <label>YEAR OF MANUFACTURE</label>
            <span className="rc-detail-value">
              {vehicle.year ?? "Not recorded"}
            </span>
          </div>
          <div className="rc-detail-item">
            <label>ENGINE / MOTOR NO.</label>
            <span className="rc-detail-value rc-mono">
              {vehicle.engineNumber || "Not recorded"}
            </span>
          </div>

          <div className="rc-detail-item">
            <label>CHASSIS NUMBER</label>
            <span className="rc-detail-value rc-mono">
              {vehicle.chassisNumber || "Not recorded"}
            </span>
          </div>
          <div className="rc-detail-item">
            <label>INSURANCE UPTO</label>
            <span className="rc-detail-value">
              {formatDate(insuranceValidUpto, "Not recorded")}
            </span>
          </div>
          <div className="rc-detail-item">
            <label>PUC UPTO</label>
            <span className="rc-detail-value">
              {formatDate(pucValidUpto, "Not recorded")}
            </span>
          </div>
          <div className="rc-detail-item">
            <label>RTO OFFICE</label>
            <span className="rc-detail-value">
              {rtoOffice || "Not recorded"}
            </span>
          </div>
        </div>

        {/* Blockchain Record Section */}
        <div className="rc-blockchain-section">
          <h4 className="rc-blockchain-title">BLOCKCHAIN RECORD</h4>
          <div className="rc-blockchain-grid">
            {blockchainTxHash && blockchainTxHash !== "0x0" && (
              <div className="rc-blockchain-item">
                <label>TRANSACTION HASH</label>
                <span className="rc-hash">
                  <span className="rc-dot rc-dot-cyan"></span>
                  {blockchainTxHash}
                </span>
              </div>
            )}
            {ipfsHash && (
              <div className="rc-blockchain-item">
                {/* A sha256: reference is this server's verified store, not an IPFS
                    CID - the certificate must not claim otherwise. */}
                <label>
                  {ipfsHash.startsWith("sha256:")
                    ? "DOCUMENT CONTENT HASH (SHA-256)"
                    : "IPFS DOCUMENT HASH (RC + INVOICE)"}
                </label>
                <span className="rc-hash rc-hash-green">
                  <span className="rc-dot rc-dot-green"></span>
                  {ipfsHash.replace("sha256:", "")}
                </span>
              </div>
            )}
            {biometricHash && (
              <div className="rc-blockchain-item">
                <label>BIOMETRIC AUTH HASH (OWNER)</label>
                <span className="rc-hash rc-hash-purple">
                  <span className="rc-dot rc-dot-purple"></span>
                  {biometricHash}
                </span>
              </div>
            )}
            {!blockchainTxHash && (
              <div className="rc-blockchain-item">
                <label>TRANSACTION HASH</label>
                <span className="rc-hash" style={{ color: "#b45309" }}>
                  <span
                    className="rc-dot rc-dot-cyan"
                    style={{ background: "#b45309" }}
                  ></span>
                  Awaiting on-chain commitment - the record is hashed and
                  stored; the transaction is broadcast when the anchoring wallet
                  can pay the fee
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Footer Section */}
        <div className="rc-footer">
          <div className="rc-footer-left">
            <div className="rc-qr-placeholder">
              <QRCodeSVG value={qrData} size={80} level="H" />
            </div>
            <div className="rc-qr-label">
              Record summary of this certificate
            </div>
          </div>
          <div className="rc-footer-center">
            <div className="rc-authenticated-text">
              Issued by the registered officer
            </div>
            {issuedByOfficer ? (
              <>
                <div className="rc-officer-name">
                  {issuedByOfficer.split(" (")[0]}
                </div>
                <div className="rc-officer-details">
                  {rtoOffice || "Office not recorded"}
                </div>
              </>
            ) : (
              <div className="rc-officer-details">
                Not recorded for this registration
              </div>
            )}
          </div>
          <div className="rc-footer-right">
            <div className="rc-seal">
              <div className="rc-seal-text">RTO</div>
              <div className="rc-seal-subtext">
                {hasChainRecord ? "COMMITTED ON CHAIN" : "REGISTRY RECORD"}
              </div>
            </div>
            <div className="rc-chain">
              {hasChainRecord ? "POLYGON AMOY" : "CHAIN COMMIT PENDING"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
