import { describe, expect, it } from "vitest";
import {
  type AllowlistEntry,
  allowlistValueForIp,
  type DecisionInput,
  decide,
  parseAllowlistValue,
} from "./index.js";

const entry: AllowlistEntry = {
  id: "home",
  value: "203.0.113.7",
  kind: "ip",
  scope: ["*"],
  revokedAt: null,
  resolved: [],
};
const base: DecisionInput = {
  resource: { slug: "/private", policy: "approval", enabled: true },
  ip: entry.value,
  ua: "curl",
  now: 1000,
  tokens: [],
  grants: [],
  blocks: [],
  internalCidrs: [],
  allowlist: [entry],
};
describe("allowlist decisions", () => {
  it.each<[string, Partial<DecisionInput>, string]>([
    ["exact IP", {}, "allow_allowlist"],
    ["miss", { ip: "203.0.113.8" }, "deny_pending"],
    [
      "token only",
      { resource: { slug: "/private", policy: "token_only", enabled: true } },
      "deny_unknown",
    ],
    ["revoked", { allowlist: [{ ...entry, revokedAt: 0 }] }, "deny_pending"],
    ["scope miss", { allowlist: [{ ...entry, scope: ["/other"] }] }, "deny_pending"],
    ["scope match", { allowlist: [{ ...entry, scope: ["/private"] }] }, "allow_allowlist"],
    [
      "CIDR",
      { allowlist: [{ ...entry, value: "203.0.113.0/24", kind: "cidr" }] },
      "allow_allowlist",
    ],
    [
      "host v4 exact",
      {
        allowlist: [{ ...entry, value: "home.example.com", kind: "host", resolved: [entry.value] }],
      },
      "allow_allowlist",
    ],
    [
      "host v4 miss",
      {
        allowlist: [
          { ...entry, value: "home.example.com", kind: "host", resolved: ["203.0.113.8"] },
        ],
      },
      "deny_pending",
    ],
    [
      "host v6 /64",
      {
        ip: "2001:db8:1:2::abcd",
        allowlist: [{ ...entry, kind: "host", resolved: ["2001:db8:1:2::1"] }],
      },
      "allow_allowlist",
    ],
    [
      "host v6 other prefix",
      {
        ip: "2001:db8:1:3::1",
        allowlist: [{ ...entry, kind: "host", resolved: ["2001:db8:1:2::1"] }],
      },
      "deny_pending",
    ],
    [
      "explicit IPv6 exact",
      { ip: "2001:db8::2", allowlist: [{ ...entry, value: "2001:db8::1" }] },
      "deny_pending",
    ],
    [
      "precedes grant/block",
      {
        grants: [
          {
            id: "grant",
            subjectKind: "ip",
            subject: entry.value,
            scope: ["*"],
            expiresAt: 2000,
            revokedAt: null,
          },
        ],
        blocks: [{ subject: entry.value, until: 2000 }],
      },
      "allow_allowlist",
    ],
  ])("%s", (_name, patch, expected) => {
    for (const request of [
      {},
      { method: "HEAD" },
      { range: "bytes=0-1" },
      { ifNoneMatch: '"etag"' },
    ]) {
      const result = decide({ ...base, ...patch, ...request });
      expect(result.decision).toBe(expected);
      if (expected === "allow_allowlist")
        expect(result).toMatchObject({ allowlistId: "home", allowed: true, notify: false });
      expect(result.grantId).toBeUndefined();
    }
  });
});
it.each([
  "203.0.113.0/23",
  "2001:db8::/32",
  "2001:db8::/47",
  "::ffff:203.0.113.0/120",
  "999.1.1.1",
  "https://example.com",
  "*.example.com",
  "bad_.example.com",
  "-bad.example.com",
  "example..com",
  "localhost",
  "example.com:80",
  "203.0.113.1/24/2",
])("rejects %s", (value) => expect(parseAllowlistValue(value)).toBeNull());
it.each([
  ["203.0.113.7", "ip"],
  ["2001:db8::1", "ip"],
  ["203.0.113.0/24", "cidr"],
  ["2001:db8::/48", "cidr"],
  ["home.example.com", "host"],
])("accepts %s", (value, kind) => expect(parseAllowlistValue(value ?? "")?.kind).toBe(kind));
it("canonicalizes quick IPv6 approvals", () => {
  expect(allowlistValueForIp("2001:db8:1:2:abcd::1")).toBe("2001:db8:1:2::/64");
  expect(allowlistValueForIp("203.0.113.7")).toBe("203.0.113.7");
});
