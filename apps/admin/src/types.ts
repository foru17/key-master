export type IpScope =
  | "public"
  | "private"
  | "loopback"
  | "cgnat"
  | "link_local"
  | "reserved"
  | "invalid";
export type IpInfo = {
  ip: string;
  scope: IpScope;
  country: string | null;
  countryName: string | null;
  city: string | null;
  continent: string | null;
  asn: string | null;
  asName: string | null;
  asDomain: string | null;
  source: "online" | "mmdb" | "none";
};
export type ClientKind =
  | "proxy"
  | "browser"
  | "system"
  | "tool"
  | "preview"
  | "crawler"
  | "scanner"
  | "unknown";
export type ClientInfo = {
  kind: ClientKind;
  name: string;
  version: string | null;
  os: string | null;
  osVersion: string | null;
  device: string | null;
  label: string;
};
export type Pending = {
  id: string;
  subject: string;
  requestId: string;
  slugs: string[];
  expiresAt: number;
  ipInfo?: IpInfo | null;
  client?: ClientInfo | null;
};
export type Audit = {
  id: string;
  ts: number;
  ip: string;
  ua: string;
  headers: Record<string, string>;
  clientFamily: string;
  method: string;
  path: string;
  resourceSlug: string | null;
  decision: string;
  tokenId: string | null;
  grantId: string | null;
  allowlistId: string | null;
  allowlist?: AllowlistEntry | null;
  status: number;
  bytes: number;
  latencyMs: number;
  source: string;
  ipInfo?: IpInfo | null;
  client?: ClientInfo;
};
export type Grant = {
  id: string;
  subjectKind: "ip" | "ip_client";
  subject: string;
  scope: string[];
  grantedBy: string;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
  ipInfo?: IpInfo | null;
};
export type Token = {
  id: string;
  label: string;
  kind: "machine" | "device";
  scope: string[];
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  usage: { day: number; count: number }[];
};
export type Resource = {
  id: string;
  slug: string;
  kind: "file" | "inline" | "upstream";
  source: string;
  contentType: string;
  policy: "approval" | "token_only" | "public";
  enabled: boolean;
  size: number;
  hash: string;
  requests24h?: number;
  denied24h?: number;
  lastRequestAt?: number | null;
};
export type Settings = {
  observe_mode: boolean;
  durations: { grant_default: number; options: [number, number]; block: number; pending: number };
  notice: {
    timezone: string;
    contact_text: string;
    contact_url: string;
    footer: string;
    not_found_body: string;
  };
  telegram: { mode: string; connected: boolean; username: string | null; ownerChats: string[] };
  version: string;
};
export type Issued = { id: string; secret: string; urls: string[] };
export type Overview = {
  stats: { requests: number; denied: number; pending: number; grants: number };
  series: { ts: number; allowed: number; denied: number }[];
  pending: Pending[];
  clients: { label: string; count: number }[];
  ips: { label: string; count: number; ipInfo?: IpInfo | null }[];
};

export type AllowlistEntry = {
  id: string;
  label: string;
  value: string;
  kind: "ip" | "cidr" | "host";
  scope: string[];
  source: "config" | "telegram" | "admin" | "command";
  resolved: string[];
  resolvedAt: number | null;
  lastMatchedAt: number | null;
  revokedAt: number | null;
};
