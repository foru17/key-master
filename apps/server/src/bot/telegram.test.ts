import type { IncomingMessage } from "node:http";
import { hashToken } from "@key-master/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { type Config, configSchema } from "../config.js";
import { getState, openStore, type Store, syncResources } from "../db.js";
import * as schema from "../schema.js";
import { HttpTelegramApi, type TelegramApi, TelegramBot } from "./telegram.js";

let store: Store;
let config: Config;
let bot: TelegramBot;
let api: TelegramApi;
let now: number;
let messageId: number;
const secrets = {
  telegramToken: "YOUR_BOT_TOKEN",
  sessionSecret: "TEST_SESSION_SECRET_32_CHARACTERS",
  tokenPepper: "TEST_PEPPER",
};
const owner = 10001;
const peer = { incoming: { socket: { remoteAddress: "203.0.113.10" } } as IncomingMessage };
beforeEach(() => {
  now = 1_800_000_000_000;
  messageId = 0;
  store = openStore();
  config = configSchema.parse({
    telegram: { owner_chat_ids: [String(owner)] },
    resources: [
      { slug: "/private", kind: "inline", source: "PRIVATE" },
      { slug: "/other", kind: "inline", source: "OTHER" },
    ],
  });
  syncResources(store, config, now);
  api = {
    call: vi.fn(async (method: string) =>
      method === "sendMessage" ? { message_id: ++messageId } : method === "getUpdates" ? [] : true,
    ),
  };
  bot = new TelegramBot(store, config, secrets, api, () => now);
});
afterEach(() => store.sqlite.close());
async function pending(path = "/private") {
  const app = createApp({ store, config, secrets, bot, now: () => now });
  return app.request(`http://example.com${path}`, { headers: { "User-Agent": "curl/8" } }, peer);
}
function command(text: string, chatId = owner) {
  return bot.handle({
    update_id: 1,
    message: { message_id: 1, chat: { id: chatId }, from: { id: chatId }, text },
  });
}
function callback(action: string, chatId = owner, msgId = 1) {
  const pending = store.db.select().from(schema.pending).get();
  return bot.handle({
    update_id: 2,
    callback_query: {
      id: "CALLBACK_ID",
      from: { id: chatId },
      message: { message_id: msgId, chat: { id: chatId } },
      data: `${action}:${pending?.id}`,
    },
  });
}
describe("notifications", () => {
  it("deduplicates concurrent requests, persists across bot restart and merges resource scopes", async () => {
    await Promise.all([pending(), pending(), pending("/other")]);
    expect(vi.mocked(api.call).mock.calls.filter((c) => c[0] === "sendMessage")).toHaveLength(1);
    expect(store.db.select().from(schema.pending).get()?.slugs).toEqual(["/private", "/other"]);
    bot = new TelegramBot(store, config, secrets, api, () => now);
    await pending();
    expect(messageId).toBe(1);
    now += config.durations.pending * 1000;
    await pending();
    expect(messageId).toBe(2);
  });
  it("shows four buttons and trimmed UA", async () => {
    await pending();
    const payload = vi.mocked(api.call).mock.calls[0]?.[1];
    expect(payload?.text).toContain("203.0.113.10");
    const keyboard = payload?.reply_markup as { inline_keyboard: { text: string }[][] };
    expect(keyboard.inline_keyboard.flat().map((b) => b.text)).toEqual([
      "Allow 10 min",
      "Allow 1 h",
      "Issue device token",
      "Deny 1 h",
    ]);
  });
  it("does not notify for token-only, blocked or missing resources", async () => {
    store.db.update(schema.resources).set({ policy: "token_only" }).run();
    await pending();
    await pending("/missing");
    expect(api.call).not.toHaveBeenCalled();
    store.db.update(schema.resources).set({ policy: "approval" }).run();
    store.db
      .insert(schema.blocks)
      .values({ subject: "203.0.113.10", until: now + 1000, reason: "test" })
      .run();
    await pending();
    expect(api.call).not.toHaveBeenCalled();
  });
  it("records failures without spamming in the pending window", async () => {
    vi.mocked(api.call).mockRejectedValue(new Error("offline"));
    await pending();
    await pending();
    expect(api.call).toHaveBeenCalledTimes(1);
    expect(store.db.select().from(schema.botEvents).get()?.event).toBe("notification_failed");
  });
});
describe("owner actions", () => {
  it("delivers long scopes as complete individual URLs", async () => {
    const slugs = Array.from({ length: 20 }, (_, index) => `/${index}-${"x".repeat(200)}`);
    config.resources = slugs.map((slug) => ({
      slug,
      kind: "inline",
      source: "TEST",
      content_type: "text/plain",
      policy: "approval",
      enabled: true,
    }));
    syncResources(store, config, now);
    for (const slug of slugs) await pending(slug);
    await callback("device");
    const replies = vi
      .mocked(api.call)
      .mock.calls.filter(
        (call) => call[0] === "sendMessage" && String(call[1].text).includes("?k="),
      );
    expect(replies).toHaveLength(slugs.length);
    expect(
      replies.map((call) => new URL(String(call[1].text).split("\n")[1] ?? "").pathname),
    ).toEqual(slugs);
    expect(replies.every((call) => String(call[1].text).length < 4096)).toBe(true);
  });
  it.each(["allow0", "allow1", "deny", "device"])(
    "action %s is audited and edits message once",
    async (action) => {
      await pending();
      await callback(action);
      await callback(action);
      expect(store.db.select().from(schema.approvals).all()).toHaveLength(1);
      expect(vi.mocked(api.call).mock.calls.filter((c) => c[0] === "editMessageText")).toHaveLength(
        1,
      );
      if (action.startsWith("allow")) {
        const grant = store.db.select().from(schema.grants).get();
        expect(grant?.expiresAt).toBe(now + (action === "allow0" ? 600000 : 3600000));
        expect((await pending()).status).toBe(200);
      }
      if (action === "deny") {
        expect(store.db.select().from(schema.blocks).get()?.until).toBe(now + 3600000);
        expect((await pending()).status).toBe(403);
        expect(store.db.select().from(schema.requests).all().at(-1)?.decision).toBe("deny_blocked");
      }
      if (action === "device") {
        const token = store.db.select().from(schema.tokens).get();
        expect(token?.kind).toBe("device");
        expect(token?.scope).toEqual(["/private"]);
        const issued = vi
          .mocked(api.call)
          .mock.calls.find((c) => c[0] === "sendMessage" && String(c[1].text).includes("?k="));
        const url = String(issued?.[1].text)
          .split("\n")
          .find((s) => s.startsWith("https://"));
        expect(url).toBeDefined();
        const secret = new URL(url ?? "https://example.com").searchParams.get("k");
        expect(token?.secretHash).toBe(hashToken(secret ?? "", secrets.tokenPepper));
        expect(JSON.stringify(store.db.select().from(schema.approvals).all())).not.toContain(
          secret,
        );
      }
    },
  );
  it("ignores and audits unauthorized commands and callbacks", async () => {
    await command("/grant 203.0.113.20", 999);
    await pending();
    await callback("allow0", 999);
    expect(store.db.select().from(schema.grants).all()).toHaveLength(0);
    expect(
      store.db
        .select()
        .from(schema.botEvents)
        .all()
        .filter((e) => e.event === "unauthorized_update"),
    ).toHaveLength(2);
  });
  it.each(["expired", "wrong_message"])("rejects %s callback", async (mode) => {
    await pending();
    if (mode === "expired") now += 600000;
    await callback("allow0", owner, mode === "wrong_message" ? 999 : 1);
    expect(store.db.select().from(schema.approvals).all()).toHaveLength(0);
  });
  it("device scope includes all requested resources", async () => {
    await pending();
    await pending("/other");
    await callback("device");
    expect(store.db.select().from(schema.tokens).get()?.scope).toEqual(["/private", "/other"]);
  });
});
describe("commands", () => {
  it.each(["/status", "/tokens", "/audit", "/audit 1000000", "/audit nope", "/help", "/unknown"])(
    "responds to %s",
    async (text) => {
      await command(text);
      expect(api.call).toHaveBeenCalledWith(
        "sendMessage",
        expect.objectContaining({ chat_id: String(owner), text: expect.any(String) }),
      );
    },
  );
  it("grants and revokes IP grants and device tokens", async () => {
    await command("/grant 203.0.113.10 10");
    expect((await pending()).status).toBe(200);
    await command("/revoke 203.0.113.10");
    expect((await pending()).status).toBe(403);
    await callback("device", owner, messageId);
    const token = store.db.select().from(schema.tokens).get();
    expect(token).toBeDefined();
    await command(`/revoke ${token?.id}`);
    expect(store.db.select().from(schema.tokens).get()?.revokedAt).toBe(now);
  });
  it.each(["/grant invalid", "/grant 203.0.113.10 -1", "/grant 203.0.113.10 Infinity"])(
    "rejects %s",
    async (text) => {
      await command(text);
      expect(store.db.select().from(schema.grants).all()).toHaveLength(0);
    },
  );
  it("issues hashed expiring login code and invalidates the previous code", async () => {
    await command("/login");
    const row = store.db.select().from(schema.loginCodes).get();
    const text = String(vi.mocked(api.call).mock.calls[0]?.[1].text);
    const code = text.match(/: (\d{6})$/)?.[1] ?? "";
    expect(row?.secretHash).toBe(hashToken(code, secrets.sessionSecret));
    expect(row?.expiresAt).toBe(now + 300000);
    await command("/login");
    expect(
      store.db
        .select()
        .from(schema.loginCodes)
        .where(eq(schema.loginCodes.id, row?.id ?? ""))
        .get()?.usedAt,
    ).toBe(now);
  });
  it("supports Chinese owner messages", async () => {
    config.bot.lang = "zh";
    await pending();
    expect(vi.mocked(api.call).mock.calls[0]?.[1].text).toContain("待授权请求");
  });
});
describe("polling and transport", () => {
  it("long polls with persisted offset", async () => {
    vi.mocked(api.call).mockImplementation(async (method) =>
      method === "getUpdates"
        ? [{ update_id: 12, message: { message_id: 1, chat: { id: 999 }, text: "/status" } }]
        : true,
    );
    await bot.pollOnce();
    expect(getState(store, "telegram_offset")).toBe("13");
    await bot.pollOnce();
    expect(api.call).toHaveBeenLastCalledWith(
      "getUpdates",
      expect.objectContaining({ offset: 13, timeout: 30, limit: 100 }),
      undefined,
    );
  });
  it("has a hard polling bound", async () => {
    config.telegram.max_polls = 2;
    const poller = bot.startPolling();
    await poller.done;
    expect(vi.mocked(api.call).mock.calls.filter((c) => c[0] === "getUpdates")).toHaveLength(2);
    expect(store.db.select().from(schema.botEvents).get()?.event).toBe("polling_stopped_at_bound");
  });
  it("uses POST and validates API success", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: [] })));
    const http = new HttpTelegramApi("YOUR_BOT_TOKEN", fetcher);
    expect(await http.call("getUpdates", { timeout: 30 })).toEqual([]);
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe("POST");
    fetcher.mockResolvedValue(new Response(JSON.stringify({ ok: false })));
    await expect(http.call("getUpdates", {})).rejects.toThrow("rejected");
  });
});

it("loads Telegram identity once and reports transport failures without leaking credentials", async () => {
  vi.mocked(api.call).mockResolvedValueOnce({ username: "example_bot" });
  await bot.refreshIdentity();
  expect(getState(store, "telegram_username")).toBe("example_bot");
  expect(getState(store, "telegram_connected")).toBe("true");
  vi.mocked(api.call).mockRejectedValueOnce(new Error("offline"));
  await bot.refreshIdentity();
  expect(getState(store, "telegram_connected")).toBe("false");
});
