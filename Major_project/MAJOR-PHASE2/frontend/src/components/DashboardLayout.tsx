// DashboardLayout.tsx
// Shared page shell. On desktop the SidebarNav is a fixed left rail; on
// mobile it becomes an off-canvas drawer opened from a sticky top app-bar
// (hamburger). Every dashboard and feature page renders inside this layout
// so navigation is always available and the site behaves like an app on phones.
import { useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import SidebarNav from "./SidebarNav";
import NotificationBell from "./NotificationBell";

interface Props {
  /** Page heading shown above the content */
  title?: string;
  /** Sub-heading line (optional) */
  subtitle?: string;
  /** Current in-dashboard section for sidebar highlighting */
  activeSection?: string;
  children: ReactNode;
}

export default function DashboardLayout({
  title,
  subtitle,
  activeSection,
  children,
}: Props) {
  const [navOpen, setNavOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route or ?tab= changes.
  // Derived-state-during-render (no effect): reset on location change.
  const routeKey = location.pathname + location.search;
  const [lastRoute, setLastRoute] = useState(routeKey);
  if (lastRoute !== routeKey) {
    setLastRoute(routeKey);
    setNavOpen(false);
  }

  return (
    <>
      <SidebarNav
        activeSection={activeSection}
        open={navOpen}
        onClose={() => setNavOpen(false)}
      />

      {/* Sticky mobile app-bar — hidden on desktop via CSS */}
      <header className="mobile-appbar">
        <button
          type="button"
          className="menu-toggle"
          aria-label="Open navigation menu"
          aria-expanded={navOpen}
          onClick={() => setNavOpen((v) => !v)}
        >
          <span />
          <span />
          <span />
        </button>
        <span className="mobile-appbar-title">BioChain RTO</span>
      </header>

      {/* Dimmed backdrop behind an open drawer */}
      {navOpen && (
        <div
          className="nav-backdrop"
          onClick={() => setNavOpen(false)}
          aria-hidden="true"
        />
      )}

      <main className="dash-content">
        <div className="dash-header-row">
          <div>
            {title && <h2 className="dash-title">{title}</h2>}
            {subtitle && <p className="dash-subtitle">{subtitle}</p>}
          </div>
          <div className="dash-header-bell">
            <NotificationBell />
          </div>
        </div>
        {children}
      </main>
    </>
  );
}
