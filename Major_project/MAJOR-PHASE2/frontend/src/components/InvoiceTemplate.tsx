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

export default function InvoiceTemplate({
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
            body { font-family: 'Atkinson Hyperlegible', Arial, sans-serif; padding: 20px; background: #fff; color: #000; }
            h1, h2, h3 { font-family: 'Noto Serif', Georgia, serif; }
            .invoice-container { max-width: 800px; margin: 0 auto; }
            .invoice-header { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #1e5aa8; padding-bottom: 20px; margin-bottom: 20px; }
            .logo-section h1 { color: #1e5aa8; font-size: 24px; margin-bottom: 5px; }
            .invoice-title { text-align: right; }
            .invoice-title h2 { color: #333; font-size: 28px; }
            .invoice-title .invoice-no { color: #666; margin-top: 5px; }
            .parties-section { display: flex; justify-content: space-between; margin-bottom: 30px; }
            .party-box { width: 48%; background: #f8f9fa; padding: 15px; border-radius: 8px; border-left: 4px solid #1e5aa8; }
            .party-box h3 { color: #1e5aa8; margin-bottom: 10px; font-size: 14px; text-transform: uppercase; }
            .party-box p { margin: 5px 0; font-size: 13px; color: #333; }
            .party-box .name { font-weight: bold; font-size: 15px; color: #000; }
            .vehicle-section { background: #f8f9fa; padding: 15px; border-radius: 8px; margin-bottom: 20px; }
            .vehicle-section h3 { color: #1e5aa8; margin-bottom: 15px; }
            .vehicle-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
            .vehicle-item { padding: 8px; background: #fff; border-radius: 4px; }
            .vehicle-item label { font-size: 11px; color: #666; text-transform: uppercase; }
            .vehicle-item .value { font-weight: bold; color: #000; }
            .pricing-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
            .pricing-table th { background: #1e5aa8; color: #fff; padding: 12px; text-align: left; }
            .pricing-table td { padding: 10px 12px; border-bottom: 1px solid #eee; }
            .pricing-table .total-row { background: #f8f9fa; font-weight: bold; }
            .pricing-table .grand-total { background: #1e5aa8; color: #fff; font-size: 18px; }
            .footer-section { display: flex; justify-content: space-between; margin-top: 40px; padding-top: 20px; border-top: 2px solid #eee; }
            .signature-box { text-align: center; width: 200px; }
            .signature-box .stamp { width: 100px; height: 100px; border: 2px dashed #ccc; margin: 0 auto 10px; display: flex; align-items: center; justify-content: center; color: #999; }
            .signature-box p { font-size: 12px; color: #666; }
            .terms-section { margin-top: 30px; padding: 15px; background: #f8f9fa; border-radius: 8px; }
            .terms-section h4 { margin-bottom: 10px; color: #333; }
            .terms-section ul { margin-left: 20px; font-size: 12px; color: #666; }
            .terms-section li { margin: 5px 0; }
            .qr-section { text-align: center; margin-top: 20px; }
            .verification-badge { display: inline-block; padding: 8px 20px; border-radius: 20px; font-weight: bold; text-transform: uppercase; font-size: 12px; }
            .badge-pending { background: #FFF3CD; color: #856404; }
            .badge-verified { background: #D4EDDA; color: #155724; }
            .badge-rejected { background: #F8D7DA; color: #721C24; }
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

  const getStatusBadge = () => {
    const statusColors = {
      pending: {
        bg: "#FFF3CD",
        color: "#856404",
        text: "Pending Verification",
      },
      verified: { bg: "#D4EDDA", color: "#155724", text: "Verified" },
      rejected: { bg: "#F8D7DA", color: "#721C24", text: "Rejected" },
    };
    const status = statusColors[data.verificationStatus];
    return (
      <span
        className="verification-badge"
        style={{ backgroundColor: status.bg, color: status.color }}
      >
        {status.text}
      </span>
    );
  };

  return (
    <div className="invoice-wrapper">
      {/* Action Buttons */}
      {showActions && (
        <div className="invoice-actions-bar">
          <div className="status-section">{getStatusBadge()}</div>
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
      <div className="invoice-document" ref={printRef}>
        <div className="invoice-container">
          {/* Header */}
          <div className="invoice-header">
            <div className="logo-section">
              <h1>{data.dealerBusinessName || data.dealerName}</h1>
              <p className="tagline">Authorized Automobile Dealer</p>
              <p className="dealer-lic">License No: {data.dealerLicense}</p>
            </div>
            <div className="invoice-title">
              <h2>TAX INVOICE</h2>
              <p className="invoice-no">
                Invoice No: <strong>{data.invoiceNumber}</strong>
              </p>
              <p className="invoice-date">
                Date: {formatDate(data.invoiceDate)}
              </p>
            </div>
          </div>

          {/* Parties Section */}
          <div className="parties-section">
            <div className="party-box seller">
              <h3>From (Seller)</h3>
              <p className="name">
                {data.dealerBusinessName || data.dealerName}
              </p>
              <p>{data.dealerAddress}</p>
              <p>Phone: {data.dealerPhone}</p>
              <p>Email: {data.dealerEmail}</p>
              <p>
                <strong>GSTIN:</strong> {data.dealerGSTIN || "N/A"}
              </p>
              <p>
                <strong>TIN:</strong> {data.dealerTIN || "N/A"}
              </p>
            </div>
            <div className="party-box buyer">
              <h3>To (Buyer)</h3>
              <p className="name">{data.buyerName}</p>
              <p>{data.buyerAddress || "Address not provided"}</p>
              <p>Email: {data.buyerEmail}</p>
              <p>
                <strong>Aadhaar:</strong>{" "}
                {data.buyerAadhaar
                  ? maskAadhaar(data.buyerAadhaar)
                  : "Not recorded"}
              </p>
              <p>
                <strong>DL No:</strong> {data.buyerDL || "Not recorded"}
              </p>
            </div>
          </div>

          {/* Vehicle Details */}
          <div className="vehicle-section">
            <h3>Vehicle Details</h3>
            <div className="vehicle-grid">
              <div className="vehicle-item">
                <label>Make</label>
                <div className="value">{data.make}</div>
              </div>
              <div className="vehicle-item">
                <label>Model</label>
                <div className="value">{data.model}</div>
              </div>
              <div className="vehicle-item">
                <label>Year</label>
                <div className="value">{data.year}</div>
              </div>
              <div className="vehicle-item">
                <label>Chassis No</label>
                <div className="value">{data.chassisNumber}</div>
              </div>
              <div className="vehicle-item">
                <label>Engine No</label>
                <div className="value">{data.engineNumber}</div>
              </div>
              <div className="vehicle-item">
                <label>Color</label>
                <div className="value">{data.color || "Standard"}</div>
              </div>
            </div>
          </div>

          {/* Pricing Table */}
          <table className="pricing-table">
            <thead>
              <tr>
                <th>Description</th>
                <th style={{ textAlign: "right" }}>Amount (₹)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Ex-Showroom Price</td>
                <td style={{ textAlign: "right" }}>
                  {data.exShowroomPrice.toLocaleString("en-IN")}
                </td>
              </tr>
              <tr>
                <td>Road Tax</td>
                <td style={{ textAlign: "right" }}>
                  {data.roadTax.toLocaleString("en-IN")}
                </td>
              </tr>
              <tr>
                <td>Registration Fee</td>
                <td style={{ textAlign: "right" }}>
                  {data.registrationFee.toLocaleString("en-IN")}
                </td>
              </tr>
              <tr>
                <td>Insurance (1 Year)</td>
                <td style={{ textAlign: "right" }}>
                  {data.insuranceAmount.toLocaleString("en-IN")}
                </td>
              </tr>
              <tr>
                <td>Handling Charges</td>
                <td style={{ textAlign: "right" }}>
                  {data.handlingCharges.toLocaleString("en-IN")}
                </td>
              </tr>
              <tr>
                <td>GST (28%)</td>
                <td style={{ textAlign: "right" }}>
                  {data.gstAmount.toLocaleString("en-IN")}
                </td>
              </tr>
              {data.otherCharges > 0 && (
                <tr>
                  <td>Other Charges</td>
                  <td style={{ textAlign: "right" }}>
                    {data.otherCharges.toLocaleString("en-IN")}
                  </td>
                </tr>
              )}
              <tr className="grand-total">
                <td>
                  <strong>GRAND TOTAL</strong>
                </td>
                <td style={{ textAlign: "right" }}>
                  <strong>₹ {data.grandTotal.toLocaleString("en-IN")}</strong>
                </td>
              </tr>
            </tbody>
          </table>

          {/* Payment Info */}
          <div className="payment-info">
            <p>
              <strong>Payment Mode:</strong> {data.paymentMode}
            </p>
            <p>
              <strong>Payment Status:</strong>{" "}
              {data.paymentStatus === "Paid" ? "Paid" : "Payment pending"}
            </p>
          </div>

          {/* Footer with Signatures */}
          <div className="footer-section">
            <div className="signature-box">
              <div className="stamp">
                {data.signatureHash ? (
                  <QRCodeSVG value={data.signatureHash} size={80} />
                ) : (
                  <span>No content hash</span>
                )}
              </div>
              <p>
                <strong>Dealer's Signature</strong>
              </p>
              <p style={{ fontSize: "10px" }}>
                QR holds the SHA-256 content hash of this invoice
              </p>
            </div>

            <div className="qr-section">
              {data.blockchainTxHash && (
                <>
                  <QRCodeSVG
                    value={`https://amoy.polygonscan.com/tx/${data.blockchainTxHash}`}
                    size={80}
                  />
                  <p style={{ fontSize: "10px", marginTop: "5px" }}>
                    Verify on Blockchain
                  </p>
                </>
              )}
            </div>

            <div className="signature-box">
              <div className="stamp">
                {data.verificationStatus === "verified" ? (
                  <span
                    style={{
                      color: "#0e7c3b",
                      fontSize: "20px",
                      fontWeight: 700,
                      letterSpacing: "1px",
                    }}
                  >
                    VERIFIED
                  </span>
                ) : (
                  <span>Not verified</span>
                )}
              </div>
              <p>
                <strong>RTO Verification</strong>
              </p>
              {data.verifiedAt && (
                <p style={{ fontSize: "10px" }}>
                  {formatDate(data.verifiedAt)}
                </p>
              )}
            </div>
          </div>

          {/* Terms & Conditions */}
          <div className="terms-section">
            <h4>Terms & Conditions</h4>
            <ul>
              <li>
                Vehicle registration is subject to RTO approval and
                verification.
              </li>
              <li>
                All prices are in Indian Rupees (INR) and inclusive of
                applicable taxes.
              </li>
              <li>
                Insurance details are as declared by the dealer; the policy
                document issued by the insurer sets the actual coverage.
              </li>
              <li>
                RC (Registration Certificate) will be issued after RTO
                verification.
              </li>
              <li>
                This invoice is computer-generated and does not require physical
                signature.
              </li>
            </ul>
          </div>

          {/* Blockchain Reference */}
          {data.blockchainTxHash && (
            <div className="blockchain-ref">
              <p>
                <strong>Blockchain Reference:</strong>{" "}
                <a
                  href={`https://amoy.polygonscan.com/tx/${data.blockchainTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {data.blockchainTxHash.substring(0, 20)}...
                </a>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
