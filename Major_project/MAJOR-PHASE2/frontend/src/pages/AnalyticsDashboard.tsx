import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { KpiCard, KpiStrip, SectionCard } from "../lib/ui";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from "recharts";

interface RegistrationData {
  label: string;
  value: number;
  month: number;
  year: number;
}

interface TheftData {
  label: string;
  reported: number;
  recovered: number;
  month: number;
}

interface OfficerPerformance {
  officerId: string;
  name: string;
  email: string;
  approved: number;
  rejected: number;
  totalProcessed: number;
  avgApprovalTime: number;
  pendingRequests: number;
}

interface OverviewStats {
  counts: {
    totalVehicles: number;
    totalOwners: number;
    totalDealers: number;
    totalRequests: number;
    pendingRequests: number;
    totalTheftReports: number;
    activeTheftCases: number;
  };
  recentActivity: {
    registrations: number;
    transfers: number;
  };
}

const COLORS = {
  cyan: "#1e5aa8",
  green: "#0e7c3b",
  purple: "#6d28d9",
  orange: "#b45309",
  red: "#b91c1c",
  blue: "#3B82F6",
  yellow: "#d97706",
  pink: "#EC4899",
};

const PIE_COLORS = [COLORS.green, COLORS.orange, COLORS.red, COLORS.purple];

export default function AnalyticsDashboard() {
  const { user, api } = useAuth();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState("overview");
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [loading, setLoading] = useState(true);

  // Data states
  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [registrations, setRegistrations] = useState<RegistrationData[]>([]);
  const [transfers, setTransfers] = useState<RegistrationData[]>([]);
  const [theftData, setTheftData] = useState<{
    monthlyData: TheftData[];
    summary: {
      totalReported: number;
      totalRecovered: number;
      recoveryRate: string;
      pending: number;
    };
  } | null>(null);
  const [rtoPerformance, setRtoPerformance] = useState<{
    officers: OfficerPerformance[];
    overall: {
      totalRequests: number;
      totalApproved: number;
      totalRejected: number;
      totalPending: number;
    };
  } | null>(null);
  const [vehicleStatus, setVehicleStatus] = useState<
    { status: string; count: number; percentage: string }[]
  >([]);

  const fetchAllData = useCallback(async () => {
    setLoading(true);
    try {
      // Fetch all analytics data in parallel
      const [overviewRes, regRes, transferRes, theftRes, statusRes] =
        await Promise.all([
          api.get("/analytics/overview"),
          api.get(`/analytics/registrations?year=${selectedYear}`),
          api.get(`/analytics/transfers?year=${selectedYear}`),
          api.get(`/analytics/theft-recovery?year=${selectedYear}`),
          api.get("/analytics/vehicle-status"),
        ]);

      setOverview(overviewRes.data);
      setRegistrations(regRes.data.data);
      setTransfers(transferRes.data.data);
      setTheftData(theftRes.data);
      setVehicleStatus(statusRes.data.distribution);

      // Only fetch RTO performance for RTO users
      if (user?.role === "rto") {
        const perfRes = await api.get(
          `/analytics/rto-performance?year=${selectedYear}`,
        );
        setRtoPerformance(perfRes.data);
      }
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    } finally {
      setLoading(false);
    }
  }, [api, selectedYear, user?.role]);

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    fetchAllData();
  }, [user, navigate, fetchAllData]);

  const StatCard = ({
    title,
    value,
    subtitle,
    color,
    icon,
  }: {
    title: string;
    value: number | string;
    subtitle?: string;
    color: string;
    icon: string;
  }) => (
    <KpiCard
      label={title}
      value={value}
      sub={subtitle}
      accent={color}
      hint={icon || undefined}
    />
  );

  return (
    <DashboardLayout
      title="System Analytics & Reports"
      subtitle="Registration, transfer and theft-recovery trends across the registry"
    >
      <div className="container">
        <div className="card">
          <div className="analytics-header">
            <h3>System Analytics & Reports</h3>
            <div className="year-selector">
              <label>Year:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              >
                {[2024, 2025, 2026].map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="tab-navigation">
            <button
              className={`tab-btn ${activeTab === "overview" ? "active" : ""}`}
              onClick={() => setActiveTab("overview")}
            >
              Overview
            </button>
            <button
              className={`tab-btn ${
                activeTab === "registrations" ? "active" : ""
              }`}
              onClick={() => setActiveTab("registrations")}
            >
              Registrations
            </button>
            <button
              className={`tab-btn ${activeTab === "transfers" ? "active" : ""}`}
              onClick={() => setActiveTab("transfers")}
            >
              Transfers
            </button>
            <button
              className={`tab-btn ${activeTab === "theft" ? "active" : ""}`}
              onClick={() => setActiveTab("theft")}
            >
              Theft & Recovery
            </button>
            {user?.role === "rto" && (
              <button
                className={`tab-btn ${
                  activeTab === "performance" ? "active" : ""
                }`}
                onClick={() => setActiveTab("performance")}
              >
                RTO Performance
              </button>
            )}
          </div>

          {loading ? (
            <div className="loading-state">
              <p>Loading analytics data...</p>
            </div>
          ) : (
            <>
              {/* Overview Tab */}
              {activeTab === "overview" && overview && (
                <div className="analytics-tab">
                  <KpiStrip>
                    <StatCard
                      title="Total Vehicles"
                      value={overview.counts.totalVehicles}
                      subtitle="Records in the vehicle registry"
                      color={COLORS.cyan}
                      icon=""
                    />
                    <StatCard
                      title="Total Owners"
                      value={overview.counts.totalOwners}
                      subtitle="Active vehicle owners"
                      color={COLORS.green}
                      icon=""
                    />
                    <StatCard
                      title="Pending Requests"
                      value={overview.counts.pendingRequests}
                      subtitle="Awaiting RTO approval"
                      color={COLORS.orange}
                      icon=""
                    />
                    <StatCard
                      title="Active Theft Cases"
                      value={overview.counts.activeTheftCases}
                      subtitle="Under investigation"
                      color={COLORS.red}
                      icon=""
                    />
                  </KpiStrip>

                  <KpiStrip>
                    <StatCard
                      title="Recent Registrations"
                      value={overview.recentActivity.registrations}
                      subtitle="Last 30 days"
                      color={COLORS.blue}
                      icon=""
                    />
                    <StatCard
                      title="Recent Transfers"
                      value={overview.recentActivity.transfers}
                      subtitle="Last 30 days"
                      color={COLORS.purple}
                      icon=""
                    />
                    <StatCard
                      title="Total Dealers"
                      value={overview.counts.totalDealers}
                      subtitle="Authorized dealers"
                      color={COLORS.yellow}
                      icon=""
                    />
                    <StatCard
                      title="Theft Reports"
                      value={overview.counts.totalTheftReports}
                      subtitle="All time"
                      color={COLORS.pink}
                      icon=""
                    />
                  </KpiStrip>

                  {/* Vehicle Status Distribution */}
                  <SectionCard title="Vehicle Status Distribution">
                    <div className="chart-container pie-chart">
                      <ResponsiveContainer width="100%" height={300}>
                        <PieChart>
                          <Pie
                            data={vehicleStatus}
                            cx="50%"
                            cy="50%"
                            labelLine={false}
                            label={({ name, percent }) =>
                              `${name}: ${
                                percent ? (percent * 100).toFixed(1) : 0
                              }%`
                            }
                            outerRadius={100}
                            fill="#8884d8"
                            dataKey="count"
                            nameKey="status"
                          >
                            {vehicleStatus.map((_entry, index) => (
                              <Cell
                                key={`cell-${index}`}
                                fill={PIE_COLORS[index % PIE_COLORS.length]}
                              />
                            ))}
                          </Pie>
                          <Tooltip />
                          <Legend />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                  </SectionCard>
                </div>
              )}

              {/* Registrations Tab */}
              {activeTab === "registrations" && (
                <div className="analytics-tab">
                  <div className="chart-header">
                    <h4>Vehicle Registrations - {selectedYear}</h4>
                    <p className="chart-subtitle">
                      Total:{" "}
                      {registrations.reduce((sum, r) => sum + r.value, 0)}{" "}
                      registrations
                    </p>
                  </div>
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={400}>
                      <AreaChart data={registrations}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d5dce6" />
                        <XAxis dataKey="label" stroke="#6b7280" />
                        <YAxis stroke="#6b7280" allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Area
                          type="monotone"
                          dataKey="value"
                          name="Registrations"
                          stroke={COLORS.cyan}
                          fill={COLORS.cyan}
                          fillOpacity={0.3}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Registration Stats Table */}
                  <div className="stats-table-section">
                    <h4>Monthly Breakdown</h4>
                    <table className="table stats-table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Registrations</th>
                          <th>Trend</th>
                        </tr>
                      </thead>
                      <tbody>
                        {registrations.map((month, index) => {
                          const prevMonth =
                            index > 0 ? registrations[index - 1].value : 0;
                          const trend =
                            prevMonth > 0
                              ? ((month.value - prevMonth) / prevMonth) * 100
                              : 0;
                          return (
                            <tr key={month.label}>
                              <td>{month.label}</td>
                              <td>{month.value}</td>
                              <td>
                                {trend > 0 ? (
                                  <span style={{ color: COLORS.green }}>
                                    {trend.toFixed(1)}%
                                  </span>
                                ) : trend < 0 ? (
                                  <span style={{ color: COLORS.red }}>
                                    {trend.toFixed(1)}%
                                  </span>
                                ) : (
                                  <span style={{ color: COLORS.orange }}>
                                    -
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Transfers Tab */}
              {activeTab === "transfers" && (
                <div className="analytics-tab">
                  <div className="chart-header">
                    <h4>Ownership Transfers - {selectedYear}</h4>
                    <p className="chart-subtitle">
                      Total: {transfers.reduce((sum, t) => sum + t.value, 0)}{" "}
                      transfers
                    </p>
                  </div>
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={400}>
                      <BarChart data={transfers}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d5dce6" />
                        <XAxis dataKey="label" stroke="#6b7280" />
                        <YAxis stroke="#6b7280" allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Bar
                          dataKey="value"
                          name="Transfers"
                          fill={COLORS.purple}
                          radius={[4, 4, 0, 0]}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Theft & Recovery Tab */}
              {activeTab === "theft" && theftData && (
                <div className="analytics-tab">
                  <KpiStrip>
                    <StatCard
                      title="Total Reported"
                      value={theftData.summary.totalReported}
                      subtitle="Theft incidents"
                      color={COLORS.red}
                      icon=""
                    />
                    <StatCard
                      title="Total Recovered"
                      value={theftData.summary.totalRecovered}
                      subtitle="Vehicles recovered"
                      color={COLORS.green}
                      icon=""
                    />
                    <StatCard
                      title="Recovery Rate"
                      value={`${theftData.summary.recoveryRate}%`}
                      subtitle="Success rate"
                      color={COLORS.cyan}
                      icon=""
                    />
                    <StatCard
                      title="Pending Cases"
                      value={theftData.summary.pending}
                      subtitle="Under investigation"
                      color={COLORS.orange}
                      icon=""
                    />
                  </KpiStrip>

                  <div className="chart-header">
                    <h4>Theft Reports vs Recoveries - {selectedYear}</h4>
                  </div>
                  <div className="chart-container">
                    <ResponsiveContainer width="100%" height={400}>
                      <LineChart data={theftData.monthlyData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d5dce6" />
                        <XAxis dataKey="label" stroke="#6b7280" />
                        <YAxis stroke="#6b7280" allowDecimals={false} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#ffffff",
                            border: "1px solid var(--color-border)",
                            borderRadius: "8px",
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="reported"
                          name="Reported"
                          stroke={COLORS.red}
                          strokeWidth={2}
                          dot={{ fill: COLORS.red }}
                        />
                        <Line
                          type="monotone"
                          dataKey="recovered"
                          name="Recovered"
                          stroke={COLORS.green}
                          strokeWidth={2}
                          dot={{ fill: COLORS.green }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* RTO Performance Tab */}
              {activeTab === "performance" &&
                rtoPerformance &&
                user?.role === "rto" && (
                  <div className="analytics-tab">
                    <KpiStrip>
                      <StatCard
                        title="Total Processed"
                        value={rtoPerformance.overall.totalRequests}
                        subtitle="All requests"
                        color={COLORS.cyan}
                        icon=""
                      />
                      <StatCard
                        title="Approved"
                        value={rtoPerformance.overall.totalApproved}
                        subtitle="Approved requests"
                        color={COLORS.green}
                        icon=""
                      />
                      <StatCard
                        title="Rejected"
                        value={rtoPerformance.overall.totalRejected}
                        subtitle="Rejected requests"
                        color={COLORS.red}
                        icon=""
                      />
                      <StatCard
                        title="Pending"
                        value={rtoPerformance.overall.totalPending}
                        subtitle="Awaiting action"
                        color={COLORS.orange}
                        icon=""
                      />
                    </KpiStrip>

                    <div className="chart-header">
                      <h4>RTO Officer Performance - {selectedYear}</h4>
                    </div>

                    <div className="performance-table">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>Officer</th>
                            <th>Approved</th>
                            <th>Rejected</th>
                            <th>Total</th>
                            <th>Avg. Approval Time</th>
                            <th>Pending</th>
                            <th>Efficiency</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rtoPerformance.officers.map((officer) => {
                            const efficiency =
                              officer.totalProcessed > 0
                                ? (
                                    (officer.approved /
                                      officer.totalProcessed) *
                                    100
                                  ).toFixed(1)
                                : 0;
                            return (
                              <tr key={officer.officerId}>
                                <td>
                                  <strong>{officer.name}</strong>
                                  <br />
                                  <small
                                    style={{ color: "var(--color-text-muted)" }}
                                  >
                                    {officer.email}
                                  </small>
                                </td>
                                <td style={{ color: COLORS.green }}>
                                  {officer.approved}
                                </td>
                                <td style={{ color: COLORS.red }}>
                                  {officer.rejected}
                                </td>
                                <td>{officer.totalProcessed}</td>
                                <td>{officer.avgApprovalTime} hrs</td>
                                <td style={{ color: COLORS.orange }}>
                                  {officer.pendingRequests}
                                </td>
                                <td>
                                  <span
                                    className="efficiency-badge"
                                    style={{
                                      backgroundColor:
                                        parseFloat(efficiency as string) >= 80
                                          ? `${COLORS.green}30`
                                          : parseFloat(efficiency as string) >=
                                              60
                                            ? `${COLORS.orange}30`
                                            : `${COLORS.red}30`,
                                      color:
                                        parseFloat(efficiency as string) >= 80
                                          ? COLORS.green
                                          : parseFloat(efficiency as string) >=
                                              60
                                            ? COLORS.orange
                                            : COLORS.red,
                                    }}
                                  >
                                    {efficiency}%
                                  </span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
            </>
          )}
        </div>

        <footer className="dashboard-footer">
          <p>© 2026 BioChain RTO System • Digital India Initiative</p>
        </footer>
      </div>
    </DashboardLayout>
  );
}
