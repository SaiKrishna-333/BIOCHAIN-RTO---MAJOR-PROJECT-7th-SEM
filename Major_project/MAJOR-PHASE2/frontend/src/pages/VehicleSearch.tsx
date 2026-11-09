import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/useAuth";
import { useNavigate } from "react-router-dom";
import DashboardLayout from "../components/DashboardLayout";
import { KpiCard, KpiStrip, StatusPill } from "../lib/ui";
import { BIO } from "../lib/ui-tokens";
import { formatDate } from "../lib/display";
import { notify } from "../lib/notify";

interface Vehicle {
  _id: string;
  regNumber?: string;
  chassisNumber: string;
  engineNumber: string;
  make: string;
  model: string;
  year: number;
  status: string;
  blockchainTxHash?: string;
  createdAt: string;
  currentOwner?: {
    name: string;
    email: string;
    phone?: string;
    aadhaarNumber?: string;
  };
}

interface Pagination {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
}

export default function VehicleSearch() {
  const { user, api } = useAuth();
  const navigate = useNavigate();

  // Search state
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [make, setMake] = useState("");
  const [year, setYear] = useState("");
  const [ownerName, setOwnerName] = useState("");

  // Results state
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    currentPage: 1,
    totalPages: 1,
    totalCount: 0,
    limit: 20,
  });
  const [makes, setMakes] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Fetch available makes for dropdown
  const fetchMakes = useCallback(async () => {
    try {
      const res = await api.get("/vehicles/makes");
      setMakes(res.data);
    } catch {
      // The make filter simply offers no extra choices if this list is unavailable.
    }
  }, [api]);

  // Search function
  const performSearch = useCallback(
    async (page = 1) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        if (query) params.append("query", query);
        if (status && status !== "all") params.append("status", status);
        if (dateFrom) params.append("dateFrom", dateFrom);
        if (dateTo) params.append("dateTo", dateTo);
        if (make) params.append("make", make);
        if (year) params.append("year", year);
        if (ownerName) params.append("ownerName", ownerName);
        params.append("page", page.toString());

        const res = await api.get(`/vehicles/search?${params.toString()}`);
        setVehicles(res.data.vehicles);
        setPagination(res.data.pagination);
        setHasSearched(true);
      } catch (err) {
        // Say what went wrong instead of a generic retry plea.
        notify(
          err instanceof Error
            ? err.message
            : "Search failed. Please try again.",
          "error",
        );
      } finally {
        setLoading(false);
      }
    },
    [api, query, status, dateFrom, dateTo, make, year, ownerName],
  );

  // Initial load
  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }
    fetchMakes();
    // Auto-search on mount for RTO/Police
    if (user.role === "rto" || user.role === "police") {
      performSearch(1);
    }
  }, [user, navigate, fetchMakes, performSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    performSearch(1);
  };

  const handleClearFilters = () => {
    setQuery("");
    setStatus("all");
    setDateFrom("");
    setDateTo("");
    setMake("");
    setYear("");
    setOwnerName("");
    setHasSearched(false);
    setVehicles([]);
  };

  const handlePageChange = (newPage: number) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      performSearch(newPage);
    }
  };

  const flaggedOnPage = vehicles.filter(
    (v) => v.status && v.status.toLowerCase() !== "active",
  ).length;

  return (
    <DashboardLayout
      title="Advanced Vehicle Search"
      subtitle="Look up any vehicle by registration, chassis or owner"
    >
      <div className="container">
        <div className="card">
          <h3>Advanced Vehicle Search</h3>
          <p
            style={{
              color: "var(--color-text-secondary)",
              marginBottom: "20px",
            }}
          >
            Search vehicles by registration number, chassis number, owner name,
            or apply filters.
          </p>

          {/* Search Form */}
          <form onSubmit={handleSearch} className="search-form">
            <div className="search-grid">
              {/* Global Search */}
              <div className="form-group search-global">
                <label>Search Query</label>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Reg No, Chassis, Engine, Make, Model..."
                  className="search-input"
                />
              </div>

              {/* Status Filter */}
              <div className="form-group">
                <label>Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                >
                  <option value="all">All Status</option>
                  <option value="active">Active</option>
                  <option value="stolen">Stolen</option>
                  <option value="blocked">Blocked</option>
                  <option value="scrapped">Scrapped</option>
                </select>
              </div>

              {/* Make Filter */}
              <div className="form-group">
                <label>Make</label>
                <select value={make} onChange={(e) => setMake(e.target.value)}>
                  <option value="">All Makes</option>
                  {makes.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>

              {/* Year Filter */}
              <div className="form-group">
                <label>Year</label>
                <input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(e.target.value)}
                  placeholder="e.g., 2024"
                  min="1900"
                  max={new Date().getFullYear() + 1}
                />
              </div>

              {/* Owner Name */}
              <div className="form-group">
                <label>Owner Name</label>
                <input
                  type="text"
                  value={ownerName}
                  onChange={(e) => setOwnerName(e.target.value)}
                  placeholder="Search by owner name..."
                />
              </div>

              {/* Date From */}
              <div className="form-group">
                <label>Date From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>

              {/* Date To */}
              <div className="form-group">
                <label>Date To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            {/* Action Buttons */}
            <div className="search-actions">
              <button
                type="submit"
                className="btn btn-success"
                disabled={loading}
              >
                {loading ? "Searching..." : "Search"}
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={handleClearFilters}
                disabled={loading}
              >
                Clear Filters
              </button>
            </div>
          </form>

          {/* Results Summary */}
          {hasSearched && (
            <div style={{ marginBottom: 16 }}>
              <KpiStrip>
                <KpiCard
                  label="Total Matches"
                  value={pagination.totalCount}
                  sub="across the whole registry"
                  accent={BIO.blue}
                />
                <KpiCard
                  label="Shown On Page"
                  value={vehicles.length}
                  sub={
                    pagination.totalPages > 1
                      ? `page ${pagination.currentPage} of ${pagination.totalPages}`
                      : "single page of results"
                  }
                  accent={BIO.slate}
                />
                <KpiCard
                  label="Flagged On Page"
                  value={flaggedOnPage}
                  sub="stolen / blocked / scrapped"
                  accent={flaggedOnPage > 0 ? BIO.red : BIO.green}
                  hint="Non-active statuses within the vehicles shown on this page only."
                />
              </KpiStrip>
            </div>
          )}

          {/* Results Table */}
          {vehicles.length > 0 ? (
            <div className="search-results">
              <table className="table">
                <thead>
                  <tr>
                    <th>Reg No</th>
                    <th>Vehicle</th>
                    <th>Year</th>
                    <th>Owner</th>
                    <th>Status</th>
                    <th>Registered</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.map((vehicle) => (
                    <tr key={vehicle._id}>
                      <td>
                        <strong>{vehicle.regNumber || "Not Assigned"}</strong>
                        <br />
                        <small style={{ color: "var(--color-text-muted)" }}>
                          {vehicle.chassisNumber}
                        </small>
                      </td>
                      <td>
                        {vehicle.make} {vehicle.model}
                        <br />
                        <small style={{ color: "var(--color-text-muted)" }}>
                          Engine: {vehicle.engineNumber.substring(0, 15)}...
                        </small>
                      </td>
                      <td>{vehicle.year}</td>
                      <td>
                        {vehicle.currentOwner ? (
                          <>
                            {vehicle.currentOwner.name}
                            <br />
                            <small style={{ color: "var(--color-text-muted)" }}>
                              {vehicle.currentOwner.phone ||
                                vehicle.currentOwner.email}
                            </small>
                          </>
                        ) : (
                          <span style={{ color: "var(--color-text-muted)" }}>
                            No Owner
                          </span>
                        )}
                      </td>
                      <td>
                        <StatusPill
                          status={vehicle.status}
                          label={vehicle.status.toUpperCase()}
                        />
                      </td>
                      <td>{formatDate(vehicle.createdAt)}</td>
                      <td>
                        <div className="action-buttons">
                          <button
                            className="btn btn-info"
                            onClick={() => navigate(`/rc-card/${vehicle._id}`)}
                            title="View RC Card"
                          >
                            RC
                          </button>
                          {vehicle.blockchainTxHash && (
                            <a
                              href={`https://amoy.polygonscan.com/tx/${vehicle.blockchainTxHash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-success"
                              title="View on Blockchain"
                            ></a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Pagination */}
              {pagination.totalPages > 1 && (
                <div className="pagination">
                  <button
                    className="btn btn-secondary"
                    onClick={() => handlePageChange(pagination.currentPage - 1)}
                    disabled={pagination.currentPage === 1 || loading}
                  >
                    Previous
                  </button>
                  <span className="pagination-info">
                    Page {pagination.currentPage} of {pagination.totalPages}
                  </span>
                  <button
                    className="btn btn-secondary"
                    onClick={() => handlePageChange(pagination.currentPage + 1)}
                    disabled={
                      pagination.currentPage === pagination.totalPages ||
                      loading
                    }
                  >
                    Next
                  </button>
                </div>
              )}
            </div>
          ) : hasSearched && !loading ? (
            <div className="no-results">
              <p>No vehicles found matching your criteria.</p>
              <p
                style={{ color: "var(--color-text-muted)", fontSize: "0.9rem" }}
              >
                Try adjusting your filters or search query.
              </p>
            </div>
          ) : null}
        </div>

        <footer className="dashboard-footer">
          <p>© 2026 BioChain RTO System • Digital India Initiative</p>
        </footer>
      </div>
    </DashboardLayout>
  );
}
