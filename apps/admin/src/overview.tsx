import { Activity, ArrowDownLeft, ArrowUpRight, Clock3, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { useData } from "./api";
import { PendingList } from "./approvals";
import { Button, Empty, ErrorBox, PageHeading, Skeleton } from "./components";
import type { Overview as OverviewData } from "./types";
export function Overview() {
  const { t, i18n } = useTranslation();
  const [range, setRange] = useState("24h");
  const query = useData<OverviewData>(`overview?range=${range}`);
  const data = query.data;
  const max = Math.max(1, ...(data?.series.map((s) => s.allowed + s.denied) ?? []));
  return (
    <>
      <PageHeading title={t("overview")} description={t("overviewDesc")}>
        <span className="live">
          <i />
          {t("live")}
        </span>
      </PageHeading>
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : (
        data && (
          <>
            <div className="stats">
              {(
                [
                  ["requests24", data.stats.requests, Activity],
                  ["denied24", data.stats.denied, ArrowDownLeft],
                  ["pendingNow", data.stats.pending, Clock3],
                  ["activeGrants", data.stats.grants, ShieldCheck],
                ] as const
              ).map(([label, value, Icon]) => (
                <div className={`stat ${label === "pendingNow" ? "attention" : ""}`} key={label}>
                  <div>
                    <span>{t(label)}</span>
                    <Icon size={17} />
                  </div>
                  <strong>{value.toLocaleString(i18n.language)}</strong>
                  <small>
                    {label === "pendingNow"
                      ? t("needsYou")
                      : label === "activeGrants"
                        ? t("active")
                        : t("today")}
                  </small>
                </div>
              ))}
            </div>
            <section className="panel chart-panel">
              <div className="section-head">
                <div>
                  <h2>{t("traffic")}</h2>
                  <div className="chart-legend">
                    <span>
                      <i className="allow-dot" />
                      {t("allowed")}
                    </span>
                    <span>
                      <i className="deny-dot" />
                      {t("denied")}
                    </span>
                  </div>
                </div>
                <div className="segmented">
                  {["24h", "7d"].map((r) => (
                    <Button
                      className={range === r ? "selected" : ""}
                      key={r}
                      onClick={() => setRange(r)}
                    >
                      {r}
                    </Button>
                  ))}
                </div>
              </div>
              <div
                className="chart"
                role="img"
                aria-label={`${t("traffic")}: ${data.series.reduce((a, s) => a + s.allowed + s.denied, 0)} ${t("requests")}`}
              >
                <div className="chart-y">
                  <span>{max}</span>
                  <span>{Math.round(max / 2)}</span>
                  <span>0</span>
                </div>
                <svg viewBox="0 0 960 180" preserveAspectRatio="none" aria-hidden="true">
                  {[0, 80, 160].map((y) => (
                    <line
                      key={y}
                      x1="0"
                      x2="960"
                      y1={y + 8}
                      y2={y + 8}
                      stroke="var(--line)"
                      strokeDasharray="3 5"
                    />
                  ))}
                  {data.series.map((s, i) => {
                    const width = 960 / data.series.length;
                    const h = (s.allowed / max) * 145;
                    const d = (s.denied / max) * 145;
                    return (
                      <g key={s.ts}>
                        <title>{`${new Date(s.ts).toLocaleString(i18n.language)}: ${s.allowed} ${t("allowed")}, ${s.denied} ${t("denied")}`}</title>
                        <rect
                          x={i * width + width * 0.17}
                          y={168 - h}
                          width={width * 0.66}
                          height={h}
                          rx="3"
                          fill="var(--sage)"
                        />
                        <rect
                          x={i * width + width * 0.17}
                          y={168 - h - d}
                          width={width * 0.66}
                          height={d}
                          rx="2"
                          fill="var(--brass)"
                        />
                      </g>
                    );
                  })}
                </svg>
              </div>
              <div className="chart-labels">
                {data.series
                  .filter(
                    (_, i) =>
                      i % Math.ceil(data.series.length / 5) === 0 || i === data.series.length - 1,
                  )
                  .map((s) => (
                    <span key={s.ts}>
                      {new Date(s.ts).toLocaleString(
                        i18n.language,
                        range === "24h"
                          ? { hour: "2-digit", minute: "2-digit", hour12: false }
                          : { month: "short", day: "numeric" },
                      )}
                    </span>
                  ))}
              </div>
            </section>
            <section className="panel">
              <div className="section-head">
                <h2>
                  {t("needsYou")} <span className="count">{data.pending.length}</span>
                </h2>
                <Link to="/approvals" className="text-link">
                  {t("viewAll")}
                  <ArrowUpRight size={15} />
                </Link>
              </div>
              <PendingList items={data.pending.slice(0, 3)} />
            </section>
            <div className="split">
              {(
                [
                  ["topClients", data.clients],
                  ["topIps", data.ips],
                ] as const
              ).map(([label, items]) => (
                <section className="panel ranking" key={label}>
                  <div className="section-head">
                    <h2>{t(label)}</h2>
                    <span className="muted">{t("today")}</span>
                  </div>
                  {items.length ? (
                    items.map((item, i) => (
                      <div className="ranking-row" key={item.label}>
                        <span className="rank">{i + 1}</span>
                        <span className={label === "topIps" ? "mono" : ""}>{item.label}</span>
                        <div className="mini-meter">
                          <i style={{ width: `${(item.count / (items[0]?.count ?? 1)) * 100}%` }} />
                        </div>
                        <strong className="mono">{item.count}</strong>
                      </div>
                    ))
                  ) : (
                    <Empty />
                  )}
                </section>
              ))}
            </div>
          </>
        )
      )}
    </>
  );
}
