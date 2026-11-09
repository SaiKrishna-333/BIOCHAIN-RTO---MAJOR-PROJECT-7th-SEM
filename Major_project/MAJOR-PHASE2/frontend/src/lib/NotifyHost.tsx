// NotifyHost.tsx - renders the notice stack produced by lib/notify.
// Mounted once, at the application root.

import { useEffect, useState } from "react";
import { dismissNotice, subscribeNotices, TONE, type Notice } from "./notify";

export default function NotifyHost() {
  const [notices, setNotices] = useState<Notice[]>([]);

  useEffect(() => subscribeNotices(setNotices), []);

  if (!notices.length) return null;

  return (
    <div
      aria-live="polite"
      style={{
        position: "fixed",
        right: "1rem",
        bottom: "1rem",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        maxWidth: "min(420px, calc(100vw - 2rem))",
      }}
    >
      {notices.map((n) => {
        const tone = TONE[n.kind];
        return (
          <div
            key={n.id}
            style={{
              display: "flex",
              alignItems: "stretch",
              background: "#fff",
              border: `1px solid ${tone.border}`,
              borderLeft: `5px solid ${tone.bar}`,
              borderRadius: "6px",
              boxShadow: "0 6px 18px rgba(15, 23, 42, 0.18)",
              overflow: "hidden",
            }}
          >
            <div style={{ padding: "0.7rem 0.85rem", flex: 1 }}>
              <div
                style={{
                  fontSize: "0.7rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  color: tone.border,
                  marginBottom: "0.2rem",
                }}
              >
                {tone.label}
              </div>
              <div
                style={{
                  fontSize: "0.92rem",
                  lineHeight: 1.4,
                  color: "#1f2937",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                }}
              >
                {n.message}
              </div>
            </div>
            <button
              type="button"
              onClick={() => dismissNotice(n.id)}
              aria-label="Dismiss message"
              style={{
                border: "none",
                background: "transparent",
                padding: "0 0.7rem",
                fontSize: "1.1rem",
                lineHeight: 1,
                color: "#6b7280",
                cursor: "pointer",
              }}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
