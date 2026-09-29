import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowUpRight, Search } from "lucide-react";
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
import {
  ClientBadge,
  ClientDetails,
  flag,
  IpBadge,
  IpDetails,
  networkLabel,
  ScopeChip,
  useLocation,
} from "./identity";
import { GrantForm } from "./manage";
import type { Audit, Resource } from "./types";

const decisions = [
  "allow_token",
  "allow_grant",
  "allow_allowlist",
  "allow_internal",
  "allow_public",
  "deny_pending",
  "deny_blocked",
  "deny_unknown",
  "not_found",
  "admin_api",
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
function DrawerOrigin({ row }: { row: Audit }) {
  const place = useLocation(row.ipInfo);
  const network = networkLabel(row.ipInfo);
  if (!row.ipInfo || (row.ipInfo.scope === "public" && !row.ipInfo.country)) return null;
  return (
    <p className="drawer-origin">
      {row.ipInfo.scope === "public" ? (
        <>
          {flag(row.ipInfo.country)} {place}
          {network && <span className="muted"> · {network}</span>}
        </>
      ) : (
        <ScopeChip info={row.ipInfo} />
      )}
    </p>
  );
}
export function RequestDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const query = useData<Audit>(`requests/${id}`);
  const [grant, setGrant] = useState(false);
  const always = useAction("allowlist", "POST", () => toast(t("alwaysSaved")));
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
            <DrawerOrigin row={row} />
            <code>{row.path}</code>
          </div>
          <dl className="detail-list">
            <div>
              <dt>{t("time")}</dt>
              <dd>
                <Timestamp value={row.ts} />
              </dd>
            </div>
            {[
              [t("requestId"), row.id],
              [t("status"), `${row.method} · ${row.status}`],
              [t("latency"), `${row.latencyMs} ms · ${row.bytes} B`],
              [t("source"), row.source],
              [t("matchedToken"), row.tokenId ?? "—"],
              [t("matchedGrant"), row.grantId ?? "—"],
              [
                t("matchedAllowlist"),
                row.allowlist
                  ? `${row.allowlist.label} · ${row.allowlist.value} · ${row.allowlist.id}`
                  : (row.allowlistId ?? "—"),
              ],
            ].map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <h3>{t("ipOrigin")}</h3>
          <IpDetails ip={row.ip} info={row.ipInfo} />
          <h3>{t("clientSection")}</h3>
          <ClientDetails client={row.client} ua={row.ua} />
          <h3>{t("headers")}</h3>
          <pre>{JSON.stringify(row.headers, null, 2)}</pre>
          <div className="actions request-actions">
            <Button
              disabled={always.isPending}
              onClick={() => always.mutate({ requestId: row.id })}
            >
              {t("alwaysAllowIp")}
            </Button>
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
          <ErrorBox error={always.error} />
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
    estimateSize: () => 56,
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
      <div className="toolbar filters">
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
        <section className="data-table audit-panel">
          <div className="thead audit-grid">
            {["time", "decision", "resource", "ip", "client", "status", "latency", "source"].map(
              (k) => (
                <span key={k}>{t(k === "ip" ? "colOrigin" : k)}</span>
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
                    className="tr audit-row audit-grid"
                    key={row.id}
                    style={{ transform: `translateY(${item.start}px)` }}
                    onClick={() => setSelected(row.id)}
                  >
                    <Timestamp value={row.ts} />
                    <Pill value={row.decision} />
                    <code className="cell-mono truncate">{row.resourceSlug ?? row.path}</code>
                    <IpBadge ip={row.ip} info={row.ipInfo} />
                    <ClientBadge client={row.client} fallback={row.clientFamily} />
                    <span className="cell-mono">{row.status}</span>
                    <span className="cell-mono muted num">{row.latencyMs} ms</span>
                    <span className="cell-mono muted">{row.source}</span>
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
                <IpBadge ip={row.ip} info={row.ipInfo} />
                <code>{row.resourceSlug ?? row.path}</code>
                <span className="audit-card-meta">
                  <ClientBadge client={row.client} fallback={row.clientFamily} />
                  <span className="muted">
                    {row.status} · {row.latencyMs} ms · {row.source}
                  </span>
                </span>
              </Button>
            ))}
          </div>
          <div className="pagination">
            <span className="muted">{t("requestsTotal", { count: query.data?.total ?? 0 })}</span>
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
              <span className="cell-mono page-number">{query.data?.page}</span>
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
