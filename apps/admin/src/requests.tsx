import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpRight, Monitor, Search } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";
import { useAction, useData } from "./api";
import {
  Button,
  Confirm,
  Empty,
  ErrorBox,
  Modal,
  PageHeading,
  Pill,
  Skeleton,
  Timestamp,
  useToast,
} from "./components";
import { GrantForm } from "./manage";
import type { Audit, Resource } from "./types";

const decisions = [
  "allow_token",
  "allow_grant",
  "allow_internal",
  "allow_public",
  "deny_pending",
  "deny_blocked",
  "deny_unknown",
  "not_found",
];
const families = [
  "clash-verge",
  "stash",
  "mihomo",
  "clashx",
  "clash",
  "surge",
  "shadowrocket",
  "quantumult-x",
  "loon",
  "sing-box",
  "v2rayn",
  "v2rayng",
  "surfboard",
  "curl",
  "wget",
  "python",
  "browser",
  "unknown",
];
export function RequestDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const query = useData<Audit>(`requests/${id}`);
  const [grant, setGrant] = useState(false);
  const block = useAction("blocks", "POST", () => toast(t("saved")));
  const row = query.data;
  return (
    <Modal title={t("details")} onClose={onClose} drawer>
      <ErrorBox error={query.error} />
      {row ? (
        <>
          <div className="drawer-summary">
            <Pill value={row.decision} />
            <h2 className="mono">{row.ip}</h2>
            <code>{row.path}</code>
          </div>
          <dl className="detail-list">
            {[
              [t("requestId"), row.id],
              [t("time"), new Date(row.ts).toISOString()],
              [t("client"), row.clientFamily],
              [t("status"), `${row.method} · ${row.status}`],
              [t("latency"), `${row.latencyMs} ms · ${row.bytes} B`],
              [t("source"), row.source],
              [t("matchedToken"), row.tokenId ?? "—"],
              [t("matchedGrant"), row.grantId ?? "—"],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>{t("userAgent")}</h3>
          <pre>{row.ua || "—"}</pre>
          <h3>{t("headers")}</h3>
          <pre>{JSON.stringify(row.headers, null, 2)}</pre>
          <div className="actions">
            <Button onClick={() => setGrant(true)}>
              {t("grantIp")}
              <ArrowUpRight size={14} />
            </Button>
            <Confirm
              label={t("block")}
              description={t("blockHelp")}
              onConfirm={() => block.mutate({ ip: row.ip, duration: 3600 })}
            />
          </div>
          <ErrorBox error={block.error} />
          {grant && <GrantForm ip={row.ip} onClose={() => setGrant(false)} />}
        </>
      ) : (
        <Skeleton />
      )}
    </Modal>
  );
}
export function Requests() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<string | null>(null);
  const parent = useRef<HTMLDivElement>(null);
  const query = useData<{ items: Audit[]; total: number; page: number; pageSize: number }>(
    `requests?${params.toString()}`,
  );
  const resources = useData<Resource[]>("resources");
  const rows = query.data?.items ?? [];
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => parent.current,
    estimateSize: () => 58,
    overscan: 8,
  });
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };
  return (
    <>
      <PageHeading title={t("requests")} description={t("requestsDesc")} />
      <div className="filters">
        <div className="search-input">
          <Search size={16} />
          <input
            aria-label={t("requestSearch")}
            placeholder={t("requestSearch")}
            value={params.get("q") ?? ""}
            onChange={(e) => filter("q", e.target.value)}
          />
        </div>
        <select
          aria-label={t("time")}
          value={
            params.get("from")
              ? Number(params.get("from")) > Date.now() - 2 * 86400000
                ? "24h"
                : "7d"
              : "all"
          }
          onChange={(e) =>
            filter(
              "from",
              e.target.value === "all"
                ? ""
                : String(Date.now() - (e.target.value === "24h" ? 1 : 7) * 86400000),
            )
          }
        >
          <option value="all">{t("allTime")}</option>
          <option value="24h">{t("today")}</option>
          <option value="7d">{t("week")}</option>
        </select>
        <select
          aria-label={t("decision")}
          value={params.get("decision") ?? ""}
          onChange={(e) => filter("decision", e.target.value)}
        >
          <option value="">{t("allDecisions")}</option>
          {decisions.map((d) => (
            <option key={d} value={d}>
              {t(d)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("client")}
          value={params.get("client") ?? ""}
          onChange={(e) => filter("client", e.target.value)}
        >
          <option value="">{t("allClients")}</option>
          {families.map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
        <select
          aria-label={t("resource")}
          value={params.get("resource") ?? ""}
          onChange={(e) => filter("resource", e.target.value)}
        >
          <option value="">{t("allResources")}</option>
          {resources.data?.map((r) => (
            <option key={r.id}>{r.slug}</option>
          ))}
        </select>
      </div>
      <ErrorBox error={query.error} retry={() => void query.refetch()} />
      {query.isPending ? (
        <Skeleton />
      ) : rows.length ? (
        <section className="panel audit-panel">
          <div className="audit-head audit-grid">
            {["time", "decision", "resource", "ip", "client", "status", "latency", "source"].map(
              (k) => (
                <span key={k}>{t(k)}</span>
              ),
            )}
          </div>
          <div className="audit-scroll" ref={parent}>
            <div className="virtual-body" style={{ height: virtual.getTotalSize() }}>
              {virtual.getVirtualItems().map((item) => {
                const row = rows[item.index];
                return row ? (
                  <button
                    type="button"
                    className="audit-row audit-grid"
                    key={row.id}
                    style={{ transform: `translateY(${item.start}px)` }}
                    onClick={() => setSelected(row.id)}
                  >
                    <Timestamp value={row.ts} />
                    <Pill value={row.decision} />
                    <code>{row.resourceSlug ?? row.path}</code>
                    <code>{row.ip}</code>
                    <span className="client-cell">
                      <Monitor size={13} />
                      {row.clientFamily}
                    </span>
                    <span className="mono">{row.status}</span>
                    <span className="mono muted">{row.latencyMs} ms</span>
                    <span className="muted">{row.source}</span>
                  </button>
                ) : null;
              })}
            </div>
          </div>
          <div className="audit-cards">
            {rows.map((row) => (
              <Button className="audit-card" key={row.id} onClick={() => setSelected(row.id)}>
                <div>
                  <Pill value={row.decision} />
                  <Timestamp value={row.ts} />
                </div>
                <strong className="mono">{row.ip}</strong>
                <code>{row.resourceSlug ?? row.path}</code>
                <span className="muted">
                  {row.clientFamily} · {row.status} · {row.latencyMs} ms · {row.source}
                </span>
              </Button>
            ))}
          </div>
          <div className="pagination">
            <span>
              {query.data?.total} {t("results")}
            </span>
            <div className="actions">
              <Button
                disabled={(query.data?.page ?? 1) <= 1}
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("page", String((query.data?.page ?? 1) - 1));
                  setParams(next);
                }}
              >
                {t("previous")}
              </Button>
              <span>{query.data?.page}</span>
              <Button
                disabled={
                  (query.data?.page ?? 1) * (query.data?.pageSize ?? 30) >= (query.data?.total ?? 0)
                }
                onClick={() => {
                  const next = new URLSearchParams(params);
                  next.set("page", String((query.data?.page ?? 1) + 1));
                  setParams(next);
                }}
              >
                {t("next")}
              </Button>
            </div>
          </div>
        </section>
      ) : (
        <Empty title={t("noMatch")}>
          <Button onClick={() => setParams({})}>{t("clearFilters")}</Button>
        </Empty>
      )}
      {selected && <RequestDrawer id={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
