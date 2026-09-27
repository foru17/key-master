import type { IncomingMessage } from "node:http";
import { hashToken } from "@key-master/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { restoreSettings } from "./admin.js";
import { createApp } from "./app.js";
import { createLoginCode } from "./auth.js";
import { type Config, configSchema } from "./config.js";
import { openStore, type Store, setState, syncResources, syncTokens } from "./db.js";
import { ingestLine } from "./ingest.js";
import * as schema from "./schema.js";

let store: Store;
let config: Config;
let now: number;
let code: string;
let cookie: string;
let app: ReturnType<typeof createApp>;
const secrets = {
  telegramToken: "",
  sessionSecret: "TEST_SESSION_SECRET_32_CHARACTERS",
  tokenPepper: "",
};
const peer = { incoming: { socket: { remoteAddress: "203.0.113.7" } } as IncomingMessage };
const send = vi.fn(async (value: string) => {
  code = value;
});
function req(
  path: string,
  method = "GET",
  body?: unknown,
  authenticated = true,
  headers: Record<string, string> = {},
) {
  return app.request(
    `https://example.com/api/${path}`,
    {
      method,
      headers: {
        "content-type": "application/json",
        ...(authenticated ? { cookie } : {}),
        ...headers,
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    },
    peer,
  );
}
beforeEach(async () => {
  store = openStore();
  now = 1800000000000;
  config = configSchema.parse({
    admin: { allowed_cidrs: ["203.0.113.0/24"] },
    resources: [{ slug: "/private", kind: "inline", source: "EXAMPLE" }],
  });
  syncResources(store, config, now);
  send.mockClear();
  app = createApp({
    store,
    config,
    secrets,
    now: () => now,
    bot: { notify: async () => {}, handle: async () => {}, sendLoginCode: send },
  });
  code = createLoginCode(store, secrets.sessionSecret, now);
  const r = await req("auth/verify", "POST", { code }, false);
  cookie = r.headers.get("set-cookie")?.split(";")[0] ?? "";
});
afterEach(() => store.sqlite.close());
it.each([
  "overview",
  "requests",
  "requests/missing",
  "approvals",
  "grants",
  "tokens",
  "resources",
  "settings",
  "events",
  "session",
])("protects %s with both session and CIDR", async (path) => {
  expect((await req(`admin/${path}`, "GET", undefined, false)).status).toBe(401);
  config.admin.allowed_cidrs = [];
  expect((await req(`admin/${path}`)).status).toBe(403);
});
it("sends, redeems once, expires, logs out and uses secure cookies", async () => {
  expect((await req("auth/request-code", "POST", {}, false)).status).toBe(200);
  expect(send).toHaveBeenCalledOnce();
  const r = await req("auth/verify", "POST", { code }, false);
  expect(r.status).toBe(200);
  const set = r.headers.get("set-cookie") ?? "";
  for (const flag of ["HttpOnly", "Secure", "SameSite=Strict", "Max-Age=43200"])
    expect(set).toContain(flag);
  cookie = set.split(";")[0] ?? "";
  expect((await req("auth/verify", "POST", { code }, false)).status).toBe(401);
  expect((await req("admin/session")).status).toBe(200);
  expect((await req("auth/logout", "POST", {})).status).toBe(200);
  expect((await req("admin/session")).status).toBe(401);
  code = createLoginCode(store, secrets.sessionSecret, now);
  now += 300001;
  expect((await req("auth/verify", "POST", { code }, false)).status).toBe(401);
});
it("expires persisted sessions at 12 hours", async () => {
  now += 43200000;
  expect((await req("admin/session")).status).toBe(401);
});
it.each(["request-code", "verify"])("bounds %s brute force", async (path) => {
  const statuses = [];
  for (let i = 0; i < 8; i++)
    statuses.push((await req(`auth/${path}`, "POST", { code: "000000" }, false)).status);
  expect(statuses.at(-1)).toBe(429);
  now += 300001;
  expect((await req(`auth/${path}`, "POST", { code: "000000" }, false)).status).not.toBe(429);
});
it("rejects cross-origin and malformed requests", async () => {
  expect(
    (await req("admin/grants", "POST", {}, true, { origin: "https://other.example.com" })).status,
  ).toBe(403);
  expect(
    (await req("admin/grants", "POST", {}, true, { "content-type": "text/plain" })).status,
  ).toBe(415);
  expect((await req("admin/grants", "POST", {})).status).toBe(400);
});
it("fails delivery closed and invalidates the code", async () => {
  send.mockRejectedValueOnce(new Error("offline"));
  expect((await req("auth/request-code", "POST", {})).status).toBe(503);
  expect(
    store.db
      .select()
      .from(schema.loginCodes)
      .all()
      .every((r) => r.usedAt !== null),
  ).toBe(true);
});
it("handles grant CRUD and revocation", async () => {
  const input = { subjectKind: "ip", subject: "203.0.113.8", scope: ["/private"], duration: 600 };
  const r = await req("admin/grants", "POST", input);
  expect(r.status).toBe(201);
  const { id } = await r.json();
  expect((await req(`admin/grants/${id}`, "PATCH", { ...input, duration: 3600 })).status).toBe(200);
  expect((await req("admin/grants")).status).toBe(200);
  expect((await req(`admin/grants/${id}`, "DELETE", {})).status).toBe(200);
  expect(store.db.select().from(schema.grants).get()?.revokedAt).toBe(now);
});
it.each(["bad", "203.0.113.8|bad", "203.0.113.8|curl|extra"])(
  "rejects invalid grant %s",
  async (subject) => {
    expect(
      (
        await req("admin/grants", "POST", {
          subjectKind: "ip_client",
          subject,
          scope: ["*"],
          duration: 600,
        })
      ).status,
    ).toBe(400);
  },
);
it("issues plaintext once, records usage and revokes", async () => {
  const r = await req("admin/tokens", "POST", {
    label: "Example",
    kind: "machine",
    scope: ["/private"],
  });
  expect(r.status).toBe(201);
  const issued = await r.json();
  expect(issued.secret.length).toBeGreaterThan(32);
  expect(issued.urls[0]).toContain("https://example.com/private?k=");
  expect(JSON.stringify(store.db.select().from(schema.tokens).all())).not.toContain(issued.secret);
  let list = await (await req("admin/tokens")).json();
  expect(JSON.stringify(list)).not.toContain("secret");
  expect(
    (await app.request(`https://example.com/private?k=${issued.secret}`, {}, peer)).status,
  ).toBe(200);
  list = await (await req("admin/tokens")).json();
  expect(list[0].usage[0].count).toBe(1);
  expect((await req(`admin/tokens/${issued.id}`, "DELETE", {})).status).toBe(200);
  expect(
    (await app.request(`https://example.com/private?k=${issued.secret}`, {}, peer)).status,
  ).toBe(403);
});
it("validates resources and supports editing disabling deleting", async () => {
  const input = {
    slug: "/example",
    kind: "inline",
    source: "EXAMPLE BODY",
    policy: "approval",
    content_type: "text/plain",
    enabled: true,
  };
  const r = await req("admin/resources", "POST", input);
  expect(r.status).toBe(201);
  const { id } = await r.json();
  expect((await req("admin/resources", "POST", input)).status).toBe(409);
  expect((await req("admin/resources", "POST", { ...input, slug: "/api/secret" })).status).toBe(
    400,
  );
  expect((await req(`admin/resources/${id}`, "PUT", { ...input, enabled: false })).status).toBe(
    200,
  );
  const list = await (await req("admin/resources")).json();
  expect(list.find((r: { id: string }) => r.id === id).hash).toMatch(/^[a-f0-9]{64}$/);
  expect((await app.request("https://example.com/example", {}, peer)).status).toBe(404);
  expect((await req(`admin/resources/${id}`, "DELETE", {})).status).toBe(200);
});
it.each(["allow", "deny", "device_token"] as const)(
  "resolves %s once across shared service",
  async (action) => {
    const requestId = "EXAMPLE_REQUEST";
    store.db
      .insert(schema.requests)
      .values({
        id: requestId,
        ts: now,
        ip: "203.0.113.9",
        ua: "Example/curl",
        clientFamily: "curl",
        method: "GET",
        path: "/private",
        resourceSlug: "/private",
        decision: "deny_pending",
        status: 403,
        bytes: 0,
        latencyMs: 2,
        source: "app",
      })
      .run();
    store.db
      .insert(schema.pending)
      .values({
        id: "EXAMPLE_PENDING",
        subject: "203.0.113.9|curl",
        requestId,
        slugs: ["/private"],
        expiresAt: now + 600000,
        messages: [],
      })
      .run();
    expect((await (await req("admin/events")).json()).pending).toHaveLength(1);
    const r = await req("admin/approvals/EXAMPLE_PENDING", "POST", { action, duration: 600 });
    expect(r.status).toBe(200);
    if (action === "device_token") expect((await r.json()).secret).toBeTruthy();
    expect((await req("admin/approvals/EXAMPLE_PENDING", "POST", { action })).status).toBe(409);
    expect((await (await req("admin/approvals")).json()).recent[0].actor).toBe("admin:owner");
    expect((await (await req("admin/events")).json()).pending).toHaveLength(0);
  },
);
it("queries request filters, details and series with bounded pagination", async () => {
  await app.request(
    "https://example.com/private",
    {
      headers: {
        "user-agent": "curl/8.0",
        accept: "text/plain",
        authorization: "SECRET_MUST_NOT_APPEAR",
      },
    },
    peer,
  );
  const r = await (
    await req(
      "admin/requests?q=203.0.113&decision=deny_pending&client=curl&resource=%2Fprivate&pageSize=1",
    )
  ).json();
  expect(r.total).toBe(1);
  const detail = await (await req(`admin/requests/${r.items[0].id}`)).json();
  expect(detail.headers.accept).toBe("text/plain");
  expect(JSON.stringify(detail)).not.toContain("SECRET_MUST_NOT_APPEAR");
  expect((await req("admin/requests?pageSize=1000")).status).toBe(400);
  expect((await req("admin/requests/missing")).status).toBe(404);
  for (const [range, length] of [
    ["24h", 24],
    ["7d", 7],
  ]) {
    const overview = await (await req(`admin/overview?range=${range}`)).json();
    expect(overview.series).toHaveLength(length as number);
    expect(overview.stats.denied).toBe(1);
  }
});
it("persists settings, omits secrets and changes gateway behavior", async () => {
  const initial = await (await req("admin/settings")).json();
  expect(JSON.stringify(initial)).not.toContain("sessionSecret");
  const saved = {
    ...initial,
    observe_mode: true,
    notice: { ...initial.notice, contact_text: "Example administrator" },
  };
  expect((await req("admin/settings", "PUT", saved)).status).toBe(200);
  expect((await app.request("https://example.com/private", {}, peer)).status).toBe(200);
  const fresh = configSchema.parse({ admin: { allowed_cidrs: ["203.0.113.0/24"] } });
  createApp({ store, config: fresh, secrets });
  expect(fresh.observe_mode).toBe(true);
});
it("blocking revokes matching grants", async () => {
  await req("admin/grants", "POST", {
    subjectKind: "ip",
    subject: "203.0.113.9",
    scope: ["*"],
    duration: 600,
  });
  expect((await req("admin/blocks", "POST", { ip: "203.0.113.9", duration: 3600 })).status).toBe(
    200,
  );
  expect(store.db.select().from(schema.grants).get()?.revokedAt).toBe(now);
  expect(
    store.db.select().from(schema.blocks).where(eq(schema.blocks.subject, "203.0.113.9")).get(),
  ).toBeTruthy();
});

it.each([
  ["grants", "POST"],
  ["grants/missing", "PATCH"],
  ["grants/missing", "DELETE"],
  ["tokens", "POST"],
  ["tokens/missing", "DELETE"],
  ["resources", "POST"],
  ["resources/missing", "PUT"],
  ["resources/missing", "DELETE"],
  ["settings", "PUT"],
  ["blocks", "POST"],
  ["approvals/missing", "POST"],
])("protects mutation %s %s before parsing input", async (path, method) => {
  expect((await req(`admin/${path}`, method, {}, false)).status).toBe(401);
  config.admin.allowed_cidrs = [];
  expect((await req(`admin/${path}`, method, {})).status).toBe(403);
});
it("persists pending requests when Telegram is not configured", async () => {
  const offline = createApp({ store, config, secrets, now: () => now });
  await offline.request(
    "https://example.com/private",
    { headers: { "user-agent": "curl/8" } },
    peer,
  );
  await offline.request(
    "https://example.com/private",
    { headers: { "user-agent": "curl/8" } },
    peer,
  );
  expect(store.db.select().from(schema.pending).all()).toHaveLength(1);
});
it.each(["grants", "tokens", "resources"])(
  "returns 404 for unknown %s revocation",
  async (path) => {
    expect((await req(`admin/${path}/missing`, "DELETE", {})).status).toBe(404);
  },
);
it("rejects expired token issuance and invalid settings without modifying state", async () => {
  expect(
    (
      await req("admin/tokens", "POST", {
        label: "Example",
        kind: "machine",
        scope: ["*"],
        expiresAt: now,
      })
    ).status,
  ).toBe(400);
  expect(
    (await req("admin/settings", "PUT", { observe_mode: true, durations: { grant_default: -1 } }))
      .status,
  ).toBe(400);
  expect(config.observe_mode).toBe(false);
});

it("legacy settings retain the configured notice timezone", () => {
  config.notice.timezone = "Asia/Singapore";
  const { timezone: _timezone, ...notice } = config.notice;
  setState(
    store,
    "admin_settings",
    JSON.stringify({ observe_mode: false, durations: config.durations, notice }),
  );
  restoreSettings(store, config);
  expect(config.notice.timezone).toBe("Asia/Singapore");
});

it("lists imported tokens and correlates nginx audit without exposing hashes", async () => {
  config.tokens = configSchema.parse({
    tokens: [
      {
        id: "example-nginx-token",
        label: "Example imported integration",
        kind: "machine",
        scope: ["/private"],
        secret_sha256: hashToken("EXAMPLE_EXTERNAL_TOKEN"),
      },
    ],
  }).tokens;
  syncTokens(store, config, now);
  expect(
    ingestLine(
      store,
      JSON.stringify({
        time_iso8601: new Date(now).toISOString(),
        remote_addr: "203.0.113.8",
        request_method: "GET",
        uri: "/private",
        status: 200,
        body_bytes_sent: 12,
        request_time: 0.01,
        km_source: "direct",
        km_token_id: "example-nginx-token",
      }),
    ),
  ).toBe(true);
  const response = await req("admin/tokens");
  expect(response.status).toBe(200);
  const body = await response.text();
  expect(body).not.toContain(hashToken("EXAMPLE_EXTERNAL_TOKEN"));
  expect(body).not.toContain("EXAMPLE_EXTERNAL_TOKEN");
  expect(JSON.parse(body)).toContainEqual(
    expect.objectContaining({
      id: "example-nginx-token",
      label: "Example imported integration",
      usage: expect.arrayContaining([expect.objectContaining({ count: 1 })]),
    }),
  );
  const audit = store.db
    .select()
    .from(schema.requests)
    .where(eq(schema.requests.source, "nginx"))
    .get();
  const details = await req(`admin/requests/${audit?.id}`);
  expect(await details.json()).toMatchObject({ tokenId: "example-nginx-token", source: "nginx" });
});
it("describes sources and clients, and reports per-resource activity", async () => {
  const hit = (ua: string) =>
    app.request("https://example.com/private", { headers: { "user-agent": ua } }, peer);
  await hit("Shadowrocket/3378 CFNetwork/3886.100.1 Darwin/27.0.0 iPhone18,3");
  await hit("curl/8.7.1");
  const list = (await (await req("admin/requests")).json()) as {
    items: {
      id: string;
      ipInfo: { scope: string } | null;
      client: { kind: string; name: string };
    }[];
  };
  const described = list.items.filter((i) => i.client);
  expect(described.map((i) => i.client.name)).toEqual(
    expect.arrayContaining(["Shadowrocket", "curl"]),
  );
  expect(described[0]?.ipInfo).toMatchObject({ scope: "reserved" });
  const detail = (await (await req(`admin/requests/${described[0]?.id}`)).json()) as {
    client: { kind: string };
    ipInfo: { source: string };
  };
  expect(detail.client.kind).toBeDefined();
  expect(detail.ipInfo.source).toBe("none");
  const resources = (await (await req("admin/resources")).json()) as {
    slug: string;
    requests24h: number;
    denied24h: number;
    lastRequestAt: number | null;
  }[];
  const row = resources.find((r) => r.slug === "/private");
  expect(row?.requests24h).toBeGreaterThanOrEqual(2);
  expect(row?.denied24h).toBeGreaterThanOrEqual(0);
  expect(row?.lastRequestAt).not.toBeNull();
  const approvals = (await (await req("admin/approvals")).json()) as {
    pending: { ipInfo: unknown; client: { name: string } | null }[];
  };
  for (const p of approvals.pending) expect(p).toHaveProperty("ipInfo");
});
