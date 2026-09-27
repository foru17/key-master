import { describe, expect, it } from "vitest";
import {
  clientFamilies,
  type DecisionInput,
  decide,
  deniedResponse,
  detectClient,
  hashToken,
  inCidrs,
  normalizeIp,
  tokenMatches,
} from "./index.js";

const now = 1_800_000_000_000;
const base: DecisionInput = {
  resource: { slug: "/private", enabled: true, policy: "approval" },
  ip: "203.0.113.10",
  ua: "curl/8.7.1",
  now,
  tokens: [],
  grants: [],
  blocks: [],
  internalCidrs: [],
};
const token = {
  id: "token",
  secretHash: hashToken("TEST_TOKEN"),
  scope: ["/private"],
  expiresAt: null,
  revokedAt: null,
};
const grant = {
  id: "grant",
  subjectKind: "ip" as const,
  subject: base.ip,
  scope: ["*"],
  expiresAt: now + 1,
  revokedAt: null,
};
const block = { subject: base.ip, until: now + 1 };
describe("client detection", () => {
  it.each([
    ["Clash-Verge/2.0.0 mihomo", "clash-verge"],
    ["Clash Verge/1.7.7", "clash-verge"],
    ["Stash/2.5.1 Clash", "stash"],
    ["mihomo/1.19.0", "mihomo"],
    ["Clash.Meta/1.18.0", "mihomo"],
    ["ClashMetaForAndroid/2.10", "mihomo"],
    ["ClashX/1.118.0", "clashx"],
    ["clash/1.18.0", "clash"],
    ["Surge/5.8.0", "surge"],
    ["Shadowrocket/2.2.52", "shadowrocket"],
    ["Quantumult%20X/1.4.3", "quantumult-x"],
    ["Quantumult X/1.4.3", "quantumult-x"],
    ["Loon/3.2.0", "loon"],
    ["sing-box/1.11.0", "sing-box"],
    ["SFI/1.11.0", "sing-box"],
    ["SFA/1.11.0", "sing-box"],
    ["SFM/1.11.0", "sing-box"],
    ["v2rayN/7.0.0", "v2rayn"],
    ["v2rayNG/1.9.0", "v2rayng"],
    ["Surfboard/2.24.0", "surfboard"],
    ["curl/8.7.1", "curl"],
    ["Wget/1.21.4", "wget"],
    ["python-requests/2.32.3", "python"],
    [
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130.0.0.0 Safari/537.36",
      "browser",
    ],
    ["", "unknown"],
    ["custom-agent", "unknown"],
    ["safari", "unknown"],
  ])("%s → %s", (ua, expected) => expect(detectClient(ua, "text/html")).toBe(expected));
  it.each(["", "application/json"])("requires HTML Accept (%s)", (accept) =>
    expect(detectClient("Mozilla/5.0", accept)).toBe("unknown"),
  );
});
describe("decision order and HTTP preconditions", () => {
  const cases: [string, Partial<DecisionInput>, string][] = [
    ["missing", { resource: null }, "not_found"],
    [
      "disabled public",
      { resource: { slug: "/private", enabled: false, policy: "public" } },
      "not_found",
    ],
    [
      "public beats all",
      { resource: { slug: "/private", enabled: true, policy: "public" }, blocks: [block] },
      "allow_public",
    ],
    [
      "token beats block",
      { queryToken: "TEST_TOKEN", tokens: [token], blocks: [block] },
      "allow_token",
    ],
    [
      "wildcard token",
      { queryToken: "TEST_TOKEN", tokens: [{ ...token, scope: ["*"] }] },
      "allow_token",
    ],
    [
      "expired token",
      { queryToken: "TEST_TOKEN", tokens: [{ ...token, expiresAt: now }] },
      "deny_pending",
    ],
    [
      "revoked token",
      { queryToken: "TEST_TOKEN", tokens: [{ ...token, revokedAt: now }] },
      "deny_pending",
    ],
    [
      "token revoked at epoch zero",
      { queryToken: "TEST_TOKEN", tokens: [{ ...token, revokedAt: 0 }] },
      "deny_pending",
    ],
    [
      "wrong token scope",
      { queryToken: "TEST_TOKEN", tokens: [{ ...token, scope: ["/other"] }] },
      "deny_pending",
    ],
    ["invalid token", { queryToken: "WRONG", tokens: [token] }, "deny_pending"],
    [
      "internal precedes token only",
      {
        internalCidrs: ["203.0.113.0/24"],
        resource: { slug: "/private", enabled: true, policy: "token_only" },
      },
      "allow_internal",
    ],
    [
      "token only ignores grant",
      { resource: { slug: "/private", enabled: true, policy: "token_only" }, grants: [grant] },
      "deny_unknown",
    ],
    ["ip grant precedes block", { grants: [grant], blocks: [block] }, "allow_grant"],
    [
      "client grant",
      { grants: [{ ...grant, subjectKind: "ip_client", subject: `${base.ip}|curl` }] },
      "allow_grant",
    ],
    [
      "other client grant",
      { grants: [{ ...grant, subjectKind: "ip_client", subject: `${base.ip}|clash` }] },
      "deny_pending",
    ],
    ["grant expired", { grants: [{ ...grant, expiresAt: now }] }, "deny_pending"],
    ["grant revoked", { grants: [{ ...grant, revokedAt: now }] }, "deny_pending"],
    ["grant wrong scope", { grants: [{ ...grant, scope: ["/other"] }] }, "deny_pending"],
    ["ip block", { blocks: [block] }, "deny_blocked"],
    ["client block", { blocks: [{ ...block, subject: `${base.ip}|curl` }] }, "deny_blocked"],
    ["block expired", { blocks: [{ ...block, until: now }] }, "deny_pending"],
    ["pending", {}, "deny_pending"],
  ];
  describe.each([
    { method: "GET" },
    { method: "HEAD" },
    { method: "GET", range: "bytes=0-9" },
    { method: "GET", ifNoneMatch: '"cached"' },
  ])("%j", (headers) => {
    it.each(cases)("%s", (_name, overrides, expected) => {
      const result = decide({ ...base, ...headers, ...overrides });
      expect(result.decision).toBe(expected);
      expect(result.allowed).toBe(expected.startsWith("allow_"));
      expect(result.status).toBe(expected === "not_found" ? 404 : result.allowed ? 200 : 403);
      expect(result.notify).toBe(expected === "deny_pending");
      expect(result.status).not.toBe(304);
    });
  });
});
describe("hashes and IPs", () => {
  it("uses sha256 and optional pepper", () => {
    expect(hashToken("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(tokenMatches("TEST_TOKEN", hashToken("TEST_TOKEN", "TEST_PEPPER"), "TEST_PEPPER")).toBe(
      true,
    );
    expect(tokenMatches("TEST_TOKEN", hashToken("TEST_TOKEN", "TEST_PEPPER"))).toBe(false);
  });
  it.each(["", "x", "00", "z".repeat(64), hashToken("WRONG")])(
    "rejects malformed/mismatched hash %s",
    (hash) => expect(tokenMatches("TEST_TOKEN", hash)).toBe(false),
  );
  it.each([
    ["203.0.113.4", "203.0.113.0/24", true],
    ["203.0.113.4", "203.0.113.10/32", false],
    ["::ffff:203.0.113.4", "203.0.113.0/24", true],
    ["2001:db8::1", "2001:db8::/32", true],
    ["invalid", "203.0.113.0/24", false],
  ] as const)("CIDR %s %s", (ip, cidr, expected) => expect(inCidrs(ip, [cidr])).toBe(expected));
  it("normalizes mapped addresses", () =>
    expect(normalizeIp("::ffff:203.0.113.4")).toBe("203.0.113.4"));
});
describe("denied responses", () => {
  it.each(clientFamilies)("safe for %s", async (family) => {
    const response = deniedResponse({
      family,
      requestId: "REQUEST_ID",
      now,
      contactText: "Contact\nproxies: server: [Proxy]",
    });
    const body = await response.text();
    expect(response.status).toBe(403);
    expect(response.headers.get("X-Request-Id")).toBe("REQUEST_ID");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).not.toMatch(/proxies:|server:|\[Proxy\]/i);
    expect(response.headers.get("Content-Type")).toContain(
      family === "browser" ? "text/html" : "text/plain",
    );
    if (family !== "browser") expect(body.trim().split("\n")).toHaveLength(1);
  });
  it.each([
    ["zh-CN, en;q=0.9", "访问需要管理员批准"],
    ["en-US", "Access requires"],
    ["", "Access requires"],
  ])("language %s", async (acceptLanguage, expected) => {
    const body = await deniedResponse({
      family: "browser",
      requestId: "ID",
      now,
      acceptLanguage,
      contactText: '<script>alert("x")</script>',
      contactUrl: "javascript:alert(1)",
    }).text();
    expect(body).toContain(expected);
    expect(body).toContain("prefers-color-scheme:dark");
    expect(body).not.toContain("<script>");
    expect(body).not.toContain("javascript:");
  });
  it.each(clientFamilies)("static 404 for %s", async (family) => {
    const response = deniedResponse({
      family,
      requestId: "ID",
      now,
      notFound: true,
      notFoundBody: "404 Not Found\n",
    });
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("404 Not Found\n");
  });
});

describe("denial timezones", () => {
  it.each([
    [undefined, "en", "09/27/2026, 07:22:09 (UTC)"],
    ["Asia/Singapore", "zh-CN", "2026/09/27 15:22:09 (Asia/Singapore)"],
    ["America/New_York", "en", "09/27/2026, 03:22:09 (America/New_York)"],
  ])("formats %s in %s", async (timeZone, acceptLanguage, expected) => {
    const iso = "2026-09-27T07:22:09.000Z";
    const response = deniedResponse({
      family: "browser",
      requestId: "EXAMPLE",
      now: Date.parse(iso),
      acceptLanguage,
      ...(timeZone ? { timeZone } : {}),
    });
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain(expected);
    expect(body).toContain(`datetime="${iso}" title="${iso}"`);
  });
});
