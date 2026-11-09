import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import api from "../services/api";
import { formatDateTime } from "../lib/display";
import { notify } from "../lib/notify";

// The landing page reports the registry as it stands, so the figures come from
// the same database the dashboards read. Nothing here is a fixed marketing number.
type RegistryPulse = {
  totalVehicles: number;
  onChainVehicles: number;
  totalOwners: number;
  pendingRequests: number;
  registrationsCompleted: number;
  transfersCompleted: number;
  theftCasesActive: number;
  vehiclesBlocked: number;
  chainNetwork: string;
  asOf: string;
};

// Feature icons as SVG components
const BiometricIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2a10 10 0 0 0-10 10c0 5.523 4.477 10 10 10s10-4.477 10-10A10 10 0 0 0 12 2z" />
    <path d="M12 6a6 6 0 0 0-6 6c0 3.314 2.686 6 6 6s6-2.686 6-6a6 6 0 0 0-6-6z" />
    <path d="M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
  </svg>
);

const BlockchainIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="2" y="2" width="8" height="8" rx="1" />
    <rect x="14" y="2" width="8" height="8" rx="1" />
    <rect x="2" y="14" width="8" height="8" rx="1" />
    <rect x="14" y="14" width="8" height="8" rx="1" />
    <path d="M10 6h4M6 10v4M18 10v4M10 18h4" />
  </svg>
);

const StorageIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const ContractIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="16" y1="13" x2="8" y2="13" />
    <line x1="16" y1="17" x2="8" y2="17" />
    <polyline points="10 9 9 9 8 9" />
  </svg>
);

const ShieldIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" />
  </svg>
);

const VerifyIcon = () => (
  <svg
    width="32"
    height="32"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <polyline points="9 12 12 15 16 10" />
  </svg>
);

// Transaction data (illustrative preview - real records live behind the
// role dashboards; fabricated tx hashes are never shown as on-chain proof)
const recentTransactions = [
  {
    regNumber: "MH-12-AB-4892",
    owner: "Rajesh Subramaniam",
    type: "New Reg",
    status: "Verified",
    time: "09:14 AM",
  },
  {
    regNumber: "KA-01-MX-7743",
    owner: "Arjun Venkatesh",
    type: "Transfer",
    status: "Verified",
    time: "08:52 AM",
  },
  {
    regNumber: "TN-09-BK-2201",
    owner: "Priya Rajan",
    type: "Inheritance",
    status: "Pending",
    time: "08:30 AM",
  },
  {
    regNumber: "DL-04-CZ-9910",
    owner: "Ramesh Gupta",
    type: "Stolen",
    status: "Blocked",
    time: "07:18 AM",
  },
  {
    regNumber: "GJ-05-XX-3310",
    owner: "Sunita Patel",
    type: "New Reg",
    status: "Verified",
    time: "06:55 AM",
  },
];

// The three certificate layouts the landing page can switch between. Same
// vehicle, three moments in its life - the plate never changes, the story does.
const RC_TABS = [
  {
    tabLabel: "NEW PURCHASE",
    badgeClass: "rc-badge-new",
    badgeText: "New Registration",
    ownerName: "Rajesh Subramaniam",
    scene: "First ownership • booked through a dealer • invoice attached",
  },
  {
    tabLabel: "SECOND-HAND",
    badgeClass: "rc-badge-resale",
    badgeText: "Second-Hand Sale",
    ownerName: "Arjun Venkatesh",
    scene: "Ownership transferred • consent captured from seller and buyer",
  },
  {
    tabLabel: "INHERITANCE",
    badgeClass: "rc-badge-inheritance",
    badgeText: "Inheritance",
    ownerName: "Priya Rajan",
    scene: "Transferred to the registered legal heir after document review",
  },
];

// Status badge component
const StatusBadge = ({ status }: { status: string }) => {
  const getStatusClass = () => {
    switch (status) {
      case "Verified":
        return "status-verified";
      case "Pending":
        return "status-pending";
      case "Blocked":
        return "status-blocked";
      case "Stolen":
        return "status-stolen";
      default:
        return "status-verified";
    }
  };

  return <span className={`status-pill ${getStatusClass()}`}>{status}</span>;
};

const TypeBadge = ({ type }: { type: string }) => {
  const getTypeClass = () => {
    switch (type) {
      case "New Reg":
        return "type-new";
      case "Transfer":
        return "type-transfer";
      case "Inheritance":
        return "type-inheritance";
      case "Stolen":
        return "type-stolen";
      default:
        return "type-new";
    }
  };

  return <span className={`type-pill ${getTypeClass()}`}>{type}</span>;
};

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rcTab, setRcTab] = useState(0);
  const rcSample = RC_TABS[rcTab];
  const [pulse, setPulse] = useState<RegistryPulse | null>(null);
  const [pulseError, setPulseError] = useState(false);
  const [animatedStats, setAnimatedStats] = useState({
    vehicles: 0,
    onChain: 0,
    owners: 0,
    transfers: 0,
  });

  // Aggregate counts only, from an endpoint that needs no sign-in.
  useEffect(() => {
    let cancelled = false;
    api
      .get("/analytics/registry-pulse")
      .then((res) => {
        if (!cancelled) setPulse(res.data as RegistryPulse);
      })
      .catch(() => {
        if (!cancelled) setPulseError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Count up to the live figures once they arrive.
  useEffect(() => {
    if (!pulse) return;
    const duration = 2000;
    const targets = {
      vehicles: pulse.totalVehicles,
      onChain: pulse.onChainVehicles,
      owners: pulse.totalOwners,
      transfers: pulse.transfersCompleted,
    };

    // Read the elapsed clock, not a tick count. A browser slows timers in a
    // background window, and a tick counter would leave these figures reading
    // zero on a page that is otherwise showing live counts.
    const startedAt = Date.now();
    const frame = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / duration);
      const easeOut = 1 - Math.pow(1 - progress, 3);

      setAnimatedStats({
        vehicles: Math.floor(targets.vehicles * easeOut),
        onChain: Math.floor(targets.onChain * easeOut),
        owners: Math.floor(targets.owners * easeOut),
        transfers: Math.floor(targets.transfers * easeOut),
      });

      if (progress >= 1) clearInterval(timer);
    };
    const timer = setInterval(frame, duration / 60);

    return () => clearInterval(timer);
  }, [pulse]);

  const formatNumber = (num: number) => num.toLocaleString("en-IN");

  return (
    <div className="home-page">
      {/* Navigation */}
      <nav className="home-nav">
        <div className="nav-brand">
          <span className="nav-logo">BIOCHAIN</span>
          <span className="nav-subtitle">RTO</span>
        </div>
        <div className={`nav-links${menuOpen ? " open" : ""}`}>
          <Link to="/" className="nav-link active">
            Home
          </Link>
          <Link to="/register" className="nav-link">
            Registration
          </Link>
          <Link to="/owner" className="nav-link">
            Transfer
          </Link>
          <Link to="/search" className="nav-link">
            Verify
          </Link>
          <Link to="/rto" className="nav-link">
            RTO Tools
          </Link>
          <Link to="/police" className="nav-link">
            Law Enforcement
          </Link>
        </div>
        <button
          type="button"
          className="nav-toggle"
          aria-label="Toggle navigation menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <Link to="/login" className="nav-login-btn">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
            <polyline points="10 17 15 12 10 7" />
            <line x1="15" y1="12" x2="3" y2="12" />
          </svg>
          Login
        </Link>
      </nav>

      {/* Hero Section */}
      <section className="hero-section">
        <div className="hero-badge">
          <span className="badge-dot"></span>
          BIOMETRIC CONSENT • SHA-256 RECORDS • POLYGON AMOY
        </div>
        <h1 className="hero-title">
          Secure Vehicle Lifecycle
          <br />
          on the <span className="highlight">Blockchain</span>
        </h1>
        <p className="hero-subtitle">
          A biometric-authenticated vehicle registration authority. Every
          registration, transfer and status change is hashed and stored in the
          registry, then committed to the Polygon Amoy test network as a public
          transaction wherever the gas fee can be paid — so each record can be
          re-checked independently, and records still awaiting a fee say so.
        </p>
        <div className="hero-actions">
          <Link to="/register" className="btn btn-primary btn-large">
            Register a Vehicle
          </Link>
          <Link to="/search" className="btn btn-outline btn-large">
            Verify on Chain
          </Link>
        </div>

        {/* Stats Row - live counts from this registry */}
        <div className="stats-row">
          <div className="stat-item">
            <div className="stat-value">
              {pulse ? formatNumber(animatedStats.vehicles) : "—"}
            </div>
            <div className="stat-label">VEHICLES IN THE REGISTRY</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {pulse ? formatNumber(animatedStats.onChain) : "—"}
            </div>
            <div className="stat-label">RECORDS COMMITTED ON-CHAIN</div>
            <div className="stat-sublabel">
              {pulse?.chainNetwork || "Polygon"}
            </div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {pulse ? formatNumber(animatedStats.owners) : "—"}
            </div>
            <div className="stat-label">REGISTERED OWNERS</div>
          </div>
          <div className="stat-item">
            <div className="stat-value">
              {pulse ? formatNumber(animatedStats.transfers) : "—"}
            </div>
            <div className="stat-label">TRANSFERS COMPLETED</div>
          </div>
        </div>
        {pulseError && (
          <p className="stats-note">
            Live registry figures are unavailable right now - the backend is not
            responding. No numbers are shown rather than placeholder ones.
          </p>
        )}
      </section>

      {/* RTO Operations Section */}
      <section className="operations-section">
        <div className="section-header">
          <h3 className="section-title">RTO OPERATIONS</h3>
          <Link to="/login" className="view-all-link">
            Sign in to Dashboard
          </Link>
        </div>
        <div className="stats-cards">
          <div className="stat-card">
            <div className="stat-card-value">
              {pulse ? formatNumber(pulse.registrationsCompleted) : "—"}
            </div>
            <div className="stat-card-label">New Registrations Approved</div>
            <div className="stat-card-trend">
              Issued with a registration number
            </div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">
              {pulse ? formatNumber(pulse.transfersCompleted) : "—"}
            </div>
            <div className="stat-card-label">Ownership Transfers</div>
            <div className="stat-card-trend">Finalised by an RTO officer</div>
          </div>
          <div className="stat-card warning">
            <div className="stat-card-value">
              {pulse ? formatNumber(pulse.pendingRequests) : "—"}
            </div>
            <div className="stat-card-label">Pending Approvals</div>
            <div className="stat-card-trend">Requires RTO action</div>
          </div>
          <div className="stat-card danger">
            <div className="stat-card-value">
              {pulse ? formatNumber(pulse.vehiclesBlocked) : "—"}
            </div>
            <div className="stat-card-label">
              Vehicles Blocked or Reported Stolen
            </div>
            <div className="stat-card-trend">
              {pulse
                ? `${pulse.theftCasesActive} theft report(s) under investigation`
                : "Theft reports under investigation"}
            </div>
          </div>
        </div>
        {pulse && (
          <p className="stats-note">
            Counts read live from the registry, as of{" "}
            {formatDateTime(pulse.asOf)}.
          </p>
        )}
      </section>

      {/* Recent Transactions */}
      <section className="transactions-section">
        <div className="section-header">
          <h3 className="section-title">
            RECENT TRANSACTIONS (SAMPLE PREVIEW)
          </h3>
          <Link to="/login" className="view-all-link">
            Sign in to see live records
          </Link>
        </div>
        <div className="transactions-table-wrapper">
          <table className="transactions-table">
            <thead>
              <tr>
                <th>REG. NUMBER</th>
                <th>OWNER</th>
                <th>TYPE</th>
                <th>STATUS</th>
                <th>TIME</th>
              </tr>
            </thead>
            <tbody>
              {recentTransactions.map((tx, index) => (
                <tr key={index}>
                  <td className="mono">{tx.regNumber}</td>
                  <td>{tx.owner}</td>
                  <td>
                    <TypeBadge type={tx.type} />
                  </td>
                  <td>
                    <StatusBadge status={tx.status} />
                  </td>
                  <td className="time">{tx.time}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* RC Certificate Preview */}
      <section className="certificate-section">
        <div className="section-header centered">
          <div className="section-tabs">
            {RC_TABS.map((tab, index) => (
              <button
                key={tab.tabLabel}
                type="button"
                className={`tab-btn${index === rcTab ? " active" : ""}`}
                onClick={() => setRcTab(index)}
              >
                {tab.tabLabel}
              </button>
            ))}
          </div>
        </div>
        <p className="rc-sample-note">
          Illustrative certificate layout. The plate, owner and dates below are
          a design sample - an issued certificate prints only what this registry
          actually holds for the vehicle.
        </p>
        <div className="certificate-preview">
          <div className="rc-certificate">
            {/* Certificate Header */}
            <div className="rc-header">
              <div className="rc-header-left">
                <div className="rc-emblem">IN</div>
                <div className="rc-header-text">
                  <span className="rc-gov-label">GOVERNMENT OF INDIA</span>
                  <span className="rc-ministry">
                    Ministry of Road Transport & Highways
                  </span>
                </div>
              </div>
              <div className="rc-header-right">
                <span className={rcSample.badgeClass}>
                  {rcSample.badgeText}
                </span>
              </div>
            </div>

            {/* Certificate Title */}
            <div className="rc-title-section">
              <div className="rc-title-left">
                <div className="rc-title-text">
                  <span className="rc-authority">Blockchain RTO Authority</span>
                  <h2 className="rc-title">Registration Certificate</h2>
                  <span className="rc-subtitle">{rcSample.scene}</span>
                </div>
              </div>
              <div className="rc-title-right">
                <span className="rc-status-active">Active</span>
                <span className="rc-validity">
                  Validity read from the record
                </span>
              </div>
            </div>

            {/* Registration Number */}
            <div className="rc-reg-section">
              <span className="rc-reg-label">REGN NO</span>
              <span className="rc-reg-number">MH-12-AB-4892</span>
            </div>

            {/* Details Grid */}
            <div className="rc-details-grid">
              <div className="rc-detail-item">
                <label>Owner Name</label>
                <span className="rc-detail-value">{rcSample.ownerName}</span>
              </div>
              <div className="rc-detail-item">
                <label>Aadhaar Number</label>
                <span className="rc-detail-value rc-mono">XXXX-XXXX-####</span>
              </div>
              <div className="rc-detail-item">
                <label>Registration Date</label>
                <span className="rc-detail-value">14 Mar 2025</span>
              </div>
              <div className="rc-detail-item">
                <label>Vehicle Class</label>
                <span className="rc-detail-value">Tata Nexon EV</span>
              </div>
              <div className="rc-detail-item">
                <label>Manufacturing Year</label>
                <span className="rc-detail-value">2025</span>
              </div>
              <div className="rc-detail-item">
                <label>Fuel Type</label>
                <span className="rc-detail-value">Electric</span>
              </div>
              <div className="rc-detail-item">
                <label>Chassis No</label>
                <span className="rc-detail-value rc-mono">
                  MAT6123EXFR2981234
                </span>
              </div>
              <div className="rc-detail-item">
                <label>Engine / Motor No</label>
                <span className="rc-detail-value rc-mono">EV-MX-0882741A</span>
              </div>
              <div className="rc-detail-item">
                <label>RTO Office</label>
                <span className="rc-detail-value">Pune West - MH-12</span>
              </div>
            </div>

            {/* Blockchain Section - an issued certificate prints the real
                hashes here; this layout shows where each one appears */}
            <div className="rc-blockchain-section">
              <h4 className="rc-blockchain-title">BLOCKCHAIN RECORD</h4>
              <div className="rc-blockchain-grid">
                <div className="rc-blockchain-item">
                  <label>Transaction Hash</label>
                  <div className="rc-hash">
                    <span className="rc-dot rc-dot-cyan"></span>
                    Printed once the record is committed on Polygon Amoy
                  </div>
                </div>
                <div className="rc-blockchain-item">
                  <label>Document Hash (SHA-256)</label>
                  <div className="rc-hash rc-hash-green">
                    <span className="rc-dot rc-dot-green"></span>
                    Computed when the RC or invoice is uploaded
                  </div>
                </div>
                <div className="rc-blockchain-item">
                  <label>Biometric Credential</label>
                  <div className="rc-hash rc-hash-purple">
                    <span className="rc-dot rc-dot-purple"></span>
                    Recorded at the owner's consent step
                  </div>
                </div>
              </div>
            </div>

            {/* Certificate Footer */}
            <div className="rc-footer">
              <div className="rc-footer-left">
                <div className="rc-qr-placeholder">
                  <svg width="60" height="60" viewBox="0 0 60 60">
                    <rect
                      x="5"
                      y="5"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="#1e5aa8"
                      strokeWidth="2"
                    />
                    <rect x="10" y="10" width="10" height="10" fill="#1e5aa8" />
                    <rect
                      x="35"
                      y="5"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="#1e5aa8"
                      strokeWidth="2"
                    />
                    <rect x="40" y="10" width="10" height="10" fill="#1e5aa8" />
                    <rect
                      x="5"
                      y="35"
                      width="20"
                      height="20"
                      fill="none"
                      stroke="#1e5aa8"
                      strokeWidth="2"
                    />
                    <rect x="10" y="40" width="10" height="10" fill="#1e5aa8" />
                    <rect x="35" y="35" width="5" height="5" fill="#1e5aa8" />
                    <rect x="45" y="35" width="5" height="5" fill="#1e5aa8" />
                    <rect x="35" y="45" width="5" height="5" fill="#1e5aa8" />
                    <rect x="50" y="40" width="5" height="10" fill="#1e5aa8" />
                  </svg>
                </div>
                <span className="rc-qr-label">
                  Issued certificates carry a scannable record summary
                </span>
              </div>
              <div className="rc-footer-center">
                <span className="rc-authenticated-text">
                  BIOMETRICALLY AUTHENTICATED BY
                </span>
                <span className="rc-officer-name">ANAND KUMAR</span>
                <span className="rc-officer-details">
                  RTO Officer • MH-12 Pune West
                </span>
                <span className="rc-officer-details">
                  Signing officer and employee ID are recorded on issue
                </span>
              </div>
              <div className="rc-footer-right">
                <div className="rc-seal">
                  <span className="rc-seal-text">RC</span>
                  <span className="rc-seal-subtext">SAMPLE</span>
                </div>
                <span className="rc-chain">POLYGON AMOY</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="features-section">
        <h3 className="section-title centered">PLATFORM FEATURES</h3>
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <BiometricIcon />
            </div>
            <h4>Biometric Consent at Every Step</h4>
            <p>
              Fingerprint templates are captured in the browser, reduced to a
              minutiae hash and compared against the enrolled template before a
              registration, transfer or theft report is accepted. The stored
              evidence is the hash and the match score, never the scan itself.
              Matching runs on a software harness in this build — no physical
              reader is attached.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <BlockchainIcon />
            </div>
            <h4>Ownership Records With a Public Hash</h4>
            <p>
              Each record is hashed with SHA-256 and saved in MongoDB, then
              committed to the Polygon Amoy test network as a transaction that
              carries that hash, so a public explorer shows exactly which
              promise the record makes. A commitment costs gas, so records whose
              fee cannot yet be paid stay marked pending instead of claiming a
              confirmation they do not have.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <StorageIcon />
            </div>
            <h4>Verified Document Store</h4>
            <p>
              Vehicle RCs, insurance, PUC and transfer forms are uploaded to
              this server's verified store, hashed with SHA-256, and the hash is
              what links the document to the registry record and the chain
              commitment. Pointing the same flow at an IPFS pinning service is a
              configuration change, not a code change.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <ContractIcon />
            </div>
            <h4>Transfers That Need Both Parties</h4>
            <p>
              Sale and inheritance transfers need the consent of both parties at
              the biometric step and an RTO officer's approval before the
              database ownership record changes. Unpaid challans and incomplete
              approval checklists block the finalisation.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <ShieldIcon />
            </div>
            <h4>Stolen Vehicle Reporting</h4>
            <p>
              A theft report moves the vehicle to a blocked lifecycle status in
              the registry at once, and verification lookups return that status
              to any officer or police user. The matching status-change
              commitment is attempted on the test network and stays pending
              until its fee is paid.
            </p>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <VerifyIcon />
            </div>
            <h4>Independent Verification</h4>
            <p>
              Signed-in RTO and police users can open any vehicle and see its
              lifecycle status, ownership history, document hashes and the
              transaction hash of its chain commitment, with a link straight to
              the public explorer entry.
            </p>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="home-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="footer-logo">
              <span className="rc-emblem">IN</span>
              <div>
                <span className="logo-text">BioChain RTO</span>
                <p className="logo-tagline">
                  A blockchain-backed vehicle registration authority. Hashed
                  records, biometric consent, commitments on the Polygon Amoy
                  test network.
                </p>
              </div>
            </div>
            <div className="footer-tech">
              <span className="tech-badge">
                <span className="tech-dot polygon"></span>
                Polygon Amoy Testnet
              </span>
              <span className="tech-badge">
                <span className="tech-dot ipfs"></span>
                SHA-256 Verified Store
              </span>
              <span className="tech-badge">
                <span className="tech-dot mongo"></span>
                MongoDB
              </span>
            </div>
          </div>

          <div className="footer-links">
            <div className="footer-column">
              <h5>SERVICES</h5>
              <ul>
                <li>
                  <Link to="/register">New Vehicle Registration</Link>
                </li>
                <li>
                  <Link to="/owner">Ownership Transfer</Link>
                </li>
                <li>
                  <Link to="/owner?tab=inheritance">
                    Inheritance Processing
                  </Link>
                </li>
                <li>
                  <Link to="/owner?tab=theft">Report Vehicle Theft</Link>
                </li>
                <li>
                  <Link to="/search">Verify Vehicle</Link>
                </li>
                <li>
                  <Link to="/documents">Document Records</Link>
                </li>
                <li>
                  <Link to="/analytics">Audit Trail</Link>
                </li>
              </ul>
            </div>
            <div className="footer-column">
              <h5>PORTALS</h5>
              <ul>
                <li>
                  <Link to="/login">Vehicle Owner Login</Link>
                </li>
                <li>
                  <Link to="/dealer">Dealer / Agent Portal</Link>
                </li>
                <li>
                  <Link to="/rto">RTO Officer Dashboard</Link>
                </li>
                <li>
                  <Link to="/police">Law Enforcement Access</Link>
                </li>
                <li>
                  <Link to="/workshop">Authorized Workshop Portal</Link>
                </li>
                <li>
                  <Link to="/investigations">Fraud Investigation Desk</Link>
                </li>
              </ul>
            </div>
            <div className="footer-column">
              <h5>CONTACT & SUPPORT</h5>
              <div className="contact-item">
                <strong>HEADQUARTERS</strong>
                <p>
                  Ministry of Road Transport & Highways
                  <br />
                  Transport Bhavan, New Delhi — 110001
                </p>
              </div>
              <div className="contact-item">
                <strong>HELPLINE</strong>
                <p>
                  Toll Free: 1800 110 001
                  <br />
                  Mon - Sat: 9AM - 6PM IST
                </p>
              </div>
              <div className="contact-item">
                <strong>EMAIL SUPPORT</strong>
                <p>support@biochain-rto.gov.in</p>
              </div>
              <div className="contact-item">
                <strong>BLOCKCHAIN EXPLORER</strong>
                <p>
                  <a
                    href="https://amoy.polygonscan.com/address/0x21F940c10FE9AbEA9eD67CE5689FBCa447701966"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    VehicleRegistry contract on Polygon Amoy
                  </a>
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-legal">
            <p>
              © 2026 BioChain RTO Authority • Ministry of Road Transport &
              Highways, Government of India
            </p>
            <p>
              Vehicle records are kept in the registry and hashed with SHA-256.
              Ownership events are committed as transactions on the Polygon Amoy
              test network whenever the gas fee can be paid; the rest are shown
              as pending rather than claimed as final.
            </p>
          </div>
          <div className="footer-legal-links">
            {/* A prototype console has no published policy documents. Leaving the
                links inert invites a click that goes nowhere, so each one answers
                honestly instead. */}
            {[
              {
                label: "Privacy Policy",
                note: "Prototype disclosure: identity numbers are masked before they reach this screen, and biometric scans never leave the browser as an image - only a template reference is stored.",
              },
              {
                label: "Terms of Use",
                note: "Prototype disclosure: this is an academic demonstration registry. No registration issued here is valid with any real transport authority.",
              },
              {
                label: "Blockchain Notice",
                note: "Records are anchored on the Polygon Amoy test network. Anchoring costs gas, so a record whose fee cannot yet be paid is marked pending instead of claiming a transaction that does not exist.",
              },
              {
                label: "RTI",
                note: "Prototype disclosure: no public-records request desk is attached to this demonstration system.",
              },
              {
                label: "Sitemap",
                note: "Use the navigation bar: Home, Registration, Transfer, Verify, RTO Tools, Law Enforcement and Login.",
              },
            ].map((item) => (
              <span
                key={item.label}
                role="link"
                tabIndex={0}
                title={item.note}
                onClick={() => notify(item.note, "info")}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    notify(item.note, "info");
                  }
                }}
                style={{ cursor: "pointer", textDecoration: "underline" }}
              >
                {item.label}
              </span>
            ))}
          </div>
        </div>
      </footer>
    </div>
  );
}
