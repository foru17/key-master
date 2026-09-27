import { readFileSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AllowlistResolver, syncAllowlist } from "./allowlist.js";
import { createApp } from "./app.js";
import { configSchema } from "./config.js";
import { openStore, type Store, syncResources } from "./db.js";
import * as schema from "./schema.js";

let store: Store;
const entry = { id: "home", label: "Home", value: "home.example.com" };
beforeEach(() => {
  store = openStore();
});
afterEach(() => {
  store.sqlite.close();
  vi.useRealTimers();
});
it.each([
  "203.0.113.0/23",
  "2001:db8::/47",
  "bad_.example.com",
  "https://example.com",
  "example..com",
])("config rejects %s", (value) => {
  expect(configSchema.safeParse({ allowlist: [{ ...entry, value }] }).success).toBe(false);
});
it.each(["203.0.113.7", "203.0.113.0/24", "2001:db8::/48", "home.example.com"])(
  "config accepts %s",
  (value) => {
    expect(
      configSchema.parse({ allowlist: [{ ...entry, value }] }).allowlist.entries[0]?.scope,
    ).toEqual(["*"]);
  },
);
it.each([59, 86401, 300.5])("rejects interval %s", (resolve_interval_s) => {
  expect(configSchema.safeParse({ allowlist: { resolve_interval_s } }).success).toBe(false);
});
it("imports by id, preserves lifecycle and cached DNS, and retains removed entries", () => {
  const config = configSchema.parse({ allowlist: [entry] });
  syncAllowlist(store, config, 100);
  store.db
    .update(schema.allowlist)
    .set({ revokedAt: 0, lastMatchedAt: 200, resolvedAt: 150, resolved: ["203.0.113.1"] })
    .run();
  syncAllowlist(store, configSchema.parse({ allowlist: [{ ...entry, label: "Updated" }] }), 300);
  syncAllowlist(store, configSchema.parse({}), 400);
  expect(store.db.select().from(schema.allowlist).get()).toMatchObject({
    label: "Updated",
    source: "config",
    createdAt: 100,
    revokedAt: 0,
    lastMatchedAt: 200,
    resolvedAt: 150,
    resolved: ["203.0.113.1"],
  });
  syncAllowlist(
    store,
    configSchema.parse({ allowlist: [{ ...entry, value: "new.example.com" }] }),
    500,
  );
  expect(store.db.select().from(schema.allowlist).get()?.resolved).toEqual([]);
  expect(configSchema.safeParse({ allowlist: [entry, entry] }).success).toBe(false);
});
it("resolves both families immediately and periodically, without overlapping; stop cancels ticks", async () => {
  vi.useFakeTimers();
  syncAllowlist(store, configSchema.parse({ allowlist: [entry] }));
  const dns = {
    resolve4: vi.fn().mockResolvedValue(["203.0.113.1"]),
    resolve6: vi.fn().mockResolvedValue(["2001:db8::1"]),
  };
  const resolver = new AllowlistResolver(store, 300, dns, () => 100);
  const initial = resolver.start();
  expect(resolver.refresh()).toBe(initial);
  await initial;
  expect(store.db.select().from(schema.allowlist).get()).toMatchObject({
    resolved: ["203.0.113.1", "2001:db8::1"],
    resolvedAt: 100,
  });
  await vi.advanceTimersByTimeAsync(300000);
  expect(dns.resolve4).toHaveBeenCalledTimes(2);
  expect(dns.resolve6).toHaveBeenCalledTimes(2);
  await resolver.stop();
  await vi.advanceTimersByTimeAsync(300000);
  expect(dns.resolve4).toHaveBeenCalledTimes(2);
});
it.each(["ETIMEOUT", "ENOTFOUND", "SERVFAIL"])(
  "preserves old results on %s including partial failures",
  async (code) => {
    syncAllowlist(store, configSchema.parse({ allowlist: [entry] }));
    store.db
      .update(schema.allowlist)
      .set({ resolved: ["203.0.113.1", "2001:db8::1"], resolvedAt: 100 })
      .run();
    const resolver = new AllowlistResolver(store, 300, {
      resolve4: vi.fn().mockResolvedValue(["203.0.113.2"]),
      resolve6: vi.fn().mockRejectedValue({ code }),
    });
    await resolver.refresh();
    expect(store.db.select().from(schema.allowlist).get()).toMatchObject({
      resolved: ["203.0.113.1", "2001:db8::1"],
      resolvedAt: 100,
    });
    expect(store.db.select().from(schema.botEvents).get()?.event).toBe(
      "allowlist_resolve_failed:home",
    );
  },
);
it("allows single-family hosts and skips revoked entries", async () => {
  syncAllowlist(store, configSchema.parse({ allowlist: [entry, { ...entry, id: "revoked" }] }));
  store.db
    .update(schema.allowlist)
    .set({ revokedAt: 0 })
    .where(eq(schema.allowlist.id, "revoked"))
    .run();
  const dns = {
    resolve4: vi.fn().mockResolvedValue(["203.0.113.1"]),
    resolve6: vi.fn().mockRejectedValue({ code: "ENODATA" }),
  };
  await new AllowlistResolver(store, 300, dns).refresh();
  expect(dns.resolve4).toHaveBeenCalledTimes(1);
  expect(
    store.db.select().from(schema.allowlist).where(eq(schema.allowlist.id, "home")).get()?.resolved,
  ).toEqual(["203.0.113.1"]);
});
it.each([false, true])(
  "audits allowlist and leaves observe behavior intact (%s)",
  async (observe_mode) => {
    const config = configSchema.parse({
      observe_mode,
      resources: [{ slug: "/private", kind: "inline", source: "EXAMPLE" }],
      allowlist: [{ ...entry, value: "203.0.113.7" }],
    });
    syncResources(store, config);
    syncAllowlist(store, config);
    const app = createApp({
      store,
      config,
      secrets: {
        telegramToken: "",
        sessionSecret: "EXAMPLE_SESSION_SECRET_32_CHARACTERS",
        tokenPepper: "",
      },
      now: () => 100,
    });
    const peer = { incoming: { socket: { remoteAddress: "203.0.113.7" } } as IncomingMessage };
    expect((await app.request("http://example.com/private", {}, peer)).status).toBe(200);
    expect(store.db.select().from(schema.requests).get()).toMatchObject({
      decision: "allow_allowlist",
      grantId: null,
      allowlistId: "home",
    });
    expect(store.db.select().from(schema.allowlist).get()?.lastMatchedAt).toBe(100);
    store.db.update(schema.allowlist).set({ revokedAt: 0 }).run();
    expect((await app.request("http://example.com/private", {}, peer)).status).toBe(
      observe_mode ? 200 : 403,
    );
  },
);
it("upgrades historical requests and approvals with foreign keys and append-only audit intact", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys = ON");
    for (const file of ["0000_initial", "0001_admin", "0002_ip_geo"])
      db.exec(readFileSync(new URL(`../drizzle/${file}.sql`, import.meta.url), "utf8"));
    db.exec(
      "INSERT INTO requests (id,ts,ip,ua,client_family,method,path,decision,status,bytes,latency_ms,source) VALUES ('old',1,'203.0.113.1','','curl','GET','/private','deny_pending',403,0,0,'app')",
    );
    db.exec(
      "INSERT INTO approvals VALUES ('approval','old','203.0.113.1',NULL,'allow','command',600,1)",
    );
    db.transaction(() =>
      db.exec(readFileSync(new URL("../drizzle/0003_allowlist.sql", import.meta.url), "utf8")),
    )();
    expect(db.prepare("SELECT id, allowlist_id FROM requests").get()).toEqual({
      id: "old",
      allowlist_id: null,
    });
    expect(db.prepare("SELECT request_id FROM approvals").get()).toEqual({ request_id: "old" });
    expect(db.pragma("foreign_key_check")).toEqual([]);
    expect(() => db.exec("DELETE FROM requests")).toThrow("append-only");
    expect(() => db.exec("UPDATE requests SET ip='203.0.113.2'")).toThrow("append-only");
  } finally {
    db.close();
  }
});
