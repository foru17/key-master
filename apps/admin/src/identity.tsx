import {
  Bot,
  CircleHelp,
  Cpu,
  Globe,
  Link2,
  type LucideIcon,
  Radar,
  Terminal,
  Waypoints,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { CopyButton } from "./components";
import type { ClientInfo, ClientKind, IpInfo } from "./types";

const kindIcons: Record<ClientKind, LucideIcon> = {
  proxy: Waypoints,
  browser: Globe,
  system: Cpu,
  tool: Terminal,
  preview: Link2,
  crawler: Bot,
  scanner: Radar,
  unknown: CircleHelp,
};

/** Regional-indicator flag for an ISO 3166-1 alpha-2 code; empty for anything else. */
export function flag(country: string | null | undefined): string {
  if (!country || !/^[A-Za-z]{2}$/.test(country)) return "";
  return String.fromCodePoint(
    ...[...country.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

const regionNames = new Map<string, Intl.DisplayNames | null>();
function localizedRegion(country: string, language: string): string | null {
  const locale = language.startsWith("zh") ? "zh-CN" : "en";
  if (!regionNames.has(locale)) {
    try {
      regionNames.set(locale, new Intl.DisplayNames([locale], { type: "region", style: "short" }));
    } catch {
      regionNames.set(locale, null);
    }
  }
  try {
    const name = regionNames.get(locale)?.of(country.toUpperCase());
    return name && name !== country.toUpperCase() ? name : null;
  } catch {
    return null;
  }
}

/** "🇭🇰 Hong Kong · Kowloon" — localized country name, falling back to the server's English name. */
export function useLocation(info: IpInfo | null | undefined): string {
  const { i18n } = useTranslation();
  if (!info?.country) return "";
  const country = localizedRegion(info.country, i18n.language) ?? info.countryName ?? info.country;
  const city =
    info.city && info.city !== info.countryName && info.city !== country ? info.city : null;
  return [country, city].filter(Boolean).join(" · ");
}

export function ScopeChip({ info }: { info: IpInfo | null | undefined }) {
  const { t } = useTranslation();
  if (!info || info.scope === "public") return null;
  return <span className={`scope-chip scope-${info.scope}`}>{t(`scope_${info.scope}`)}</span>;
}

/** Network owner line: "Example Mobile · AS64500". */
export function networkLabel(info: IpInfo | null | undefined): string {
  if (!info) return "";
  return [info.asName, info.asn].filter(Boolean).join(" · ");
}

/** Compact two-line cell for tables and cards: IP, then flag + place + network. */
export function IpBadge({ ip, info }: { ip: string; info: IpInfo | null | undefined }) {
  const { t } = useTranslation();
  const place = useLocation(info);
  const network = networkLabel(info);
  const described = info && info.scope !== "public";
  const unresolved = info && info.scope === "public" && info.source === "none";
  return (
    <span className="ip-badge">
      <code className="ip-address">{ip}</code>
      <span className="ip-meta">
        {info === undefined || unresolved ? null : info === null ? (
          <span className="faint">{t("ipLooking")}</span>
        ) : described ? (
          <ScopeChip info={info} />
        ) : (
          <>
            {flag(info.country) && (
              <span className="ip-flag" aria-hidden="true">
                {flag(info.country)}
              </span>
            )}
            <span className="ip-place">{place || t("unknownPlace")}</span>
            {network && <span className="ip-network">{network}</span>}
          </>
        )}
      </span>
    </span>
  );
}

/** Full breakdown for drawers and approval cards. */
export function IpDetails({ ip, info }: { ip: string; info: IpInfo | null | undefined }) {
  const { t } = useTranslation();
  const place = useLocation(info);
  if (!info || (info.scope === "public" && info.source === "none"))
    return <p className="muted ip-empty">{info === null ? t("ipLooking") : t("ipUnavailable")}</p>;
  const rows: [string, string, boolean?][] = [
    [t("ipAddress"), ip, true],
    [
      t("location"),
      info.scope === "public"
        ? [flag(info.country), place || t("unknownPlace")].filter(Boolean).join(" ")
        : t(`scope_${info.scope}`),
    ],
    [
      t("continent"),
      info.continent ? t(`continent_${info.continent}`, { defaultValue: info.continent }) : "—",
    ],
    [t("network"), info.asName ?? "—"],
    [t("asn"), info.asn ?? "—", true],
    [t("networkDomain"), info.asDomain ?? "—", true],
    [t("ipSource"), t(`ipSource_${info.source}`)],
  ];
  return (
    <dl className="detail-list compact">
      {rows.map(([label, value, mono]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd className={mono ? undefined : "text-value"}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ClientBadge({
  client,
  fallback,
}: {
  client: ClientInfo | null | undefined;
  fallback?: string | undefined;
}) {
  const { t } = useTranslation();
  const kind = client?.kind ?? "unknown";
  const Icon = kindIcons[kind];
  const label = client?.label || fallback || t("unknownClient");
  return (
    <span className={`client-badge kind-${kind}`} title={`${t(`kind_${kind}`)} · ${label}`}>
      <Icon size={13} aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

export function ClientDetails({
  client,
  ua,
}: {
  client: ClientInfo | null | undefined;
  ua: string;
}) {
  const { t } = useTranslation();
  // Darwin kernel versions are not marketing versions; keep them visibly apart.
  const os = client?.os
    ? client.osVersion?.startsWith("Darwin ")
      ? `${client.os} (${client.osVersion})`
      : [client.os, client.osVersion].filter(Boolean).join(" ")
    : null;
  const rows: [string, string, boolean?][] = [
    [t("clientKind"), t(`kind_${client?.kind ?? "unknown"}`)],
    [t("clientName"), client?.name || "—"],
    [t("version"), client?.version || "—", true],
    [t("operatingSystem"), os || "—"],
    [t("deviceModel"), client?.device || "—", true],
  ];
  return (
    <>
      <dl className="detail-list compact">
        {rows.map(([label, value, mono]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd className={mono ? undefined : "text-value"}>{value}</dd>
          </div>
        ))}
      </dl>
      <div className="raw-ua">
        <div className="raw-ua-head">
          <span>{t("userAgent")}</span>
          {ua && <CopyButton value={ua} />}
        </div>
        <pre>{ua || "—"}</pre>
      </div>
    </>
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function RelativeTime({ value }: { value: number | null | undefined }) {
  const { t, i18n } = useTranslation();
  if (!value) return <span className="faint">{t("noRequestsYet")}</span>;
  const seconds = Math.round((value - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const [amount, unit]: [number, Intl.RelativeTimeFormatUnit] =
    abs < 60
      ? [seconds, "second"]
      : abs < 3600
        ? [Math.round(seconds / 60), "minute"]
        : abs < 86400
          ? [Math.round(seconds / 3600), "hour"]
          : [Math.round(seconds / 86400), "day"];
  const iso = new Date(value).toISOString();
  return (
    <time dateTime={iso} title={iso}>
      {new Intl.RelativeTimeFormat(i18n.language.startsWith("zh") ? "zh-CN" : "en", {
        numeric: "auto",
      }).format(amount, unit)}
    </time>
  );
}
/** 600 → "10 min" / "10分钟"; picks the largest whole unit. 0 means "no duration" (device tokens). */
export function formatDuration(seconds: number, lang: string): string {
  if (!seconds) return "—";
  const units: [Intl.NumberFormatOptions["unit"], number][] = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
    ["second", 1],
  ];
  const [unit, size] = units.find(([, s]) => seconds % s === 0 && seconds >= s) ?? ["second", 1];
  return new Intl.NumberFormat(lang.startsWith("zh") ? "zh-CN" : "en", {
    style: "unit",
    unit,
    unitDisplay: "short",
  }).format(seconds / size);
}
