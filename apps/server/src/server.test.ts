import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import type { IncomingMessage } from "node:http";
import { resolve } from "node:path";
import { hashToken } from "@key-master/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, isAuditNoise } from "./app.js";
import { type Config, configSchema, loadConfig } from "./config.js";
import { issueToken, openStore, type Store, syncResources, syncTokens } from "./db.js";
import { ingestLine, tailNginx } from "./ingest.js";
import { clientIp } from "./ip.js";
import * as schema from "./schema.js";

const now = 1_800_000_000_000;
const secrets = {
  telegramToken: "",
  sessionSecret: "TEST_SESSION_SECRET_32_CHARACTERS",
  tokenPepper: "",
};
let store: Store;
let config: Config;
let temp: string;
const peer = { incoming: { socket: { remoteAddress: "203.0.113.10" } } as IncomingMessage };
beforeEach(() => {
  store = openStore();
  mkdirSync(".test-data", { recursive: true });
  temp = mkdtempSync(resolve(".test-data/run-"));
  config = configSchema.parse({
    file_root: temp,
    resources: [
      { slug: "/private", kind: "inline", source: "PRIVATE_BODY" },
      { slug: "/public", kind: "inline", source: "PUBLIC_BODY", policy: "public" },
    ],
  });
  syncResources(store, config, now);
});
afterEach(() => {
  store.sqlite.close();
  rmSync(temp, { recursive: true, force: true });
});
function app(extra: Partial<Parameters<typeof createApp>[0]> = {}) {
  return createApp({ store, config, secrets, now: () => now, ...extra });
}
function get(path: string, init: RequestInit = {}, instance = app()) {
  return instance.request(`http://example.com${path}`, init, peer);
}
describe("gateway", () => {
  it.each([
    ["GET", {}, 403],
    ["HEAD", {}, 403],
    ["GET", { Range: "bytes=0-3" }, 403],
    ["GET", { "If-None-Match": "*" }, 403],
    ["POST", {}, 403],
  ] as const)("denies before HTTP semantics: %s %j", async (method, headers, status) => {
    const response = await get("/private", { method, headers });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("PRIVATE_BODY");
    const audit = store.db.select().from(schema.requests).get();
    expect(audit?.id).toBe(response.headers.get("x-request-id"));
    expect(audit?.decision).toBe("deny_pending");
    expect(audit?.ip).toBe("203.0.113.10");
  });
  it("serves token, updates last use and never logs its query", async () => {
    const token = issueToken(store, { kind: "machine", label: "test", scope: ["/private"] });
    const response = await get(`/private?k=${token.secret}`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("PRIVATE_BODY");
    expect(store.db.select().from(schema.tokens).get()?.lastUsedAt).toBe(now);
    expect(JSON.stringify(store.db.select().from(schema.requests).all())).not.toContain(
      token.secret,
    );
  });
  it.each([
    ["GET", { Range: "bytes=0-3" }, 206, "PRIV"],
    ["HEAD", { Range: "bytes=0-3" }, 200, ""],
    ["GET", { "If-None-Match": "*" }, 304, ""],
    ["GET", { Range: "bytes=999-" }, 416, ""],
    ["POST", {}, 405, "Method not allowed"],
  ] as const)("allowed HTTP %s %j", async (method, headers, status, body) => {
    const token = issueToken(store, { kind: "machine", label: "test", scope: ["*"] });
    const response = await get(`/private?k=${token.secret}`, { method, headers });
    expect(response.status).toBe(status);
    expect(await response.text()).toContain(body);
  });
  it("rechecks authorization for a cached ETag after revocation", async () => {
    const token = issueToken(store, { kind: "machine", label: "test", scope: ["*"] });
    const response = await get(`/private?k=${token.secret}`);
    const etag = response.headers.get("etag") ?? "";
    store.db
      .update(schema.tokens)
      .set({ revokedAt: now })
      .where(eq(schema.tokens.id, token.id))
      .run();
    expect(
      (await get(`/private?k=${token.secret}`, { headers: { "If-None-Match": etag } })).status,
    ).toBe(403);
  });
  it("observes denials with the original decision and notifications", async () => {
    config.observe_mode = true;
    const notify = vi.fn(async () => {});
    const instance = app({ bot: { notify, handle: vi.fn() } });
    const response = await get("/private", {}, instance);
    expect(await response.text()).toBe("PRIVATE_BODY");
    expect(notify).toHaveBeenCalledOnce();
    expect(store.db.select().from(schema.requests).get()?.decision).toBe("deny_pending");
    expect(store.db.select().from(schema.requests).get()?.status).toBe(200);
    expect((await get("/missing", {}, instance)).status).toBe(404);
  });
  it("keeps disabled and missing bodies identical", async () => {
    store.db.update(schema.resources).set({ enabled: false }).run();
    const a = await get("/private");
    const b = await get("/missing");
    expect(a.status).toBe(404);
    expect(await a.text()).toBe(await b.text());
  });
  it("notification errors do not alter denial", async () => {
    const response = await get(
      "/private",
      {},
      app({
        bot: {
          notify: async () => {
            throw new Error("offline");
          },
          handle: vi.fn(),
        },
      }),
    );
    expect(response.status).toBe(403);
  });
  it("health is not audited", async () => {
    const response = await get("/healthz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(store.db.select().from(schema.requests).all()).toHaveLength(0);
  });
  it.each([
    ["GET", "/healthz", null, true],
    ["GET", "/admin/assets/index.js", null, true],
    ["GET", "/api/admin/events", null, true],
    ["POST", "/api/admin/grants", null, false],
    ["GET", "/private", "/private", false],
    ["GET", "/nope", null, false],
  ])("audit noise %s %s", (method, path, slug, noise) => {
    expect(isAuditNoise(method, path, slug)).toBe(noise);
  });
  it("audit is append-only", async () => {
    await get("/private");
    expect(() => store.sqlite.exec("DELETE FROM requests")).toThrow("append-only");
    expect(() => store.sqlite.exec("UPDATE requests SET status=200")).toThrow("append-only");
  });
  it("sync is idempotent", () => {
    syncResources(store, config, now + 10);
    expect(store.db.select().from(schema.resources).all()).toHaveLength(2);
    expect(store.db.select().from(schema.resources).get()?.createdAt).toBe(now);
  });
  it("admin respects CIDRs and serves built assets", async () => {
    writeFileSync(resolve(temp, "index.html"), "<h1>Admin</h1>");
    expect((await get("/admin", {}, app({ adminRoot: temp }))).status).toBe(403);
    config.admin.allowed_cidrs = ["203.0.113.0/24"];
    const response = await get("/admin", {}, app({ adminRoot: temp }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Admin");
  });
});
describe("resource safety", () => {
  it("audits an upstream body failure with the final status and request ID", async () => {
    store.db
      .update(schema.resources)
      .set({ kind: "upstream", source: "https://example.com/resource" })
      .where(eq(schema.resources.slug, "/public"))
      .run();
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("Connection reset"));
          },
        }),
      ),
    );
    const response = await get("/public", {}, app({ fetcher }));
    expect(response.status).toBe(502);
    const row = store.db.select().from(schema.requests).get();
    expect(row?.id).toBe(response.headers.get("x-request-id"));
    expect(row?.status).toBe(502);
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("etag")).toBe(false);
    expect(row?.bytes).toBe(new TextEncoder().encode(await response.text()).length);
  });
  it.each(["file.txt", "../outside.txt", "link.txt"])("root containment %s", async (source) => {
    mkdirSync(resolve(temp, "files"));
    writeFileSync(resolve(temp, "files/file.txt"), "SAFE_FILE");
    writeFileSync(resolve(temp, "outside.txt"), "OUTSIDE_FILE");
    symlinkSync(resolve(temp, "outside.txt"), resolve(temp, "files/link.txt"));
    config.file_root = resolve(temp, "files");
    store.db
      .update(schema.resources)
      .set({ kind: "file", source })
      .where(eq(schema.resources.slug, "/public"))
      .run();
    const response = await get("/public");
    expect(response.status).toBe(source === "file.txt" ? 200 : 502);
    expect(await response.text()).not.toContain("OUTSIDE_FILE");
  });
  it("only fetches upstream after allow and strips user secrets", async () => {
    store.db
      .update(schema.resources)
      .set({ kind: "upstream", source: "https://example.com/resource" })
      .where(eq(schema.resources.slug, "/private"))
      .run();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("UPSTREAM", { headers: { ETag: '"abc"', "Set-Cookie": "bad=cookie" } }),
      );
    const instance = app({ fetcher });
    expect((await get("/private", {}, instance)).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
    const token = issueToken(store, { kind: "device", label: "test", scope: ["*"] });
    const response = await get(
      `/private?k=${token.secret}`,
      { headers: { Authorization: "SECRET", Range: "bytes=0-3" } },
      instance,
    );
    expect(await response.text()).toBe("UPSTREAM");
    expect(response.headers.has("set-cookie")).toBe(false);
    const init = fetcher.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).has("authorization")).toBe(false);
    expect(new Headers(init?.headers).get("range")).toBe("bytes=0-3");
    expect(init?.redirect).toBe("error");
  });
});
describe("proxy trust", () => {
  it.each([
    [[], { "x-forwarded-for": "203.0.113.99" }, "203.0.113.10"],
    [["203.0.113.10/32"], { "x-forwarded-for": "203.0.113.99, 203.0.113.11" }, "203.0.113.11"],
    [["203.0.113.10/32"], { "x-real-ip": "203.0.113.99" }, "203.0.113.99"],
    [
      ["203.0.113.10/32"],
      { "x-forwarded-for": "invalid", "x-real-ip": "203.0.113.99" },
      "203.0.113.10",
    ],
  ])("trust %j %j", (cidrs, headers, expected) =>
    expect(clientIp("::ffff:203.0.113.10", new Headers(headers), cidrs)).toBe(expected),
  );
});
describe("config", () => {
  it("loads the full example including an empty contact URL", () => {
    const loaded = loadConfig(resolve("../../config.example.yaml"), {
      KM_SESSION_SECRET: secrets.sessionSecret,
    });
    expect(loaded.config.notice.contact_url).toBe("");
    expect(loaded.config.resources).toHaveLength(2);
    expect(configSchema.safeParse({ public_base_url: "invalid" }).success).toBe(false);
  });
  it.each([
    { internal_cidrs: ["invalid"] },
    { listen: { port: 0 } },
    { resources: [{ slug: "/healthz", kind: "inline", source: "" }] },
    { telegram: { mode: "webhook" } },
    { resources: [{ slug: "/resource", kind: "upstream", source: "file:///etc/passwd" }] },
  ])("rejects %j", (value) => expect(configSchema.safeParse(value).success).toBe(false));
  it("loads YAML and environment secrets relative to config", () => {
    const path = resolve(temp, "config.yaml");
    writeFileSync(path, "file_root: files\n");
    const loaded = loadConfig(path, { KM_SESSION_SECRET: secrets.sessionSecret });
    expect(loaded.config.file_root).toBe(resolve(temp, "files"));
    expect(() => loadConfig(path, {})).toThrow("KM_SESSION_SECRET");
  });
});
describe("nginx ingestion", () => {
  const entry = JSON.stringify({
    time_iso8601: "2026-09-27T00:00:00Z",
    remote_addr: "203.0.113.1",
    request_method: "GET",
    uri: "/private?k=TEST_TOKEN",
    status: "200",
    body_bytes_sent: "12",
    request_time: "0.010",
    http_user_agent: "curl/8",
    km_source: "direct",
  });
  it.each([
    [undefined, null],
    ["", null],
    ["-", null],
    ["example-nginx-token", "example-nginx-token"],
    ["example-unknown", "example-unknown"],
  ])("associates optional token ID %s", (km_token_id, expected) => {
    expect(ingestLine(store, JSON.stringify({ ...JSON.parse(entry), km_token_id }))).toBe(true);
    const row = store.db.select().from(schema.requests).get();
    expect(row?.tokenId).toBe(expected);
    expect(JSON.stringify(row)).not.toContain("TEST_TOKEN");
  });
  it.each([12, "invalid/id", "x".repeat(201)])(
    "rejects malformed token label %s",
    (km_token_id) => {
      expect(ingestLine(store, JSON.stringify({ ...JSON.parse(entry), km_token_id }))).toBe(false);
      expect(store.db.select().from(schema.requests).all()).toHaveLength(0);
    },
  );
  it("redacts query, imports source and skips invalid/proxied rows", () => {
    expect(ingestLine(store, entry)).toBe(true);
    expect(ingestLine(store, "invalid")).toBe(false);
    expect(ingestLine(store, entry.replace('"direct"', '"proxy"'))).toBe(false);
    const row = store.db.select().from(schema.requests).get();
    expect(row?.source).toBe("nginx");
    expect(row?.path).toBe("/private");
    expect(row?.latencyMs).toBe(10);
  });
  it("tails partial lines, resumes and handles rotation/truncation", () => {
    const path = resolve(temp, "access.log");
    writeFileSync(path, `${entry}\n${entry.slice(0, 20)}`);
    expect(tailNginx(store, path).imported).toBe(1);
    expect(tailNginx(store, path).imported).toBe(0);
    appendFileSync(path, `${entry.slice(20)}\n`);
    expect(tailNginx(store, path).imported).toBe(1);
    renameSync(path, `${path}.old`);
    writeFileSync(path, `${entry}\n`);
    expect(tailNginx(store, path).imported).toBe(1);
    writeFileSync(path, "\n");
    expect(tailNginx(store, path).skipped).toBe(1);
    expect(store.db.select().from(schema.requests).all()).toHaveLength(3);
  });
});

describe("notice timezone", () => {
  it.each(["UTC", "Asia/Singapore", "America/New_York", "Etc/GMT+8"])("accepts %s", (timezone) => {
    expect(configSchema.parse({ notice: { timezone } }).notice.timezone).toBe(timezone);
  });
  it.each(["", "Invalid/Zone", "+08:00", "<script>"])("rejects %s", (timezone) => {
    expect(configSchema.safeParse({ notice: { timezone } }).success).toBe(false);
  });
  it.each(["/private", "/admin"])("uses configured timezone on %s", async (path) => {
    config.notice.timezone = "Asia/Singapore";
    const response = await get(path, {
      headers: { "user-agent": "Mozilla/5.0", accept: "text/html", "accept-language": "zh" },
    });
    expect(response.status).toBe(403);
    const body = await response.text();
    expect(body).toContain("(Asia/Singapore)");
    expect(body).toContain(`title="${new Date(now).toISOString()}"`);
    expect(body).toContain("访问需要管理员批准");
  });
});

describe("imported machine token authorization", () => {
  it.each([
    ["valid", ["/private"], now + 1, null, 200],
    ["wildcard", ["*"], undefined, null, 200],
    ["expired", ["/private"], now, null, 403],
    ["wrong scope", ["/other"], undefined, null, 403],
    ["revoked", ["/private"], undefined, now - 1, 403],
  ] as const)("honors %s", async (_name, scope, expires_at, revokedAt, status) => {
    config.tokens = configSchema.parse({
      tokens: [
        {
          id: "example-import",
          label: "Example import",
          kind: "machine",
          secret_sha256: hashToken("EXAMPLE_EXTERNAL_TOKEN", "EXAMPLE_PEPPER"),
          scope,
          expires_at,
        },
      ],
    }).tokens;
    syncTokens(store, config, now);
    store.db.update(schema.tokens).set({ revokedAt }).run();
    syncTokens(store, config, now + 1);
    const instance = app({ secrets: { ...secrets, tokenPepper: "EXAMPLE_PEPPER" } });
    const response = await get("/private?k=EXAMPLE_EXTERNAL_TOKEN", {}, instance);
    expect(response.status).toBe(status);
    const row = store.db.select().from(schema.requests).get();
    expect(row?.tokenId).toBe(status === 200 ? "example-import" : null);
    expect(store.db.select().from(schema.tokens).get()?.lastUsedAt).toBe(
      status === 200 ? now : null,
    );
    expect(JSON.stringify(row)).not.toContain("EXAMPLE_EXTERNAL_TOKEN");
  });
});
