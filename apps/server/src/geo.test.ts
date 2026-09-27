import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingRequest } from "./app.js";
import { TelegramBot } from "./bot/telegram.js";
import { type Config, configSchema } from "./config.js";
import { openStore, type Store } from "./db.js";
import { flag, GeoService } from "./geo.js";
import * as schema from "./schema.js";

// 2001:4860::/32 and 8.8.8.0/24 are public ranges; the online endpoint is a stub, nothing leaves the test.
const PUBLIC_V4 = "8.8.8.8";
const PUBLIC_V6 = "2001:4860:4860::8888";
const payload = {
  country: "hk",
  country_name: "Hong Kong",
  city: "",
  asn: "9231",
  as_name: "Example Mobile Hong Kong",
  as_domain: "example.com",
  continent: "AS",
};
let store: Store;
let now: number;
const make = (geo: Partial<Config["geo"]>, fetchImpl: typeof fetch) => {
  const config = configSchema.parse({
    geo: { provider: "online", online_url: "https://geo.example.com/lookup", ...geo },
  });
  return { config, service: new GeoService(store, config, fetchImpl, () => now) };
};
const json = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch &
    ReturnType<typeof vi.fn>;

beforeEach(() => {
  store = openStore();
  now = 1_800_000_000_000;
});
afterEach(() => store.sqlite.close());

describe("GeoService", () => {
  it("maps the neko-compatible JSON shape and appends ?ip=", async () => {
    const fetchImpl = json(payload);
    const { service } = make({}, fetchImpl);
    expect(await service.lookup(PUBLIC_V4)).toEqual({
      ip: PUBLIC_V4,
      scope: "public",
      country: "HK",
      countryName: "Hong Kong",
      city: null,
      continent: "AS",
      asn: "AS9231",
      asName: "Example Mobile Hong Kong",
      asDomain: "example.com",
      source: "online",
    });
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://geo.example.com/lookup?ip=${PUBLIC_V4}`,
    );
  });
  it("supports an {ip} placeholder and keeps other query parameters", async () => {
    const fetchImpl = json(payload);
    const { service } = make({ online_url: "https://geo.example.com/q/{ip}?lang=en" }, fetchImpl);
    await service.lookup(PUBLIC_V6);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe(
      `https://geo.example.com/q/${encodeURIComponent(PUBLIC_V6)}?lang=en`,
    );
  });
  it.each([
    ["10.0.0.8", "private"],
    ["100.100.1.1", "cgnat"],
    ["127.0.0.1", "loopback"],
    ["203.0.113.10", "reserved"],
  ])("never sends %s (%s) to the provider", async (ip, scope) => {
    const fetchImpl = json(payload);
    const { service } = make({}, fetchImpl);
    expect(await service.lookup(ip)).toMatchObject({ ip, scope, source: "none", country: null });
    expect(service.cached(ip)).toMatchObject({ scope, source: "none" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("does nothing when the provider is off", async () => {
    const fetchImpl = json(payload);
    const config = configSchema.parse({});
    const service = new GeoService(store, config, fetchImpl, () => now);
    expect(await service.lookup(PUBLIC_V4)).toMatchObject({ scope: "public", source: "none" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("persists results, serves them from SQLite across instances, and expires them", async () => {
    const fetchImpl = json(payload);
    await make({}, fetchImpl).service.lookup(PUBLIC_V4);
    expect(store.db.select().from(schema.ipGeo).all()).toHaveLength(1);
    const second = make({ cache_days: 7 }, fetchImpl).service;
    expect(second.cached(PUBLIC_V4)).toMatchObject({ country: "HK", source: "online" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 8 * 86400000;
    const third = make({ cache_days: 7 }, fetchImpl).service;
    expect(third.cached(PUBLIC_V4)).toBeNull();
  });
  it("deduplicates concurrent lookups for the same address", async () => {
    const fetchImpl = json(payload);
    const { service } = make({}, fetchImpl);
    await Promise.all([
      service.lookup(PUBLIC_V4),
      service.lookup(PUBLIC_V4),
      service.lookup(PUBLIC_V4),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("cools down after a failure instead of hammering the provider", async () => {
    const fetchImpl = json({}, 500);
    const { service } = make({}, fetchImpl);
    expect(await service.lookup(PUBLIC_V4)).toMatchObject({ source: "none" });
    expect(await service.lookup(PUBLIC_V4)).toMatchObject({ source: "none" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    now += 31 * 60 * 1000;
    await service.lookup(PUBLIC_V4);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("returns within the wait budget even when the provider hangs", async () => {
    const hanging = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const { service } = make({ timeout_ms: 100 }, hanging);
    const started = Date.now();
    expect(await service.lookup(PUBLIC_V4, 50)).toMatchObject({ source: "none" });
    expect(Date.now() - started).toBeLessThan(1000);
  });
  it("cached() starts a background lookup and fills in later", async () => {
    const fetchImpl = json(payload);
    const { service } = make({}, fetchImpl);
    expect(service.cached(PUBLIC_V4)).toBeNull();
    await vi.waitFor(() => expect(service.cached(PUBLIC_V4)).toMatchObject({ country: "HK" }));
  });
  it("marks provider-reserved answers without inventing a location", async () => {
    const { service } = make({}, json({ reserved: true }));
    expect(await service.lookup(PUBLIC_V4)).toMatchObject({
      country: null,
      countryName: "Reserved",
    });
  });
  it("rejects configs that enable a provider without its source", () => {
    expect(() => configSchema.parse({ geo: { provider: "online" } })).toThrow();
    expect(() => configSchema.parse({ geo: { provider: "mmdb" } })).toThrow();
  });
  it.each([
    ["HK", "🇭🇰"],
    ["US", "🇺🇸"],
    [null, ""],
    ["hk", ""],
  ])("flag(%s)", (code, emoji) => expect(flag(code)).toBe(emoji));
});

describe("approval message", () => {
  const request: PendingRequest = {
    requestId: "01TESTREQUEST",
    ip: PUBLIC_V4,
    family: "shadowrocket",
    ua: "Shadowrocket/3378 CFNetwork/3886.100.1 Darwin/27.0.0 iPhone18,3",
    slug: "/private",
    now: 1_800_000_000_000,
  };
  const send = async (lang: "zh" | "en", geo: Partial<Config["geo"]> = {}) => {
    const config = configSchema.parse({
      telegram: { owner_chat_ids: ["10001"] },
      bot: { lang },
      notice: { timezone: "Asia/Shanghai" },
      geo: { provider: "online", online_url: "https://geo.example.com/lookup", ...geo },
      resources: [{ slug: "/private", kind: "inline", source: "PRIVATE" }],
    });
    const calls: Record<string, unknown>[] = [];
    const api = {
      call: vi.fn(async (method: string, body: Record<string, unknown>) => {
        if (method === "sendMessage") calls.push(body);
        return { message_id: 1 };
      }),
    };
    const service = new GeoService(store, config, json(payload), () => now);
    const secrets = { telegramToken: "x", sessionSecret: "x".repeat(32), tokenPepper: "" };
    await new TelegramBot(store, config, secrets, api, () => now, service).notify(request);
    return String(calls[0]?.text);
  };
  it("shows location, network and a parsed client in Chinese", async () => {
    const text = await send("zh");
    expect(text).toContain("资源：/private");
    expect(text).toContain("位置：🇭🇰 香港");
    expect(text).toContain("网络：AS9231 · Example Mobile Hong Kong · example.com");
    expect(text).toContain("客户端：Shadowrocket 3378（代理客户端）");
    expect(text).toContain("系统 / 设备：iOS (Darwin 27.0.0) · iPhone18,3");
    expect(text).toContain("(Asia/Shanghai)");
    expect(text).toContain("UA: Shadowrocket/3378");
  });
  it("uses English labels and region names", async () => {
    const text = await send("en");
    expect(text).toContain("Location: 🇭🇰 Hong Kong");
    expect(text).toContain("Client: Shadowrocket 3378 (proxy client)");
  });
  it("labels non-public sources instead of looking them up", async () => {
    const text = await send("zh");
    expect(text).not.toContain("内网");
    const config = configSchema.parse({
      telegram: { owner_chat_ids: ["10001"] },
      bot: { lang: "zh" },
      resources: [{ slug: "/private", kind: "inline", source: "PRIVATE" }],
    });
    const calls: string[] = [];
    const api = {
      call: vi.fn(async (method: string, body: Record<string, unknown>) => {
        if (method === "sendMessage") calls.push(String(body.text));
        return { message_id: 1 };
      }),
    };
    const secrets = { telegramToken: "x", sessionSecret: "x".repeat(32), tokenPepper: "" };
    await new TelegramBot(store, config, secrets, api, () => now).notify({
      ...request,
      requestId: "01TESTREQUEST2",
      ip: "100.100.1.1",
    });
    expect(calls[0]).toContain("位置：Tailscale / CGNAT");
    expect(calls[0]).not.toContain("网络：");
  });
});
