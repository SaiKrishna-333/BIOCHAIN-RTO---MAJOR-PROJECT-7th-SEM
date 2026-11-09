import { useRef } from "react";
import { QRCodeSVG } from "qrcode.react";
import { formatDate, maskAadhaar } from "../lib/display";

interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: string;

  // Dealer Details
  dealerName: string;
  dealerBusinessName: string;
  dealerGSTIN: string;
  dealerTIN: string;
  dealerLicense: string;
  dealerAddress: string;
  dealerPhone: string;
  dealerEmail: string;

  // Buyer Details
  buyerName: string;
  buyerEmail: string;
  buyerAadhaar: string;
  buyerDL: string;
  buyerAddress: string;

  // Vehicle Details
  chassisNumber: string;
  engineNumber: string;
  make: string;
  model: string;
  year: number;
  color?: string;

  // Pricing
  exShowroomPrice: number;
  roadTax: number;
  registrationFee: number;
  insuranceAmount: number;
  handlingCharges: number;
  otherCharges: number;
  gstAmount: number;
  grandTotal: number;

  // Payment
  paymentMode: string;
  paymentStatus: string;

  // Verification
  verificationStatus: "pending" | "verified" | "rejected";
  verifiedBy?: string;
  verifiedAt?: string;
  verificationRemarks?: string;
  signatureHash?: string;

  // Blockchain
  blockchainTxHash?: string;
}

interface InvoiceTemplateProps {
  data: InvoiceData;
  showActions?: boolean;
  onVerify?: () => void;
  onReject?: () => void;
  userRole?: string;
}

export default function InvoiceTemplateModern({
  data,
  showActions = false,
  onVerify,
  onReject,
  userRole,
}: InvoiceTemplateProps) {
  const printRef = useRef<HTMLDivElement>(null);

  const handlePrint = () => {
    const printContent = printRef.current;
    if (!printContent) return;

    const printWindow = window.open("", "", "width=800,height=1000");
    if (!printWindow) return;

    printWindow.document.write(`
      <html>
        <head>
          <title>Invoice ${data.invoiceNumber}</title>
          <link href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Noto+Serif:wght@700&display=swap" rel="stylesheet">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: 'Atkinson Hyperlegible', Arial, sans-serif; padding: 20px; background: #fff; color: #333; }
            h1, h2, h3 { font-family: 'Noto Serif', Georgia, serif; }
            .invoice-container-modern { max-width: 800px; margin: 0 auto; }
            .modern-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
            .header-left h1 { font-size: 36px; color: #000; margin-bottom: 15px; }
            .dealer-info-header p { font-size: 13px; color: #666; margin: 3px 0; }
            .logo-section-modern { display: flex; align-items: center; gap: 10px; margin-bottom: 15px; }
            .logo-icon { font-size: 40px; }
            .brand-name { font-size: 24px; color: #0066cc; }
            .invoice-meta { text-align: right; }
            .meta-row { display: flex; justify-content: flex-end; gap: 15px; margin: 5px 0; }
            .meta-row .label { font-weight: bold; color: #666; min-width: 120px; }
            .meta-row .value { color: #333; }
            .blue-divider { height: 8px; background: #1e5aa8; margin: 20px 0; }
            .customer-section-modern { margin: 25px 0; }
            .customer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 30px; }
            .info-group { display: flex; flex-direction: column; gap: 8px; }
            .info-row { display: flex; gap: 10px; }
            .info-row .label-bold { font-weight: bold; min-width: 100px; color: #333; }
            .info-row .value { color: #666; }
            .section-title { font-size: 16px; color: #333; margin: 20px 0 10px 0; }
            .modern-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            .modern-table th { background: #1e5aa8; color: #fff; padding: 12px; text-align: left; font-size: 13px; }
            .modern-table td { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
            .modern-pricing-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
            .modern-pricing-table th { background: #1e5aa8; color: #fff; padding: 12px; text-align: left; }
            .modern-pricing-table td { padding: 10px 12px; border-bottom: 1px solid #eee; }
            .total-row { background: #f0f8ff; font-weight: bold; font-size: 16px; }
            .payment-section-modern { margin: 25px 0; }
            .section-subtitle { font-size: 14px; color: #333; margin-bottom: 15px; }
            .payment-options { display: flex; gap: 30px; flex-wrap: wrap; }
            .payment-option { display: flex; align-items: center; gap: 8px; }
            .payment-option input[type="checkbox"] { width: 16px; height: 16px; }
            .modern-footer { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; border-top: 2px solid #eee; }
            .footer-title { font-size: 14px; color: #333; margin-bottom: 10px; }
            .payment-info-detail p { font-size: 12px; color: #666; margin: 5px 0; }
            .signature-area { text-align: right; }
            .date-label { font-size: 12px; color: #666; margin-bottom: 15px; }
            .signature-line { width: 200px; height: 60px; border: 1px dashed #ccc; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; }
            .signer-name { font-weight: bold; color: #333; margin-top: 10px; }
            .signer-role { font-size: 12px; color: #666; }
            .blockchain-footer { margin-top: 20px; padding: 15px; background: #f0f8ff; border-radius: 8px; display: flex; justify-content: space-between; align-items: center; }
            .blockchain-footer p { font-size: 12px; color: #666; margin: 0; }
            .blockchain-footer a { color: #0066cc; text-decoration: none; }
            .verification-status-modern { margin-top: 20px; text-align: center; }
            .verified-badge { background: #D4EDDA; color: #155724; padding: 15px 30px; border-radius: 8px; display: inline-block; }
            .rejected-badge { background: #F8D7DA; color: #721C24; padding: 15px 30px; border-radius: 8px; display: inline-block; }
            @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
          </style>
        </head>
        <body>
          ${printContent.innerHTML}
        </body>
      </html>
    `);
    printWindow.document.close();
    printWindow.print();
  };

  return (
    <div className="invoice-wrapper">
      {/* Action Buttons */}
      {showActions && (
        <div className="invoice-actions-bar">
          <div className="status-section">
            <span
              className={`verification-badge ${
                data.verificationStatus === "verified"
                  ? "verified"
                  : data.verificationStatus === "rejected"
                    ? "rejected"
                    : "pending"
              }`}
            >
              {data.verificationStatus === "pending" && "Pending"}
              {data.verificationStatus === "verified" && "Verified"}
              {data.verificationStatus === "rejected" && "Rejected"}
            </span>
          </div>
          <div className="button-section">
            <button className="btn btn-primary" onClick={handlePrint}>
              Print Invoice
            </button>
            {userRole === "rto" && data.verificationStatus === "pending" && (
              <>
                <button className="btn btn-success" onClick={onVerify}>
                  Verify Invoice
                </button>
                <button className="btn btn-danger" onClick={onReject}>
                  Reject
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* Invoice Document */}
      <div className="invoice-document-modern" ref={printRef}>
        <div className="invoice-container-modern">
          {/* Header Section */}
          <div className="modern-header">
            <div className="header-left">
              <h1 className="invoice-title-large">INVOICE</h1>
              <div className="dealer-info-header">
                <p className="dealer-name">
                  {data.dealerBusinessName || data.dealerName}
                </p>
                <p className="dealer-address">{data.dealerAddress}</p>
                <p className="dealer-contact">
                  {data.dealerPhone} | {data.dealerEmail}
                </p>
                <p className="dealer-gst">GSTIN: {data.dealerGSTIN || "N/A"}</p>
              </div>
            </div>
            <div className="header-right">
              <div className="logo-section-modern">
                <div
                  className="logo-icon"
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: "50%",
                    background: "#1e5aa8",
                    color: "#fff",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "bold",
                  }}
                >
                  IN
                </div>
                <h2 className="brand-name">Cars</h2>
              </div>
              <div className="invoice-meta">
                <div className="meta-row">
                  <span className="label">Invoice Number</span>
                  <span className="value">{data.invoiceNumber}</span>
                </div>
                <div className="meta-row">
                  <span className="label">Invoice Date</span>
                  <span className="value">{formatDate(data.invoiceDate)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Blue Divider */}
          <div className="blue-divider"></div>

          {/* Customer Details */}
          <div className="customer-section-modern">
            <div className="customer-grid">
              <div className="info-group">
                <div className="info-row">
                  <span className="label-bold">Name</span>
                  <span className="value">{data.buyerName}</span>
                </div>
                <div className="info-row">
                  <span className="label-bold">Address</span>
                  <span className="value">
                    {data.buyerAddress || "Address not provided"}
                  </span>
                </div>
              </div>
              <div className="info-group">
                <div className="info-row">
                  <span className="label-bold">Driving Licence</span>
                  <span className="value">
                    {data.buyerDL || "Not recorded"}
                  </span>
                </div>
                <div className="info-row">
                  <span className="label-bold">Aadhaar (masked)</span>
                  <span className="value">
                    {data.buyerAadhaar
                      ? maskAadhaar(data.buyerAadhaar)
                      : "Not recorded"}
                  </span>
                </div>
                <div className="info-row">
                  <span className="label-bold">Email</span>
                  <span className="value">{data.buyerEmail}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Vehicle Details Table */}
          <div className="vehicle-section-modern">
            <h3 className="section-title">Vehicle Details:</h3>
            <table className="modern-table">
              <thead>
                <tr>
                  <th>Vehicle Description</th>
                  <th>Details</th>
                  <th>Specification</th>
                  <th>Value</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <strong>
                      {data.make} {data.model}
                    </strong>
                  </td>
                  <td>Year: {data.year}</td>
                  <td>Color: {data.color || "Standard"}</td>
                  <td>₹ {data.exShowroomPrice.toLocaleString("en-IN")}</td>
                </tr>
                <tr>
                  <td>Chassis Number</td>
                  <td colSpan={3}>{data.chassisNumber}</td>
                </tr>
                <tr>
                  <td>Engine Number</td>
                  <td colSpan={3}>{data.engineNumber}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Pricing Breakdown */}
          <div className="pricing-section-modern">
            <table className="modern-pricing-table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Ex-Showroom Price</td>
                  <td style={{ textAlign: "right" }}>
                    ₹ {Number(data.exShowroomPrice).toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <td>Road Tax</td>
                  <td style={{ textAlign: "right" }}>
                    ₹ {Number(data.roadTax).toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <td>Registration Fee</td>
                  <td style={{ textAlign: "right" }}>
                    ₹ {Number(data.registrationFee).toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <td>Insurance (1 Year)</td>
                  <td style={{ textAlign: "right" }}>
                    ₹ {Number(data.insuranceAmount).toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <td>Handling Charges</td>
                  <td style={{ textAlign: "right" }}>
                    ₹ {Number(data.handlingCharges).toLocaleString("en-IN")}
                  </td>
                </tr>
                <tr>
                  <td>GST (28%)</td>
                  <td style={{ textAlign: "right" }}>
                    ₹ {Number(data.gstAmount).toLocaleString("en-IN")}
                  </td>
                </tr>
                {data.otherCharges > 0 && (
                  <tr>
                    <td>Other Charges</td>
                    <td style={{ textAlign: "right" }}>
                      ₹ {Number(data.otherCharges).toLocaleString("en-IN")}
                    </td>
                  </tr>
                )}
                <tr className="total-row">
                  <td>
                    <strong>Total</strong>
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <strong>
                      ₹ {Number(data.grandTotal).toLocaleString("en-IN")}
                    </strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Payment Method - the invoice records the mode the dealer declared and
              whether money was actually received, nothing else. */}
          <div className="payment-section-modern">
            <h4 className="section-subtitle">Payment:</h4>
            <div className="payment-options">
              <div className="payment-option">
                <input
                  type="checkbox"
                  checked={data.paymentMode === "Full Payment"}
                  readOnly
                />
                <label>Full Payment</label>
              </div>
              <div className="payment-option">
                <input
                  type="checkbox"
                  checked={data.paymentMode === "Loan"}
                  readOnly
                />
                <label>Loan / Financing</label>
              </div>
              <div className="payment-option">
                <input
                  type="checkbox"
                  checked={data.paymentMode === "Exchange"}
                  readOnly
                />
                <label>Exchange + Payment</label>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: "13px", color: "#555" }}>
                The mode above is as declared by the dealer.{" "}
                {data.paymentStatus === "Paid"
                  ? "Payment has been received and recorded against this invoice."
                  : "No payment has been recorded against this invoice yet."}
              </p>
            </div>
          </div>

          {/* Footer Section */}
          <div className="modern-footer">
            <div className="footer-left">
              <h4 className="footer-title">Payment Details:</h4>
              <div className="payment-info-detail">
                <p>
                  <strong>Payment Status:</strong>{" "}
                  {data.paymentStatus === "Paid" ? "Paid" : "Payment pending"}
                </p>
                <p>
                  <strong>Payment Mode:</strong> {data.paymentMode}
                </p>
                {data.signatureHash && (
                  <p>
                    {/* A sha256 of the printed figures is a content fingerprint, not a
                        signature issued by a certificate authority. */}
                    <strong>Invoice Content Hash (SHA-256):</strong>{" "}
                    {data.signatureHash.substring(0, 20)}...
                  </p>
                )}
                {data.blockchainTxHash && (
                  <p
                    style={{
                      marginTop: "10px",
                      paddingTop: "10px",
                      borderTop: "1px solid #eee",
                    }}
                  >
                    <strong>Blockchain TX:</strong>{" "}
                    <a
                      href={`https://amoy.polygonscan.com/tx/${data.blockchainTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#0066cc", textDecoration: "none" }}
                    >
                      View on PolygonScan
                    </a>
                  </p>
                )}
              </div>
            </div>

            <div className="footer-right">
              <div className="signature-area">
                <p className="date-label">
                  Date : {formatDate(data.invoiceDate)}
                </p>
                <div className="signature-line">
                  {data.verificationStatus === "verified" ? (
                    <div
                      className="verified-stamp"
                      style={{
                        color: "#0e7c3b",
                        fontSize: "24px",
                        fontWeight: "bold",
                      }}
                    >
                      VERIFIED
                    </div>
                  ) : (
                    <div
                      className="signature-placeholder"
                      style={{ color: "#999" }}
                    >
                      Not yet verified
                    </div>
                  )}
                </div>
                <p className="signer-name">{data.dealerName}</p>
                <p className="signer-role">Authorized Dealer</p>
              </div>
            </div>
          </div>

          {/* Blockchain Reference */}
          {data.blockchainTxHash && (
            <div className="blockchain-footer">
              <p>
                <strong>Blockchain Transaction:</strong>{" "}
                <a
                  href={`https://amoy.polygonscan.com/tx/${data.blockchainTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {data.blockchainTxHash.substring(0, 20)}...
                </a>
              </p>
              <div className="qr-code-blockchain">
                <QRCodeSVG
                  value={`https://amoy.polygonscan.com/tx/${data.blockchainTxHash}`}
                  size={60}
                />
              </div>
            </div>
          )}

          {/* Verification Status */}
          {data.verificationStatus !== "pending" && (
            <div className="verification-status-modern">
              {data.verificationStatus === "verified" ? (
                <div className="verified-badge">
                  <span style={{ fontWeight: "bold", fontSize: "16px" }}>
                    VERIFIED BY RTO
                  </span>
                  {data.verifiedBy ? (
                    <span style={{ display: "block", marginTop: "5px" }}>
                      By: {data.verifiedBy}
                    </span>
                  ) : (
                    <span style={{ display: "block", marginTop: "5px" }}>
                      Officer name not recorded
                    </span>
                  )}
                  {data.verifiedAt && (
                    <span
                      style={{
                        display: "block",
                        marginTop: "5px",
                        fontSize: "12px",
                      }}
                    >
                      {formatDate(data.verifiedAt)}
                    </span>
                  )}
                </div>
              ) : (
                <div className="rejected-badge">
                  <span style={{ fontWeight: "bold", fontSize: "16px" }}>
                    REJECTED
                  </span>
                  {data.verificationRemarks && (
                    <span
                      style={{
                        display: "block",
                        marginTop: "5px",
                        fontSize: "12px",
                      }}
                    >
                      Reason: {data.verificationRemarks}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
