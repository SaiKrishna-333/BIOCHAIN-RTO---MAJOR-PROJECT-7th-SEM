// ui.tsx
// BioChain shared design system.
//
// The four industry-level consoles (Smart Migration, 3D Damage, Lifecycle
// Forensics, Identity & Fraud) must look and behave like ONE product, so every
// KPI strip, data table, chart frame, status pill and loading/empty/error state
// is defined once here and reused everywhere. Nothing in this file fetches data
// or knows about a specific module - it is pure presentation, driven by props,
// so the same component can render migrations, damage cases, investigations or
// alerts without change.
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
// Design tokens live in ui-tokens.ts so this file exports only components
// (react-refresh rule). Consumers import BIO / toneForStatus from ui-tokens.
import { BIO, toneForStatus } from "./ui-tokens";

// --- primitives --------------------------------------------------------------

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  style,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: BIO.white,
        border: `1px solid ${BIO.line}`,
        borderRadius: 14,
        padding: 18,
        boxShadow: "0 1px 3px rgba(20,40,80,0.06)",
        ...style,
      }}
    >
      {(title || actions) && (
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 12,
            marginBottom: subtitle ? 4 : 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ minWidth: 0 }}>
            {title && (
              <h3
                style={{
                  margin: 0,
                  color: BIO.ink,
                  fontSize: "1.05rem",
                  fontWeight: 700,
                }}
              >
                {title}
              </h3>
            )}
            {subtitle && (
              <p
                style={{
                  margin: "4px 0 12px",
                  color: BIO.slate,
                  fontSize: "0.85rem",
                }}
              >
                {subtitle}
              </p>
            )}
          </div>
          {actions && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  sub,
  accent = BIO.blue,
  hint,
  onClick,
  active,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  accent?: string;
  hint?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <div
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onClick();
              }
            }
          : undefined
      }
      title={hint}
      style={{
        background: BIO.white,
        border: `1px solid ${active ? accent : BIO.line}`,
        borderLeft: `4px solid ${accent}`,
        borderRadius: 12,
        padding: "14px 16px",
        boxShadow: active
          ? `0 0 0 2px ${accent}22`
          : "0 1px 3px rgba(20,40,80,0.06)",
        cursor: onClick ? "pointer" : "default",
        transition: "box-shadow .15s, border-color .15s",
        minWidth: 0,
      }}
    >
      <div
        style={{
          fontSize: "0.72rem",
          letterSpacing: 0.4,
          textTransform: "uppercase",
          color: BIO.slate,
          fontWeight: 700,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: "1.7rem",
          fontWeight: 800,
          color: BIO.ink,
          lineHeight: 1.15,
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: "0.8rem", color: BIO.slate, marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

export function KpiStrip({
  children,
  min = 180,
}: {
  children: ReactNode;
  min?: number;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
        gap: 12,
      }}
    >
      {children}
    </div>
  );
}

export function StatusPill({
  status,
  label,
}: {
  status?: string | null;
  label?: string;
}) {
  const tone = toneForStatus(status);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        background: `${tone}18`,
        color: tone,
        border: `1px solid ${tone}55`,
        borderRadius: 999,
        padding: "2px 10px",
        fontSize: "0.76rem",
        fontWeight: 700,
        whiteSpace: "nowrap",
      }}
    >
      <span
        style={{ width: 7, height: 7, borderRadius: "50%", background: tone }}
      />
      {label ?? String(status ?? "—")}
    </span>
  );
}

// --- state placeholders (spec: loading / empty / success / error) ------------

export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          style={{
            height: 16,
            borderRadius: 8,
            background:
              "linear-gradient(90deg,#eef2f7 25%,#e2e8f1 37%,#eef2f7 63%)",
            backgroundSize: "400% 100%",
            animation: "biochain-shimmer 1.2s ease-in-out infinite",
          }}
        />
      ))}
      <style>
        {
          "@keyframes biochain-shimmer{0%{background-position:100% 0}100%{background-position:0 0}}"
        }
      </style>
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      style={{
        padding: 20,
        color: BIO.slate,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          width: 16,
          height: 16,
          borderRadius: "50%",
          border: `2px solid ${BIO.line}`,
          borderTopColor: BIO.blue,
          display: "inline-block",
          animation: "biochain-spin .8s linear infinite",
        }}
      />
      {label}
      <style>{"@keyframes biochain-spin{to{transform:rotate(360deg)}}"}</style>
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon = "🗂️",
}: {
  title: string;
  hint?: string;
  icon?: string;
}) {
  return (
    <div
      style={{ padding: "32px 20px", textAlign: "center", color: BIO.slate }}
    >
      <div style={{ fontSize: "2rem", marginBottom: 6 }}>{icon}</div>
      <div style={{ fontWeight: 700, color: BIO.ink }}>{title}</div>
      {hint && <div style={{ fontSize: "0.85rem", marginTop: 4 }}>{hint}</div>}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      style={{
        padding: 16,
        borderRadius: 10,
        background: `${BIO.red}0f`,
        border: `1px solid ${BIO.red}44`,
        color: BIO.red,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        flexWrap: "wrap",
      }}
    >
      <span>{message}</span>
      {onRetry && (
        <button
          className="btn btn-sm btn-outline-primary"
          onClick={onRetry}
          style={{ color: BIO.red, borderColor: BIO.red }}
        >
          Retry
        </button>
      )}
    </div>
  );
}

// --- generic data table ------------------------------------------------------

export type Column<T> = {
  key: string;
  header: string;
  align?: "left" | "right" | "center";
  width?: number | string;
  // Text used for search + sorting. Falls back to the raw field with this key.
  value?: (row: T) => string | number | null | undefined;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
};

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  pageSize = 10,
  searchable = true,
  searchPlaceholder = "Search…",
  onRowClick,
  toolbar,
  emptyTitle = "No records",
  emptyHint,
  loading,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  searchable?: boolean;
  searchPlaceholder?: string;
  onRowClick?: (row: T) => void;
  toolbar?: ReactNode;
  emptyTitle?: string;
  emptyHint?: string;
  loading?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(0);

  const cellValue = (row: T, col: Column<T>): string | number => {
    const raw = col.value
      ? col.value(row)
      : (row as Record<string, unknown>)[col.key];
    if (raw == null) return "";
    return typeof raw === "number" ? raw : String(raw);
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let out = rows;
    if (q) {
      out = rows.filter((row) =>
        columns.some((c) =>
          String(cellValue(row, c)).toLowerCase().includes(q),
        ),
      );
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      if (col) {
        out = [...out].sort((a, b) => {
          const av = cellValue(a, col);
          const bv = cellValue(b, col);
          const cmp =
            typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av).localeCompare(String(bv));
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, columns, query, sortKey, sortDir]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const view = filtered.slice(
    safePage * pageSize,
    safePage * pageSize + pageSize,
  );

  const toggleSort = (col: Column<T>) => {
    if (col.sortable === false) return;
    if (sortKey === col.key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(col.key);
      setSortDir("asc");
    }
  };

  return (
    <div>
      {(searchable || toolbar) && (
        <div
          style={{
            display: "flex",
            gap: 10,
            alignItems: "center",
            marginBottom: 12,
            flexWrap: "wrap",
          }}
        >
          {searchable && (
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder={searchPlaceholder}
              style={{
                flex: "1 1 220px",
                minWidth: 180,
                padding: "8px 12px",
                borderRadius: 8,
                border: `1px solid ${BIO.line}`,
                fontSize: "0.9rem",
              }}
            />
          )}
          {toolbar}
          <span
            style={{ color: BIO.slate, fontSize: "0.8rem", marginLeft: "auto" }}
          >
            {filtered.length.toLocaleString("en-IN")} row
            {filtered.length === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {loading ? (
        <Skeleton rows={4} />
      ) : filtered.length === 0 ? (
        <EmptyState title={emptyTitle} hint={emptyHint} />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.88rem",
            }}
          >
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={c.key}
                    onClick={() => toggleSort(c)}
                    style={{
                      textAlign: c.align ?? "left",
                      width: c.width,
                      padding: "10px 12px",
                      color: BIO.slate,
                      fontWeight: 700,
                      fontSize: "0.74rem",
                      textTransform: "uppercase",
                      letterSpacing: 0.4,
                      borderBottom: `2px solid ${BIO.line}`,
                      cursor: c.sortable === false ? "default" : "pointer",
                      whiteSpace: "nowrap",
                      userSelect: "none",
                    }}
                  >
                    {c.header}
                    {sortKey === c.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  style={{
                    cursor: onRowClick ? "pointer" : "default",
                    borderBottom: `1px solid ${BIO.line}`,
                  }}
                  onMouseEnter={(e) => {
                    if (onRowClick) e.currentTarget.style.background = BIO.bg;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      style={{
                        padding: "10px 12px",
                        textAlign: c.align ?? "left",
                        color: BIO.ink,
                        verticalAlign: "middle",
                      }}
                    >
                      {c.render ? c.render(row) : cellValue(row, c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {filtered.length > pageSize && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginTop: 12,
            justifyContent: "flex-end",
          }}
        >
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={safePage === 0}
          >
            ‹ Prev
          </button>
          <span style={{ color: BIO.slate, fontSize: "0.82rem" }}>
            Page {safePage + 1} of {pageCount}
          </span>
          <button
            className="btn btn-sm btn-secondary"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next ›
          </button>
        </div>
      )}
    </div>
  );
}

// --- label/value rows for the workspace panels -------------------------------

export function FieldRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
        borderBottom: `1px dashed ${BIO.line}`,
      }}
    >
      <span style={{ color: BIO.slate, fontSize: "0.82rem", fontWeight: 600 }}>
        {label}
      </span>
      <span
        style={{
          color: BIO.ink,
          fontSize: "0.86rem",
          fontWeight: 600,
          textAlign: "right",
          fontFamily: mono
            ? "ui-monospace, SFMono-Regular, Menlo, monospace"
            : undefined,
          wordBreak: "break-word",
        }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

// A small square swatch + caption, used to key the 3D damage colours and charts.
export function LegendSwatch({
  color,
  label,
}: {
  color: string;
  label: string;
}) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: "0.8rem",
        color: BIO.slate,
      }}
    >
      <span
        style={{
          width: 12,
          height: 12,
          borderRadius: 3,
          background: color,
          display: "inline-block",
        }}
      />
      {label}
    </span>
  );
}
