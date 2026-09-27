import type { IncomingMessage } from "node:http";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { createLoginCode } from "./auth.js";
import { type Config, configSchema } from "./config.js";
import { openStore, type Store, syncResources } from "./db.js";
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
