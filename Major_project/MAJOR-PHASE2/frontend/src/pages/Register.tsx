import { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import BiometricCaptureModal from "../components/BiometricCaptureModal";
import OcrDocumentUpload, {
  type OcrFields,
} from "../components/OcrDocumentUpload";
import { STATES } from "../lib/states";
import { notify } from "../lib/notify";

export default function Register() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    password: "",
    role: "owner",
    phone: "",
    address: "",
    state: "",
    district: "",
    aadhaarNumber: "",
    dlNumber: "",
    badgeNumber: "", // For police
    workshopCompany: "", // Shop/agency name for workshop role
    workshopManufacturer: "", // Vehicle company the workshop belongs to
    profilePhoto: null as File | null,
  });
  const [error, setError] = useState("");
  const [step, setStep] = useState<"form" | "biometric">("form");
  const [showBiometric, setShowBiometric] = useState(false);
  const [registeredUserId, setRegisteredUserId] = useState("");
  // KYC provenance: set when an uploaded document was OCR-read into the form
  const [kyc, setKyc] = useState<{ docType: string; viaOcr: boolean } | null>(
    null,
  );
  const navigate = useNavigate();

  // Merge OCR-extracted fields into the form. Values typed by the user in
  // fields the OCR misread can simply be corrected below before submitting.
  const applyOcrFields = (fields: OcrFields, documentType: string) => {
    setKyc({ docType: documentType || "id-document", viaOcr: true });
    setFormData((prev) => ({
      ...prev,
      name: fields.name || prev.name,
      phone: fields.phone
        ? `+91 ${fields.phone}`.replace(/\+91 (\d{10})$/, "+91 $1")
        : prev.phone,
      address: fields.address
        ? fields.address +
          (fields.pincode && !fields.address.includes(fields.pincode)
            ? ` - PIN ${fields.pincode}`
            : "")
        : prev.address,
      state:
        fields.state &&
        [
          "AP",
          "TS",
          "KA",
          "TN",
          "MH",
          "DL",
          "GJ",
          "RJ",
          "UP",
          "MP",
          "KL",
        ].includes(fields.state)
          ? fields.state
          : prev.state,
      district: fields.district || prev.district,
      aadhaarNumber: fields.aadhaarNumber
        ? fields.aadhaarNumber.replace(/\D/g, "").slice(0, 12)
        : prev.aadhaarNumber,
      dlNumber: fields.dlNumber || prev.dlNumber,
    }));
  };

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const getEmailPlaceholder = () => {
    const role = formData.role;
    switch (role) {
      case "owner":
        return "username@owner.com";
      case "dealer":
        return "username@dealer.com";
      case "rto":
        return "username@rto.com";
      case "police":
        return "username@police.com";
      case "workshop":
        return "username@workshop.com";
      default:
        return "username@role.com";
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      // Create FormData object for file upload
      const formDataToSend = new FormData();
      formDataToSend.append("name", formData.name);
      formDataToSend.append("email", formData.email);
      formDataToSend.append("password", formData.password);
      formDataToSend.append("role", formData.role);
      formDataToSend.append("phone", formData.phone);
      formDataToSend.append("address", formData.address);
      formDataToSend.append("state", formData.state);
      formDataToSend.append("district", formData.district);
      formDataToSend.append("aadhaarNumber", formData.aadhaarNumber);
      formDataToSend.append("dlNumber", formData.dlNumber);
      if (formData.role === "police" && formData.badgeNumber) {
        formDataToSend.append("badgeNumber", formData.badgeNumber);
      }
      if (formData.role === "workshop") {
        formDataToSend.append(
          "workshopDetails",
          JSON.stringify({
            companyName: formData.workshopCompany,
            affiliatedManufacturer: formData.workshopManufacturer,
          }),
        );
      }
      if (formData.profilePhoto) {
        formDataToSend.append("profilePhoto", formData.profilePhoto);
      }
      // KYC provenance so the record shows the form was OCR-backed
      if (kyc?.viaOcr) {
        formDataToSend.append("kycDocType", kyc.docType);
        formDataToSend.append("kycViaOcr", "true");
      }

      const response = await axios.post(
        "http://localhost:5000/api/auth/register",
        formDataToSend,
        {
          headers: {
            "Content-Type": "multipart/form-data",
          },
        },
      );

      // Store the user ID and move to biometric step
      setRegisteredUserId(response.data.userId);
      setStep("biometric");
      setShowBiometric(true);
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Registration failed";
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || errorMessage,
      );
    }
  };

  const handleBiometricSuccess = async (biometricData: {
    templateId: string;
    timestamp: string;
    quality: number;
  }) => {
    try {
      // Update user with biometric template using public endpoint (no auth needed)
      await axios.put(
        `http://localhost:5000/api/auth/register/${registeredUserId}/biometric`,
        {
          templateId: biometricData.templateId,
          quality: biometricData.quality,
        },
      );

      notify(
        "Registration and biometric enrollment successful. Please login.",
        "success",
      );
      navigate("/login");
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : "Biometric enrollment failed";
      setError(
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message || errorMessage,
      );
    }
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh" }}>
      <header className="gov-header">
        <div style={{ display: "flex", alignItems: "center", gap: "15px" }}>
          <span className="rc-emblem">IN</span>
          <div className="gov-nav">
            <a href="/">Home</a>
            <a href="/login">Login</a>
          </div>
        </div>
      </header>

      <div
        className="container"
        style={{ maxWidth: "550px", marginTop: "40px" }}
      >
        <div className="card">
          <div
            className="orange-badge"
            style={{ display: "block", textAlign: "center", fontSize: "1rem" }}
          >
            Digital India Citizen Registration
          </div>
          <h2
            style={{
              textAlign: "center",
              margin: "20px 0",
              color: "var(--color-cyan-dark)",
              fontWeight: "800",
            }}
          >
            BIOCHAIN RTO
          </h2>

          {step === "form" && (
            <>
              <div
                style={{
                  background: "rgba(30, 90, 168, 0.05)",
                  padding: "15px",
                  borderRadius: "8px",
                  marginBottom: "20px",
                  border: "1px solid rgba(30, 90, 168, 0.2)",
                }}
              >
                <h5 style={{ margin: "0 0 10px 0", color: "#1e5aa8" }}>
                  Identity Verification Requirements:
                </h5>
                <p
                  style={{
                    margin: "5px 0",
                    fontSize: "0.85rem",
                    color: "#666",
                  }}
                >
                  Please use the official role-based email domain provided by
                  your department or for personal use.
                </p>
                <p
                  style={{
                    margin: "5px 0",
                    fontSize: "0.85rem",
                    color: "var(--color-danger)",
                    fontWeight: "bold",
                  }}
                >
                  All fields are mandatory. Profile details can be edited later
                  from dashboard.
                </p>
              </div>

              {error && <div className="alert alert-danger">{error}</div>}
              <OcrDocumentUpload onExtract={applyOcrFields} />
              {kyc?.viaOcr && (
                <div
                  className="alert alert-success"
                  style={{ fontSize: "0.85rem", padding: "10px 14px" }}
                >
                  Form auto-filled by OCR from your{" "}
                  {kyc.docType.replace("-", " ")} — please review every field;
                  you can still edit anything before submitting.
                </div>
              )}
              <form onSubmit={handleSubmit}>
                <div className="form-group">
                  <label>Full Name (as per Aadhaar)</label>
                  <input
                    type="text"
                    name="name"
                    value={formData.name}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Official Email</label>
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    placeholder={getEmailPlaceholder()}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Secure Password</label>
                  <input
                    type="password"
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>System Role</label>
                  <select
                    name="role"
                    value={formData.role}
                    onChange={handleChange}
                  >
                    <option value="owner">Owner/Buyer</option>
                    <option value="dealer">Dealer</option>
                    <option value="rto">RTO Officer</option>
                    <option value="police">Police</option>
                    <option value="workshop">Workshop / Service Centre</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Phone Number *</label>
                  <input
                    type="tel"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    placeholder="+91 9876543210"
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Address *</label>
                  <textarea
                    name="address"
                    value={formData.address}
                    onChange={handleChange}
                    rows={3}
                    placeholder="Enter your complete address"
                    required
                  />
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "15px",
                    marginBottom: "1rem",
                  }}
                >
                  <div className="form-group">
                    <label>State *</label>
                    <select
                      name="state"
                      value={formData.state}
                      onChange={handleChange}
                      required
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        border: "1px solid #ddd",
                        borderRadius: "6px",
                        fontSize: "1rem",
                      }}
                    >
                      <option value="">Select State</option>
                      {/* One shared list, identical to the states the backend
                          cross-office rules recognise - a hand-written copy here
                          could drift from the codes that actually route. */}
                      {STATES.map((s) => (
                        <option key={s.code} value={s.code}>
                          {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>District *</label>
                    <input
                      type="text"
                      name="district"
                      value={formData.district}
                      onChange={handleChange}
                      placeholder="e.g., Bangalore Urban"
                      required
                      style={{
                        width: "100%",
                        padding: "0.75rem",
                        border: "1px solid #ddd",
                        borderRadius: "6px",
                        fontSize: "1rem",
                      }}
                    />
                  </div>
                </div>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "15px",
                  }}
                >
                  <div className="form-group">
                    <label>Aadhaar Number *</label>
                    <input
                      type="text"
                      name="aadhaarNumber"
                      value={formData.aadhaarNumber}
                      onChange={handleChange}
                      placeholder="XXXX-XXXX-XXXX"
                      maxLength={12}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label>DL Number *</label>
                    <input
                      type="text"
                      name="dlNumber"
                      value={formData.dlNumber}
                      onChange={handleChange}
                      placeholder="Driving License Number"
                      required
                    />
                  </div>
                  {formData.role === "workshop" && (
                    <>
                      <div
                        className="form-group"
                        style={{ gridColumn: "span 2" }}
                      >
                        <label>Shop / Agency Name *</label>
                        <input
                          type="text"
                          name="workshopCompany"
                          value={formData.workshopCompany}
                          onChange={handleChange}
                          placeholder="e.g., Sai Automobiles"
                          required
                        />
                      </div>
                      <div
                        className="form-group"
                        style={{ gridColumn: "span 2" }}
                      >
                        <label>Vehicle Company (Manufacturer) *</label>
                        <input
                          type="text"
                          name="workshopManufacturer"
                          value={formData.workshopManufacturer}
                          onChange={handleChange}
                          placeholder="e.g., Maruti Suzuki - only matching vehicles will be visible to you"
                          required
                        />
                      </div>
                    </>
                  )}
                  {formData.role === "police" && (
                    <div
                      className="form-group"
                      style={{ gridColumn: "span 2" }}
                    >
                      <label>Badge Number (Police ID) *</label>
                      <input
                        type="text"
                        name="badgeNumber"
                        value={formData.badgeNumber}
                        onChange={handleChange}
                        placeholder="Enter your police badge/ID number"
                        required
                      />
                    </div>
                  )}
                </div>
                <div className="form-group" style={{ marginTop: "15px" }}>
                  <label>Profile Photo *</label>
                  <input
                    type="file"
                    name="profilePhoto"
                    accept="image/*"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        setFormData({ ...formData, profilePhoto: file });
                      }
                    }}
                    required
                  />
                  <small
                    style={{
                      color: "#666",
                      display: "block",
                      marginTop: "5px",
                    }}
                  >
                    Upload your recent passport-size photograph (JPG/PNG)
                  </small>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ width: "100%", padding: "14px", marginTop: "10px" }}
                >
                  Create Secure Identity
                </button>
              </form>
              <p
                style={{
                  textAlign: "center",
                  marginTop: "20px",
                  fontSize: "0.9rem",
                }}
              >
                Already registered?{" "}
                <a
                  href="/login"
                  style={{
                    color: "var(--color-cyan)",
                    fontWeight: "700",
                    textDecoration: "none",
                  }}
                >
                  Login to Dashboard
                </a>
              </p>
            </>
          )}
        </div>
      </div>
      <footer className="dashboard-footer">
        <p>© 2026 BioChain RTO System • Digital India Initiative</p>
      </footer>

      {/* Biometric Enrollment Modal */}
      <BiometricCaptureModal
        isOpen={showBiometric}
        onClose={() => setShowBiometric(false)}
        onSuccess={handleBiometricSuccess}
        personName={formData.name}
        personRole={formData.role}
        instructionText="Place your index finger on the biometric scanner to complete enrollment"
      />
    </div>
  );
}
