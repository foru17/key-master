import { createHash, timingSafeEqual } from "node:crypto";
import ipaddr from "ipaddr.js";

export const clientFamilies = [
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
] as const;
export type ClientFamily = (typeof clientFamilies)[number];
const clients: [ClientFamily, RegExp][] = [
  ["clash-verge", /clash[- ]verge/],
  ["stash", /stash/],
  ["mihomo", /mihomo|clash\.meta|clashmeta/],
  ["clashx", /clashx/],
  ["clash", /clash/],
  ["surge", /surge/],
  ["shadowrocket", /shadowrocket/],
  ["quantumult-x", /quantumult%20x|quantumult x/],
  ["loon", /loon/],
  ["sing-box", /sing-box|\bsfi\b|\bsfa\b|\bsfm\b/],
  ["v2rayng", /v2rayng/],
  ["v2rayn", /v2rayn/],
  ["surfboard", /surfboard/],
  ["curl", /curl/],
  ["wget", /wget/],
  ["python", /python/],
];
export function detectClient(ua: string, accept = ""): ClientFamily {
  const normalized = ua.toLowerCase();
  for (const [family, pattern] of clients) if (pattern.test(normalized)) return family;
  return normalized.includes("mozilla/") && accept.toLowerCase().includes("text/html")
    ? "browser"
    : "unknown";
}
export function hashToken(secret: string, pepper = ""): string {
  return createHash("sha256").update(pepper).update(secret).digest("hex");
}
export function tokenMatches(secret: string, hash: string, pepper = ""): boolean {
  const candidate = Buffer.from(hashToken(secret, pepper), "hex");
  const valid = /^[a-f0-9]{64}$/i.test(hash);
  const expected = valid ? Buffer.from(hash, "hex") : Buffer.alloc(32);
  return timingSafeEqual(candidate, expected) && valid;
}
export function normalizeIp(value: string): string | null {
  try {
    return ipaddr.process(value).toString();
  } catch {
    return null;
  }
}
export function inCidrs(ip: string, cidrs: readonly string[]): boolean {
  try {
    const address = ipaddr.process(ip);
    return cidrs.some((cidr) => {
      const [network, prefix] = ipaddr.parseCIDR(cidr);
      return address.kind() === network.kind() && address.match(network, prefix);
    });
  } catch {
    return false;
  }
}
export function validCidr(cidr: string): boolean {
  try {
    ipaddr.parseCIDR(cidr);
    return true;
  } catch {
    return false;
  }
}
export type Resource = {
  slug: string;
  enabled: boolean;
  policy: "public" | "token_only" | "approval";
};
export type Token = {
  id: string;
  secretHash: string;
  scope: string[];
  expiresAt: number | null;
  revokedAt: number | null;
};
export type Grant = {
  id: string;
  subjectKind: "ip" | "ip_client";
  subject: string;
  scope: string[];
  expiresAt: number;
  revokedAt: number | null;
};
export type Block = { subject: string; until: number };
export type DecisionName =
  | "not_found"
  | "allow_public"
  | "allow_token"
  | "allow_internal"
  | "deny_unknown"
  | "allow_grant"
  | "deny_blocked"
  | "deny_pending";
export type Decision = {
  decision: DecisionName;
  allowed: boolean;
  status: 200 | 403 | 404;
  notify: boolean;
  tokenId?: string;
  grantId?: string;
};
export type DecisionInput = {
  resource: Resource | null;
  ip: string;
  ua: string;
  accept?: string;
  queryToken?: string;
  now: number;
  tokens: Token[];
  grants: Grant[];
  blocks: Block[];
  internalCidrs: string[];
  pepper?: string;
  method?: string;
  range?: string;
  ifNoneMatch?: string;
};
export const covers = (scope: string[], slug: string): boolean =>
  scope.includes("*") || scope.includes(slug);
export function decide(input: DecisionInput): Decision {
  const { resource, ip, now } = input;
  const result = (decision: DecisionName): Decision => ({
    decision,
    allowed: decision.startsWith("allow_"),
    status: decision === "not_found" ? 404 : decision.startsWith("allow_") ? 200 : 403,
    notify: decision === "deny_pending",
  });
  if (!resource?.enabled) return result("not_found");
  if (resource.policy === "public") return result("allow_public");
  const token = input.queryToken
    ? input.tokens.find(
        (t) =>
          tokenMatches(input.queryToken ?? "", t.secretHash, input.pepper) &&
          !t.revokedAt &&
          (t.expiresAt === null || t.expiresAt > now) &&
          covers(t.scope, resource.slug),
      )
    : undefined;
  if (token) return { ...result("allow_token"), tokenId: token.id };
  if (inCidrs(ip, input.internalCidrs)) return result("allow_internal");
  if (resource.policy === "token_only") return result("deny_unknown");
  const subject = `${ip}|${detectClient(input.ua, input.accept)}`;
  const grant = input.grants.find(
    (g) =>
      g.revokedAt === null &&
      g.expiresAt > now &&
      g.subject === (g.subjectKind === "ip" ? ip : subject) &&
      covers(g.scope, resource.slug),
  );
  if (grant) return { ...result("allow_grant"), grantId: grant.id };
  if (input.blocks.some((b) => (b.subject === ip || b.subject === subject) && b.until > now))
    return result("deny_blocked");
  return result("deny_pending");
}
const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
const safeText = (value: string): string =>
  value.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/proxies:|server:|\[proxy\]/gi, "[redacted]");
export function deniedResponse(input: {
  family: ClientFamily;
  requestId: string;
  now: number;
  notFound?: boolean;
  notFoundBody?: string;
  acceptLanguage?: string;
  contactText?: string;
  contactUrl?: string;
  footer?: string;
}): Response {
  const headers = { "X-Request-Id": input.requestId, "Cache-Control": "no-store" };
  if (input.notFound)
    return new Response(input.notFoundBody ?? "404 Not Found\n", {
      status: 404,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  const zh =
    (input.acceptLanguage ?? "").split(",")[0]?.trim().toLowerCase().startsWith("zh") ?? false;
  const notice = zh ? "访问需要管理员批准" : "Access requires the administrator's approval";
  const contact = safeText(
    input.contactText || (zh ? "请联系管理员" : "Please contact the administrator"),
  );
  const id = safeText(input.requestId);
  if (input.family !== "browser")
    return new Response(`${notice} | ${id} | ${contact}\n`, {
      status: 403,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    });
  let url = "";
  try {
    const parsed = new URL(input.contactUrl ?? "");
    if (["https:", "http:"].includes(parsed.protocol)) url = safeText(parsed.href);
  } catch {
    /* Omit invalid links. */
  }
  const body = `<!doctype html><html lang="${zh ? "zh" : "en"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${notice}</title><style>:root{color-scheme:light dark;font-family:system-ui,sans-serif;color:#17233b;background:#f3f6fb}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}main{width:min(100%,580px);padding:clamp(24px,6vw,48px);border:1px solid #ccd6e5;border-radius:24px;background:#fff;box-shadow:0 20px 80px #1423400d}small{color:#476081;letter-spacing:.12em}h1{font-size:clamp(24px,5vw,32px);line-height:1.3}p{line-height:1.7;overflow-wrap:anywhere}code{font-size:12px}a{color:#244cc1}footer{color:#536178;font-size:13px;margin-top:32px}@media(prefers-color-scheme:dark){:root{background:#0f1726;color:#eef3ff}main{background:#172238;border-color:#38475f}small,footer{color:#b9c8df}a{color:#a7c2ff}}</style></head><body><main><small>KEY MASTER · 403</small><h1>${notice}</h1><p>${url ? `<a href="${escapeHtml(url)}" rel="noopener noreferrer">${escapeHtml(contact)}</a>` : escapeHtml(contact)}</p><p>${zh ? "请求编号" : "Request ID"}<br><code>${escapeHtml(id)}</code></p><p>${escapeHtml(new Date(input.now).toISOString())}</p><footer>${escapeHtml(safeText(input.footer ?? ""))}</footer></main></body></html>`;
  return new Response(body, {
    status: 403,
    headers: {
      ...headers,
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
