import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { Navigate, useNavigate } from "react-router-dom";
import DigitalIdCard from "../components/DigitalIdCard";
import DashboardLayout from "../components/DashboardLayout";
import { STATES, stateName, resolveStateCode } from "../lib/states";

export default function RTOProfilePage() {
  const { user, api } = useAuth();
  const navigate = useNavigate();

  const [formData, setFormData] = useState({
    stateCode: "",
    stateName: "",
    district: "",
    rtoOfficeCode: "",
    rtoOfficeName: "",
    designation: "",
    employeeId: "",
    officeAddress: "",
    jurisdiction: "",
  });

  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const loadRTOProfile = useCallback(async () => {
    if (user?.rtoDetails) {
      setFormData({
        stateCode: resolveStateCode(user.rtoDetails.stateCode) || "",
        stateName: user.rtoDetails.stateName || "",
        district: user.rtoDetails.district || "",
        rtoOfficeCode: user.rtoDetails.rtoOfficeCode || "",
        rtoOfficeName: user.rtoDetails.rtoOfficeName || "",
        designation: user.rtoDetails.designation || "",
        employeeId: user.rtoDetails.employeeId || "",
        officeAddress: user.rtoDetails.officeAddress || "",
        jurisdiction: user.rtoDetails.jurisdiction || "",
      });
    }
  }, [user]);

  useEffect(() => {
    loadRTOProfile();
  }, [loadRTOProfile]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: value,
      ...(name === "stateCode" && {
        stateName: stateName(value),
      }),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      await api.put("/auth/update-rto-details", { rtoDetails: formData });
      setMessage("Profile updated successfully.");
      setTimeout(() => {
        navigate("/rto");
      }, 1500);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setMessage("Error: " + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  if (!user || user.role !== "rto") {
    // <Navigate> rather than navigate() in the render phase, which React Router drops.
    return <Navigate to="/login" replace />;
  }

  return (
    <DashboardLayout
      title="Officer Profile"
      subtitle="Your details and Digital ID Card"
    >
      <div className="container">
        <DigitalIdCard />

        <div
          className="card"
          style={{ maxWidth: "900px", margin: "2rem auto" }}
        >
          <h3>RTO Officer Profile</h3>
          <p style={{ color: "#666", marginBottom: "2rem" }}>
            Update your RTO office details and jurisdiction information
          </p>

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

          <form onSubmit={handleSubmit}>
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
                  State <span style={{ color: "red" }}>*</span>
                </label>
                <select
                  name="stateCode"
                  value={formData.stateCode}
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
                  {STATES.map((state) => (
                    <option key={state.code} value={state.code}>
                      {state.name}
                    </option>
                  ))}
                </select>
                {formData.stateName && (
                  <p
                    style={{
                      margin: "0.5rem 0 0 0",
                      fontSize: "0.85rem",
                      color: "#666",
                    }}
                  >
                    Selected: {formData.stateName}
                  </p>
                )}
              </div>

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  RTO Office Code <span style={{ color: "red" }}>*</span>
                </label>
                <input
                  type="text"
                  name="rtoOfficeCode"
                  placeholder="e.g., KA-01, TS-07"
                  value={formData.rtoOfficeCode}
                  onChange={handleChange}
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

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  RTO Office Name <span style={{ color: "red" }}>*</span>
                </label>
                <input
                  type="text"
                  name="rtoOfficeName"
                  placeholder="e.g., Bangalore Central RTO"
                  value={formData.rtoOfficeName}
                  onChange={handleChange}
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

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  District <span style={{ color: "red" }}>*</span>
                </label>
                <input
                  type="text"
                  name="district"
                  placeholder="e.g., Bangalore Urban"
                  value={formData.district}
                  onChange={handleChange}
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

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Employee ID <span style={{ color: "red" }}>*</span>
                </label>
                <input
                  type="text"
                  name="employeeId"
                  placeholder="Your official employee ID"
                  value={formData.employeeId}
                  onChange={handleChange}
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

              <div>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Designation
                </label>
                <select
                  name="designation"
                  value={formData.designation}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    fontSize: "1rem",
                  }}
                >
                  <option value="RTO Officer">RTO Officer</option>
                  <option value="Assistant RTO">Assistant RTO</option>
                  <option value="Senior RTO Officer">Senior RTO Officer</option>
                  <option value="Deputy RTO">Deputy RTO</option>
                </select>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label
                  style={{
                    display: "block",
                    marginBottom: "0.5rem",
                    fontWeight: "bold",
                  }}
                >
                  Office Address <span style={{ color: "red" }}>*</span>
                </label>
                <textarea
                  name="officeAddress"
                  placeholder="Complete office address with location details"
                  value={formData.officeAddress}
                  onChange={handleChange}
                  required
                  rows={3}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    fontSize: "1rem",
                    resize: "vertical",
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
                  Jurisdiction Area
                </label>
                <input
                  type="text"
                  name="jurisdiction"
                  placeholder="e.g., Bangalore Urban District, Karnataka"
                  value={formData.jurisdiction}
                  onChange={handleChange}
                  style={{
                    width: "100%",
                    padding: "0.75rem",
                    border: "1px solid #ddd",
                    borderRadius: "6px",
                    fontSize: "1rem",
                  }}
                />
                <p
                  style={{
                    margin: "0.5rem 0 0 0",
                    fontSize: "0.85rem",
                    color: "#666",
                  }}
                >
                  Specify the area/district under your jurisdiction
                </p>
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
                onClick={() => navigate("/rto")}
              >
                Cancel
              </button>
            </div>
          </form>

          <div
            style={{
              marginTop: "2rem",
              padding: "1.5rem",
              background: "#e3f2fd",
              borderRadius: "8px",
            }}
          >
            <h4 style={{ margin: "0 0 1rem 0", color: "#1565c0" }}>
              Profile Information
            </h4>
            <div
              style={{ fontSize: "0.9rem", color: "#555", lineHeight: "1.8" }}
            >
              <p style={{ margin: "0.5rem 0" }}>
                <strong>State Code:</strong> The state this office belongs to.
                It is recorded on the approvals and certificates this officer
                issues.
              </p>
              <p style={{ margin: "0.5rem 0" }}>
                <strong>RTO Office Code:</strong> Official code for your RTO
                office (e.g., KA-01 for Bangalore Central)
              </p>
              <p style={{ margin: "0.5rem 0" }}>
                <strong>Jurisdiction:</strong> Geographic area under your
                authority
              </p>
              <p style={{ margin: "0.5rem 0" }}>
                <strong>Review Queue:</strong> Every signed-in RTO officer sees
                the full list of pending requests across all states - the state
                code identifies the issuing office rather than filtering the
                queue.
              </p>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
