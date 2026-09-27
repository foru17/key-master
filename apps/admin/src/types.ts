export type Pending = {
  id: string;
  subject: string;
  requestId: string;
  slugs: string[];
  expiresAt: number;
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
  status: number;
  bytes: number;
  latencyMs: number;
  source: string;
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
};
export type Settings = {
  observe_mode: boolean;
  durations: { grant_default: number; options: [number, number]; block: number; pending: number };
  notice: { contact_text: string; contact_url: string; footer: string; not_found_body: string };
  telegram: { mode: string; connected: boolean; username: string | null; ownerChats: string[] };
  version: string;
};
export type Issued = { id: string; secret: string; urls: string[] };
export type Overview = {
  stats: { requests: number; denied: number; pending: number; grants: number };
  series: { ts: number; allowed: number; denied: number }[];
  pending: Pending[];
  clients: { label: string; count: number }[];
  ips: { label: string; count: number }[];
};
