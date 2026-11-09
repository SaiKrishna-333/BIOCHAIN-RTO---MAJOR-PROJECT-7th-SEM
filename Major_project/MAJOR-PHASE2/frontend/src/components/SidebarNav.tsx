// SidebarNav.tsx
// Fixed 220px left-side navigation panel shared by every role dashboard.
// Lists ALL features a role can access as a top-to-bottom vertical menu,
// including in-dashboard sections (via ?tab= query + activeSection prop).
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/useAuth";

interface NavItem {
  path: string;
  label: string;
  /** In-dashboard section this item activates (URL becomes ?tab=<tab>) */
  tab?: string;
}

const ROLE_NAV: Record<string, NavItem[]> = {
  owner: [
    { path: "/owner", label: "My Vehicles" },
    { path: "/owner", label: "Vehicle Reports", tab: "reports" },
    { path: "/owner", label: "Report Accident", tab: "accident" },
    { path: "/damage", label: "3D Damage & Repair" },
    { path: "/owner", label: "Resale Offers", tab: "offers" },
    { path: "/transfer-approvals", label: "Transfers" },
    { path: "/migration", label: "Smart Migration" },
    { path: "/patent-features", label: "Patent Engines" },
    { path: "/documents", label: "Documents" },
    { path: "/owner-profile", label: "Profile & ID Card" },
  ],
  dealer: [
    { path: "/dealer", label: "Dashboard" },
    { path: "/patent-features", label: "Patent Engines" },
    { path: "/documents", label: "Documents" },
    { path: "/dealer-profile", label: "Profile & ID Card" },
  ],
  workshop: [
    { path: "/workshop", label: "My Vehicles" },
    { path: "/workshop", label: "Incoming Requests", tab: "requests" },
    { path: "/damage", label: "3D Damage & Repair" },
    { path: "/workshop", label: "Digital ID Card", tab: "card" },
    { path: "/transfer-approvals", label: "Transfers" },
    { path: "/patent-features", label: "Patent Engines" },
  ],
  rto: [
    { path: "/rto", label: "Dashboard" },
    { path: "/rto", label: "Accident Uploads", tab: "accidents" },
    { path: "/search", label: "Search" },
    { path: "/analytics", label: "Analytics" },
    { path: "/investigations", label: "Fraud Cases" },
    { path: "/forensics", label: "Vehicle Forensics" },
    { path: "/damage", label: "3D Damage & Repair" },
    { path: "/transfer-approvals", label: "Transfers" },
    { path: "/migration", label: "Smart Migration" },
    { path: "/patent-features", label: "Patent Engines" },
    { path: "/documents", label: "Documents" },
    { path: "/rto-profile", label: "Profile & ID Card" },
  ],
  police: [
    { path: "/police", label: "Dashboard" },
    { path: "/police", label: "Accident Uploads", tab: "accidents" },
    { path: "/search", label: "Search" },
    { path: "/analytics", label: "Analytics" },
    { path: "/investigations", label: "Fraud Cases" },
    { path: "/forensics", label: "Vehicle Forensics" },
    { path: "/damage", label: "3D Damage & Repair" },
    { path: "/patent-features", label: "Patent Engines" },
    { path: "/documents", label: "Documents" },
    { path: "/police-profile", label: "Profile & ID Card" },
  ],
  admin: [
    { path: "/search", label: "Search" },
    { path: "/analytics", label: "Analytics" },
    { path: "/investigations", label: "Fraud Cases" },
    { path: "/forensics", label: "Vehicle Forensics" },
    { path: "/damage", label: "3D Damage & Repair" },
    { path: "/transfer-approvals", label: "Transfers" },
    { path: "/migration", label: "Smart Migration" },
    { path: "/patent-features", label: "Patent Engines" },
  ],
};

interface Props {
  /** Current in-dashboard section (e.g. "reports", "requests") for highlighting */
  activeSection?: string;
  /** Mobile off-canvas drawer state */
  open?: boolean;
  /** Close the mobile drawer (after a nav selection) */
  onClose?: () => void;
}

export default function SidebarNav({
  activeSection,
  open = false,
  onClose,
}: Props) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (!user) return null;

  const items = ROLE_NAV[user.role] || [];

  const isItemActive = (item: NavItem) => {
    if (location.pathname !== item.path) return false;
    if (item.tab) return activeSection === item.tab;
    // Default item on a dashboard path is active only when no tabbed
    // sibling claims the current section.
    return !items.some(
      (o) => o.path === item.path && o.tab && o.tab === activeSection,
    );
  };

  const handleClick = (item: NavItem) => {
    navigate(item.tab ? `${item.path}?tab=${item.tab}` : item.path);
    onClose?.();
  };

  return (
    <nav className={`sidebar-nav${open ? " open" : ""}`}>
      <div className="sidebar-brand">
        <p className="brand-title">BioChain RTO</p>
        <div className="sidebar-tricolor">
          <span />
          <span />
          <span />
        </div>
        <p className="brand-sub">{user.role} portal</p>
      </div>

      <p className="sidebar-role">Navigation</p>

      <div className="sidebar-links">
        {items.map((item) => (
          <button
            key={item.tab ? `${item.path}?tab=${item.tab}` : item.path}
            className={`nav-item ${isItemActive(item) ? "active" : ""}`}
            onClick={() => handleClick(item)}
          >
            <span>{item.label}</span>
          </button>
        ))}
      </div>

      <div className="sidebar-footer">
        <span className="sidebar-user">{user.name}</span>
        <button
          className="sidebar-logout"
          onClick={() => {
            logout();
            navigate("/");
          }}
        >
          Logout
        </button>
      </div>
    </nav>
  );
}
