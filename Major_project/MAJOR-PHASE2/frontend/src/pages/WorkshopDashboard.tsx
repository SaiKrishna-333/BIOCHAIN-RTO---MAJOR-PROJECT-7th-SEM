import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";
import DigitalIdCard from "../components/DigitalIdCard";
import DashboardLayout from "../components/DashboardLayout";
import IncomingRequests from "../components/IncomingRequests";
import { OverviewBand } from "../lib/OverviewBand";
import { DataTable, StatusPill } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import { enumLabel } from "../lib/display";

interface BrandVehicle {
  _id: string;
  regNumber?: string;
  chassisNumber: string;
  make: string;
  model: string;
  year: number;
  status: string;
}

// Axios-style error with a JSON message body (project convention)
type ApiError = { response?: { data?: { message?: string } } };
const apiMessage = (err: unknown, fallback: string) =>
  (err as ApiError)?.response?.data?.message || fallback;

export default function WorkshopDashboard() {
  const { user, api } = useAuth();
  const navigate = useNavigate();

  const [vehicles, setVehicles] = useState<BrandVehicle[]>([]);
  const [needProfile, setNeedProfile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState({
    companyName: user?.workshopDetails?.companyName || "",
    affiliatedManufacturer: user?.workshopDetails?.affiliatedManufacturer || "",
    gstin: user?.workshopDetails?.gstin || "",
    licenseNumber: user?.workshopDetails?.licenseNumber || "",
    address: user?.workshopDetails?.address || "",
    phone: user?.workshopDetails?.phone || "",
  });
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get("/vehicle-intelligence/my-brand-vehicles");
      setVehicles(res.data.vehicles);
      setNeedProfile(res.data.needProfile);
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to load vehicles."));
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    load();
  }, [load]);

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await api.put("/auth/update-workshop-details", {
        workshopDetails: profile,
      });
      // refresh stored user info
      const stored = JSON.parse(localStorage.getItem("user") || "{}");
      stored.workshopDetails = {
        ...profile,
        verified: user?.workshopDetails?.verified || false,
      };
      localStorage.setItem("user", JSON.stringify(stored));
      setSaved(true);
      setMessage("Company details saved. Re-login to see them across the app.");
      load();
    } catch (err: unknown) {
      setError(apiMessage(err, "Failed to save company details."));
    }
  };

  const verified = user?.workshopDetails?.verified;

  // KPI band counted from the brand vehicles already loaded on this page.
  const band = useMemo(() => {
    const active = vehicles.filter((v) => v.status === "active").length;
    const other = vehicles.length - active;
    const kpis = [
      {
        label: "Brand vehicles",
        value: vehicles.length,
        sub: "Matching your make",
        accent: BIO.blue,
      },
      { label: "Active", value: active, sub: "On the road", accent: BIO.green },
      {
        label: "Other status",
        value: other,
        sub: "Inactive / flagged",
        accent: BIO.amber,
      },
      {
        label: "Verification",
        value: verified ? "Verified" : "Pending",
        sub: verified ? "Can submit records" : "Awaiting admin/RTO",
        accent: verified ? BIO.green : BIO.red,
      },
    ];
    const pie = [
      { key: "active", name: "Active", value: active, color: BIO.green },
      { key: "other", name: "Other", value: other, color: BIO.amber },
    ].filter((s) => s.value > 0);
    return { kpis, pie };
  }, [vehicles, verified]);

  // Sidebar deep-links choose which section is visible
  const location = useLocation();
  const section = new URLSearchParams(location.search).get("tab") || "home";

  return (
    <DashboardLayout
      title="Workshop Dashboard"
      subtitle="Maintain verified service history for your brand's vehicles"
      activeSection={section === "home" ? undefined : section}
    >
      <div className="container" style={{ marginBottom: 40 }}>
        {section === "card" && <DigitalIdCard />}

        {section === "requests" && (
          <div className="card" style={{ padding: 20 }}>
            <IncomingRequests />
          </div>
        )}

        {section === "home" && (
          <>
            {message && (
              <div className="alert alert-info" style={{ marginTop: 15 }}>
                {message}
              </div>
            )}
            {error && (
              <div className="alert alert-danger" style={{ marginTop: 15 }}>
                {error}
              </div>
            )}

            {!verified && (
              <div className="alert alert-warning" style={{ marginTop: 15 }}>
                Your workshop is <strong>not verified yet</strong>. You can fill
                in your company details below, but service records can only be
                submitted after an admin/RTO verifies your service-centre
                credentials.
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <OverviewBand
                kpis={band.kpis}
                pie={band.pie}
                pieTitle="Brand vehicles by status"
                note="Counts are derived live from the vehicles registered under your manufacturer make."
              />
            </div>

            {/* Company profile */}
            <div className="card" style={{ padding: 20, marginTop: 20 }}>
              <h4>Company Details</h4>
              <p style={{ color: "#666", fontSize: "0.9rem" }}>
                Register the vehicle company you belong to (e.g.{" "}
                <em>Maruti Suzuki</em>). Only vehicles whose make matches this
                company will appear in your list — you cannot see other brands'
                data.
              </p>
              <form onSubmit={saveProfile}>
                <div className="row g-3">
                  <div className="col-md-6">
                    <label>Your Shop / Agency Name</label>
                    <input
                      className="form-control"
                      required
                      placeholder="e.g. Sai Automobiles"
                      value={profile.companyName}
                      onChange={(e) =>
                        setProfile({ ...profile, companyName: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-6">
                    <label>Vehicle Company (Manufacturer)</label>
                    <input
                      className="form-control"
                      required
                      placeholder="e.g. Maruti Suzuki"
                      value={profile.affiliatedManufacturer}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          affiliatedManufacturer: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-4">
                    <label>GSTIN (optional)</label>
                    <input
                      className="form-control"
                      value={profile.gstin}
                      onChange={(e) =>
                        setProfile({ ...profile, gstin: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-md-4">
                    <label>Service Licence No. (optional)</label>
                    <input
                      className="form-control"
                      value={profile.licenseNumber}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          licenseNumber: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="col-md-4">
                    <label>Phone (optional)</label>
                    <input
                      className="form-control"
                      value={profile.phone}
                      onChange={(e) =>
                        setProfile({ ...profile, phone: e.target.value })
                      }
                    />
                  </div>
                  <div className="col-12">
                    <label>Address (optional)</label>
                    <input
                      className="form-control"
                      value={profile.address}
                      onChange={(e) =>
                        setProfile({ ...profile, address: e.target.value })
                      }
                    />
                  </div>
                </div>
                <button
                  type="submit"
                  className="btn btn-primary"
                  style={{ marginTop: 15 }}
                >
                  {saved ? "Saved (update again)" : "Save Company Details"}
                </button>
              </form>
            </div>

            {/* Matching vehicles */}
            <div style={{ marginTop: 25 }}>
              <h4>
                {needProfile
                  ? "Save your company details to see matching vehicles"
                  : `Vehicles of ${profile.affiliatedManufacturer || "your company"}`}
              </h4>
              {loading ? (
                <p>Loading…</p>
              ) : vehicles.length === 0 ? (
                <div className="alert alert-secondary">
                  No vehicles registered under your company make yet.
                </div>
              ) : (
                <DataTable<BrandVehicle>
                  rows={vehicles}
                  rowKey={(v) => v._id}
                  searchPlaceholder="Search registration, chassis or model…"
                  emptyTitle="No vehicles yet"
                  columns={[
                    {
                      key: "regNumber",
                      header: "Reg No.",
                      sortable: true,
                      value: (v) => v.regNumber || "—",
                    },
                    {
                      key: "make",
                      header: "Make / Model",
                      sortable: true,
                      value: (v) => `${v.make} ${v.model}`,
                    },
                    {
                      key: "year",
                      header: "Year",
                      sortable: true,
                      value: (v) => v.year,
                    },
                    {
                      key: "status",
                      header: "Status",
                      sortable: true,
                      value: (v) => v.status,
                      render: (v) => (
                        <StatusPill
                          status={v.status}
                          label={enumLabel(v.status)}
                        />
                      ),
                    },
                    {
                      key: "actions",
                      header: "Actions",
                      sortable: false,
                      render: (v) => (
                        <button
                          className="btn btn-primary btn-sm"
                          disabled={!verified}
                          title={
                            verified
                              ? "View & maintain service history"
                              : "Workshop verification required"
                          }
                          onClick={() => navigate(`/vehicle-history/${v._id}`)}
                        >
                          Service History
                        </button>
                      ),
                    },
                  ]}
                />
              )}
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
}
