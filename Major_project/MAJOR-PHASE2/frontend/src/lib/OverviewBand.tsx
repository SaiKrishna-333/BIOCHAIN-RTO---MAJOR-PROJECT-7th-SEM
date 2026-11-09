// OverviewBand.tsx
// A reusable premium "at a glance" band for role dashboards: a KPI card strip plus
// interactive donut and bar charts. Every value passed in must be computed by the
// caller from records the page already loaded - this component renders, it never
// invents numbers. Clicking a status wedge or a bar calls back so the page can
// filter its own list; charts always show real counts with a hover tooltip.
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { KpiCard, KpiStrip, SectionCard, StatusPill } from "./ui";
import { BIO } from "./ui-tokens";

export type BandKpi = {
  label: string;
  value: number | string;
  sub?: string;
  accent?: string;
  hint?: string;
  active?: boolean;
  onClick?: () => void;
};
export type BandSlice = {
  name: string;
  value: number;
  color?: string;
  key?: string;
};
export type BandBar = { label: string; value: number; key?: string };

export function OverviewBand({
  kpis,
  pie,
  pieTitle = "By status",
  bars,
  barsTitle = "By category",
  activeSliceKey,
  activeBarKey,
  onPieSelect,
  onBarSelect,
  filterLabel,
  onClearFilter,
  note,
}: {
  kpis: BandKpi[];
  pie?: BandSlice[];
  pieTitle?: string;
  bars?: BandBar[];
  barsTitle?: string;
  activeSliceKey?: string | null;
  activeBarKey?: string | null;
  onPieSelect?: (key: string) => void;
  onBarSelect?: (key: string) => void;
  filterLabel?: string | null;
  onClearFilter?: () => void;
  note?: string;
}) {
  const hasChart = (pie && pie.length) || (bars && bars.length);
  return (
    <div style={{ marginBottom: 18 }}>
      <KpiStrip>
        {kpis.map((k, i) => (
          <KpiCard
            key={i}
            label={k.label}
            value={k.value}
            sub={k.sub}
            accent={k.accent || BIO.blue}
            hint={k.hint}
            active={k.active}
            onClick={k.onClick}
          />
        ))}
      </KpiStrip>

      {hasChart ? (
        <SectionCard
          title="Dashboard analytics"
          subtitle={
            note ||
            "Aggregated live from the records currently loaded on this page. Click a wedge or a bar to filter the list below."
          }
          style={{ marginTop: 16 }}
        >
          {filterLabel ? (
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginBottom: 12,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: "0.82rem", color: BIO.slate }}>
                Filtered by:
              </span>
              <StatusPill status={filterLabel} label={filterLabel} />
              {onClearFilter ? (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={onClearFilter}
                >
                  Clear
                </button>
              ) : null}
            </div>
          ) : null}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(280px,1fr))",
              gap: 18,
            }}
          >
            {pie && pie.length ? (
              <div>
                <div
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: BIO.slate,
                    marginBottom: 6,
                  }}
                >
                  {pieTitle}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Tooltip />
                    <Pie
                      data={pie}
                      dataKey="value"
                      nameKey="name"
                      outerRadius={82}
                      innerRadius={46}
                      label={(e) =>
                        `${(e as unknown as { value?: number }).value ?? ""}`
                      }
                      onClick={(entry) => {
                        const x = entry as unknown as {
                          key?: string;
                          payload?: { key?: string };
                        };
                        const k = x.key ?? x.payload?.key;
                        if (k && onPieSelect) onPieSelect(k);
                      }}
                    >
                      {pie.map((s, i) => (
                        <Cell
                          key={i}
                          fill={s.color || BIO.blue}
                          cursor={onPieSelect ? "pointer" : "default"}
                          stroke={
                            activeSliceKey && activeSliceKey === s.key
                              ? BIO.ink
                              : "#fff"
                          }
                          strokeWidth={
                            activeSliceKey && activeSliceKey === s.key ? 2 : 1
                          }
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <div
                  style={{
                    display: "flex",
                    flexWrap: "wrap",
                    gap: 8,
                    marginTop: 6,
                  }}
                >
                  {pie.map((s, i) => (
                    <span
                      key={i}
                      style={{
                        fontSize: "0.72rem",
                        color: BIO.slate,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      <span
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: 2,
                          background: s.color || BIO.blue,
                          display: "inline-block",
                        }}
                      />
                      {s.name} ({s.value})
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {bars && bars.length ? (
              <div>
                <div
                  style={{
                    fontSize: "0.82rem",
                    fontWeight: 700,
                    color: BIO.slate,
                    marginBottom: 6,
                  }}
                >
                  {barsTitle}
                </div>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={bars}>
                    <CartesianGrid strokeDasharray="3 3" stroke={BIO.line} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 10 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis
                      allowDecimals={false}
                      tick={{ fontSize: 11 }}
                      width={28}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="value"
                      name="Count"
                      fill={BIO.violet}
                      radius={[3, 3, 0, 0]}
                      cursor={onBarSelect ? "pointer" : "default"}
                      onClick={(entry) => {
                        const k =
                          (
                            entry as unknown as {
                              key?: string;
                              payload?: { key?: string };
                            }
                          )?.key ??
                          (entry as unknown as { payload?: { key?: string } })
                            ?.payload?.key;
                        if (k && onBarSelect) onBarSelect(k);
                      }}
                    >
                      {bars.map((b, i) => (
                        <Cell
                          key={i}
                          fill={BIO.violet}
                          stroke={
                            activeBarKey && activeBarKey === b.key
                              ? BIO.ink
                              : "#fff"
                          }
                          strokeWidth={
                            activeBarKey && activeBarKey === b.key ? 2 : 1
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : null}
          </div>
        </SectionCard>
      ) : null}
    </div>
  );
}
