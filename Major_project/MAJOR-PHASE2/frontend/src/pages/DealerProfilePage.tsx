import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { Navigate, useNavigate } from "react-router-dom";
import DigitalIdCard from "../components/DigitalIdCard";
import DashboardLayout from "../components/DashboardLayout";
import { STATES, resolveStateCode } from "../lib/states";

export default function DealerProfilePage() {
  const { user, api } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    name: "",
    email: "",
    phone: "",
    address: "",
    state: "",
    district: "",
    aadhaarNumber: "",
    dlNumber: "",
    businessName: "",
    gstin: "",
    tin: "",
    licenseNumber: "",
    showroomAddress: "",
    contactPerson: "",
    contactPhone: "",
    contactEmail: "",
  });

  const [profilePhotoUrl, setProfilePhotoUrl] = useState<string>("");
  const [profilePhotoFile, setProfilePhotoFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadProfile = useCallback(async () => {
    if (user) {
      setFormData({
        name: user.name || "",
        email: user.email || "",
        phone: user.phone || "",
        address: user.address || "",
        state: resolveStateCode(user.state) || "",
        district: user.district || "",
        aadhaarNumber: user.aadhaarNumber || "",
        dlNumber: user.dlNumber || "",
        businessName: user.dealerDetails?.businessName || "",
        gstin: user.dealerDetails?.gstin || "",
        tin: user.dealerDetails?.tin || "",
        licenseNumber: user.dealerDetails?.licenseNumber || "",
        showroomAddress: user.dealerDetails?.showroomAddress || "",
        contactPerson: user.dealerDetails?.contactPerson || "",
        contactPhone: user.dealerDetails?.contactPhone || "",
        contactEmail: user.dealerDetails?.contactEmail || "",
      });

      if (user.hasProfilePhoto && user.id) {
        try {
          const response = await api.get(`/auth/users/${user.id}/photo`, {
            responseType: "blob",
          });
          const url = URL.createObjectURL(response.data);
          setProfilePhotoUrl(url);
        } catch {
          // Use default
        }
      }
    }
  }, [user, api]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setProfilePhotoFile(file);
      const url = URL.createObjectURL(file);
      setProfilePhotoUrl(url);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      // Upload photo if changed
      if (profilePhotoFile && user?.id) {
        const photoFormData = new FormData();
        photoFormData.append("profilePhoto", profilePhotoFile);
        await api.put(`/auth/${user.id}/photo`, photoFormData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      }

      // Update profile data
      await api.put(`/auth/users/${user?.id}`, {
        name: formData.name,
        phone: formData.phone,
        address: formData.address,
        state: formData.state,
        district: formData.district,
      });

      // Update dealer details
      await api.put("/auth/update-dealer-details", {
        dealerDetails: {
          businessName: formData.businessName,
          gstin: formData.gstin,
          tin: formData.tin,
          licenseNumber: formData.licenseNumber,
          showroomAddress: formData.showroomAddress,
          contactPerson: formData.contactPerson,
          contactPhone: formData.contactPhone,
          contactEmail: formData.contactEmail,
        },
      });

      setMessage("Profile updated successfully.");
      setTimeout(() => setMessage(""), 3000);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setMessage("Error: " + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role !== "dealer") {
    // <Navigate> rather than navigate() in the render phase, which React Router drops.
    return <Navigate to="/login" replace />;
  }

  return (
    <DashboardLayout
      title="Dealer Profile"
      subtitle="Your details and Digital ID Card"
    >
      <div className="container">
        <DigitalIdCard />

        <div
          className="card"
          style={{ maxWidth: "900px", margin: "2rem auto" }}
        >
          <h3>Dealer Profile & Business Details</h3>

          {message && (
            <div
              style={{
                padding: "1rem",
                marginBottom: "1.5rem",
                borderRadius: "8px",
                background: message.includes("") ? "#e8f5e9" : "#ffebee",
                color: message.includes("") ? "#2e7d32" : "#c62828",
                border: `1px solid ${message.includes("") ? "#a5d6a7" : "#ef9a9a"}`,
              }}
            >
              {message}
            </div>
          )}

          {/* Profile Photo */}
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <div
              style={{
                width: "120px",
                height: "120px",
                borderRadius: "50%",
                margin: "0 auto 1rem",
                overflow: "hidden",
                border: "4px solid #1e5aa8",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: profilePhotoUrl
                  ? "transparent"
                  : "linear-gradient(135deg, #1e5aa8 0%, #16437e 100%)",
              }}
            >
              {profilePhotoUrl ? (
                <img
                  src={profilePhotoUrl}
                  alt="Profile"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                <span
                  style={{
                    color: "#fff",
                    fontSize: "3rem",
                    fontWeight: "bold",
                  }}
                >
                  {formData.name?.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
            <label
              style={{
                cursor: "pointer",
                color: "#1e5aa8",
                fontWeight: "bold",
              }}
            >
              Change Profile Photo
              <input
                type="file"
                accept="image/*"
                onChange={handlePhotoChange}
                style={{ display: "none" }}
              />
            </label>
          </div>

          <form onSubmit={handleSubmit}>
            <h4 style={{ marginBottom: "1rem", color: "#1e5aa8" }}>
              Personal Details
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1.5rem",
                marginBottom: "2rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Full Name *
                </label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Phone Number
                </label>
                <input
                  type="tel"
                  name="phone"
                  value={formData.phone}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Address
                </label>
                <textarea
                  name="address"
                  value={formData.address}
                  onChange={handleChange}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    resize: "vertical",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  State
                </label>
                <select
                  name="state"
                  value={formData.state}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                >
                  <option value="">Select State</option>
                  {STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  District
                </label>
                <input
                  type="text"
                  name="district"
                  value={formData.district}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              {/* Locked Fields */}
              <div
                style={{
                  gridColumn: "1 / -1",
                  marginTop: "1rem",
                  paddingTop: "1rem",
                  borderTop: "2px solid #eee",
                }}
              >
                <h4 style={{ color: "#999" }}>
                  Permanent Details (Cannot be changed)
                </h4>
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                    color: "#999",
                  }}
                >
                  Email
                </label>
                <input
                  type="email"
                  value={formData.email}
                  disabled
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #eee",
                    borderRadius: "6px",
                    background: "#f5f5f5",
                    color: "#999",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                    color: "#999",
                  }}
                >
                  Aadhaar Number
                </label>
                <input
                  type="text"
                  value={formData.aadhaarNumber}
                  disabled
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #eee",
                    borderRadius: "6px",
                    background: "#f5f5f5",
                    color: "#999",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                    color: "#999",
                  }}
                >
                  DL Number
                </label>
                <input
                  type="text"
                  value={formData.dlNumber}
                  disabled
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #eee",
                    borderRadius: "6px",
                    background: "#f5f5f5",
                    color: "#999",
                  }}
                />
              </div>
            </div>

            <h4 style={{ marginBottom: "1rem", color: "#1e5aa8" }}>
              Business Details
            </h4>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "1.5rem",
              }}
            >
              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Business Name *
                </label>
                <input
                  type="text"
                  name="businessName"
                  value={formData.businessName}
                  onChange={handleChange}
                  required
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  GSTIN
                </label>
                <input
                  type="text"
                  name="gstin"
                  value={formData.gstin}
                  onChange={handleChange}
                  placeholder="e.g., 29AABCU9603R1ZM"
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  TIN
                </label>
                <input
                  type="text"
                  name="tin"
                  value={formData.tin}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  License Number
                </label>
                <input
                  type="text"
                  name="licenseNumber"
                  value={formData.licenseNumber}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Showroom Address
                </label>
                <textarea
                  name="showroomAddress"
                  value={formData.showroomAddress}
                  onChange={handleChange}
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    resize: "vertical",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Contact Person
                </label>
                <input
                  type="text"
                  name="contactPerson"
                  value={formData.contactPerson}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Contact Phone
                </label>
                <input
                  type="tel"
                  name="contactPhone"
                  value={formData.contactPhone}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Contact Email
                </label>
                <input
                  type="email"
                  name="contactEmail"
                  value={formData.contactEmail}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                  }}
                />
              </div>
            </div>

            <div style={{ marginTop: "2rem", display: "flex", gap: "1rem" }}>
              <button
                type="submit"
                className="btn btn-success"
                disabled={loading}
                style={{ flex: 1 }}
              >
                {loading ? "Updating..." : "Update Profile"}
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => navigate("/dealer")}
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </DashboardLayout>
  );
}
