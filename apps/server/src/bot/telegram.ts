import { setTimeout as delay } from "node:timers/promises";
import { describeUserAgent, normalizeIp } from "@key-master/core";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import { z } from "zod";
import type { PendingRequest } from "../app.js";
import { recordPending, resolveApproval } from "../approval.js";
import { createLoginCode } from "../auth.js";
import type { Config, Secrets } from "../config.js";
import { getState, type Store, setState } from "../db.js";
import { flag, GeoService } from "../geo.js";
import * as schema from "../schema.js";
export interface TelegramApi {
  call(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}
export class HttpTelegramApi implements TelegramApi {
  constructor(
    private token: string,
    private fetcher: typeof fetch = fetch,
  ) {}
  async call(
    method: string,
    payload: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeout = AbortSignal.timeout(40000);
    const response = await this.fetcher(`https://api.telegram.org/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
    const result = z
      .object({ ok: z.boolean(), result: z.unknown().optional() })
      .parse(await response.json());
    if (!result.ok) throw new Error("Telegram API rejected request");
    return result.result;
  }
}
const user = z.object({ id: z.number() });
const message = z.object({
  message_id: z.number(),
  chat: z.object({ id: z.number() }),
  from: user.optional(),
  text: z.string().optional(),
});
const updateSchema = z.object({
  update_id: z.number().int(),
  message: message.optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: user,
      message: message.optional(),
      data: z.string().optional(),
    })
    .optional(),
});
export class TelegramBot {
  constructor(
    private store: Store,
    private config: Config,
    private secrets: Secrets,
    private api: TelegramApi,
    private clock: () => number = Date.now,
    private geo: GeoService = new GeoService(store, config),
  ) {}
  private text(en: string, zh: string) {
    return this.config.bot.lang === "zh" ? zh : en;
  }
  private event(actor: string, event: string) {
    this.store.db
      .insert(schema.botEvents)
      .values({ id: ulid(), ts: this.clock(), actor, event })
      .run();
  }
  private async send(chatId: string, text: string, extra: Record<string, unknown> = {}) {
    return this.api.call("sendMessage", { chat_id: chatId, text: text.slice(0, 3900), ...extra });
  }
  async refreshIdentity() {
    try {
      const identity = z
        .object({ username: z.string().max(100) })
        .parse(await this.api.call("getMe", {}));
      setState(this.store, "telegram_username", identity.username);
      setState(this.store, "telegram_connected", "true");
    } catch {
      setState(this.store, "telegram_connected", "false");
      this.event("system", "identity_failed");
    }
  }
  async sendLoginCode(code: string) {
    let delivered = false;
    for (const chatId of this.config.telegram.owner_chat_ids.slice(0, 20)) {
      try {
        await this.send(
          chatId,
          `${this.text("One-time login code (5 minutes)", "一次性登录验证码（5 分钟有效）")}: ${code}`,
        );
        delivered = true;
      } catch {
        this.event(chatId, "login_delivery_failed");
      }
    }
    if (!delivered) throw new Error("Telegram unavailable");
  }
  private async approvalMessage(request: PendingRequest): Promise<string> {
    const zh = this.config.bot.lang === "zh";
    const info = await this.geo.lookup(request.ip);
    const client = describeUserAgent(request.ua);
    const kinds: Record<string, [string, string]> = {
      proxy: ["proxy client", "代理客户端"],
      browser: ["browser", "浏览器"],
      system: ["system networking", "系统网络组件"],
      tool: ["script / CLI", "脚本 / 命令行"],
      preview: ["link preview bot", "链接预览机器人"],
      crawler: ["crawler", "爬虫"],
      scanner: ["scanner", "扫描器"],
      unknown: ["unknown", "未知"],
    };
    const scopes: Record<string, [string, string]> = {
      private: ["private network", "内网"],
      loopback: ["this host", "本机"],
      cgnat: ["Tailscale / CGNAT", "Tailscale / CGNAT"],
      link_local: ["link-local", "链路本地"],
      reserved: ["reserved address", "保留地址"],
      invalid: ["invalid address", "无效地址"],
    };
    const pick = (pair: [string, string] | undefined) => (pair ? (zh ? pair[1] : pair[0]) : "");
    const label = (en: string, cn: string) => (zh ? `${cn}：` : `${en}: `);
    let country = info.countryName ?? info.country;
    if (info.country) {
      try {
        country =
          new Intl.DisplayNames([zh ? "zh-CN" : "en"], { type: "region", style: "short" }).of(
            info.country,
          ) ?? country;
      } catch {}
    }
    const lines = [`🔐 ${this.text("Approval requested", "待授权请求")}`];
    lines.push(`${label("Resource", "资源")}${request.slug}`);
    lines.push(`${label("IP", "IP")}${request.ip}`);
    if (info.scope !== "public")
      lines.push(`${label("Location", "位置")}${pick(scopes[info.scope])}`);
    else if (country || info.city)
      lines.push(
        `${label("Location", "位置")}${[flag(info.country), [country, info.city].filter(Boolean).join(" · ")].filter(Boolean).join(" ")}`,
      );
    const network = [info.asn, info.asName, info.asDomain].filter(Boolean).join(" · ");
    if (network) lines.push(`${label("Network", "网络")}${network}`);
    const kind = pick(kinds[client.kind]);
    const name = [client.name, client.version].filter(Boolean).join(" ");
    lines.push(`${label("Client", "客户端")}${zh ? `${name}（${kind}）` : `${name} (${kind})`}`);
    const platform = [
      client.os && client.osVersion?.startsWith("Darwin ")
        ? `${client.os} (${client.osVersion})`
        : [client.os, client.osVersion].filter(Boolean).join(" "),
      client.device,
    ].filter(Boolean);
    if (platform.length) lines.push(`${label("Platform", "系统 / 设备")}${platform.join(" · ")}`);
    lines.push(`UA: ${request.ua.slice(0, 300) || "—"}`);
    let when = new Date(request.now).toISOString();
    try {
      when = `${new Intl.DateTimeFormat(zh ? "zh-CN" : "en-GB", {
        timeZone: this.config.notice.timezone,
        dateStyle: "short",
        timeStyle: "medium",
        hour12: false,
      }).format(request.now)} (${this.config.notice.timezone})`;
    } catch {}
    lines.push(`${label("Time", "时间")}${when}`);
    lines.push(`ID: ${request.requestId}`);
    return lines.join("\n");
  }
  async notify(request: PendingRequest): Promise<void> {
    const pending = recordPending(this.store, this.config, request);
    if (!pending) return;
    const buttons = [
      {
        text: this.text(
          `Allow ${this.config.durations.options[0] / 60} min`,
          `允许 ${this.config.durations.options[0] / 60} 分钟`,
        ),
        callback_data: `allow0:${pending.id}`,
      },
      {
        text: this.text(
          `Allow ${this.config.durations.options[1] / 3600} h`,
          `允许 ${this.config.durations.options[1] / 3600} 小时`,
        ),
        callback_data: `allow1:${pending.id}`,
      },
      {
        text: this.text("Issue device token", "签发设备令牌"),
        callback_data: `device:${pending.id}`,
      },
      {
        text: this.text(
          `Deny ${this.config.durations.block / 3600} h`,
          `拒绝 ${this.config.durations.block / 3600} 小时`,
        ),
        callback_data: `deny:${pending.id}`,
      },
    ];
    const message = await this.approvalMessage(request);
    for (const chatId of this.config.telegram.owner_chat_ids.slice(0, 20)) {
      try {
        const result = z.object({ message_id: z.number() }).parse(
          await this.send(chatId, message, {
            reply_markup: { inline_keyboard: [buttons.slice(0, 2), buttons.slice(2)] },
          }),
        );
        pending.messages.push({ chatId, messageId: result.message_id });
        this.store.db
          .update(schema.pending)
          .set({ messages: pending.messages })
          .where(eq(schema.pending.id, pending.id))
          .run();
      } catch {
        this.event(chatId, "notification_failed");
      }
    }
  }
  async handle(raw: unknown): Promise<void> {
    const parsed = updateSchema.safeParse(raw);
    if (!parsed.success) {
      this.event("unknown", "invalid_update");
      return;
    }
    const update = parsed.data;
    const msg = update.callback_query?.message ?? update.message;
    const chatId = msg ? String(msg.chat.id) : "";
    if (!this.config.telegram.owner_chat_ids.includes(chatId)) {
      this.event(chatId || "unknown", "unauthorized_update");
      return;
    }
    const actor = `telegram:${update.callback_query?.from.id ?? msg?.from?.id ?? chatId}`;
    if (update.callback_query) {
      const callback = update.callback_query;
      const match = /^(allow0|allow1|device|deny):([0-9A-HJKMNP-TV-Z]{26})$/.exec(
        callback.data ?? "",
      );
      const pending = match
        ? this.store.db
            .select()
            .from(schema.pending)
            .where(eq(schema.pending.id, match[2] ?? ""))
            .get()
        : undefined;
      if (
        !pending ||
        pending.resolvedAt !== null ||
        pending.expiresAt <= this.clock() ||
        !pending.messages.some((m) => m.chatId === chatId && m.messageId === msg?.message_id)
      ) {
        this.event(actor, "invalid_or_expired_callback");
        await this.api.call("answerCallbackQuery", {
          callback_query_id: callback.id,
          text: this.text("Expired or already handled", "已过期或已处理"),
        });
        return;
      }
      const action = match?.[1];
      const now = this.clock();
      let secret: string | undefined;
      const duration =
        action === "deny"
          ? this.config.durations.block
          : action === "allow0"
            ? this.config.durations.options[0]
            : action === "allow1"
              ? this.config.durations.options[1]
              : 0;
      const resolved = resolveApproval(
        this.store,
        this.secrets,
        {
          id: pending.id,
          action: action === "device" ? "device_token" : action === "deny" ? "deny" : "allow",
          duration,
          actor,
          ...(msg ? { messageId: msg.message_id } : {}),
        },
        now,
      );
      if (!resolved) return;
      secret = resolved.token?.secret;
      const outcome =
        action === "device"
          ? this.text("Device token issued", "设备令牌已签发")
          : action === "deny"
            ? this.text("Denied", "已拒绝")
            : this.text("Allowed", "已允许");
      this.event(actor, `approval_${action}`);
      if (secret) {
        const links = pending.slugs.map((slug) => {
          const url = new URL(slug, this.config.public_base_url);
          url.searchParams.set("k", secret ?? "");
          return url.href;
        });
        try {
          for (const link of links.slice(0, 10000)) await this.send(chatId, `${outcome}\n${link}`);
        } catch {
          this.event(actor, "device_delivery_failed_revoke_and_reissue");
        }
      }
      for (const target of pending.messages.slice(0, 20)) {
        try {
          await this.api.call("editMessageText", {
            chat_id: target.chatId,
            message_id: target.messageId,
            text: `${outcome} · ${duration}s\n${pending.subject}\n${pending.slugs.join(", ")}\n${actor}`.slice(
              0,
              3900,
            ),
            reply_markup: { inline_keyboard: [] },
          });
        } catch {
          this.event(actor, "edit_failed");
        }
      }
      await this.api.call("answerCallbackQuery", { callback_query_id: callback.id, text: outcome });
      return;
    }
    const parts = (msg?.text ?? "").trim().split(/\s+/);
    const command = parts[0]?.split("@")[0];
    const arg = parts[1];
    const now = this.clock();
    this.event(actor, `command_${command?.replace(/[^a-z/]/g, "").slice(0, 32) ?? "unknown"}`);
    switch (command) {
      case "/help":
        await this.send(
          chatId,
          this.text("Commands", "命令") +
            "\n/status\n/grant <ip> [minutes]\n/revoke <ip|token id>\n/tokens\n/audit [n]\n/login\n/help",
        );
        break;
      case "/status": {
        const active = this.store.db
          .select()
          .from(schema.grants)
          .where(and(gt(schema.grants.expiresAt, now), isNull(schema.grants.revokedAt)))
          .all();
        const blocked = this.store.db
          .select()
          .from(schema.blocks)
          .where(gt(schema.blocks.until, now))
          .all();
        const pending = this.store.db
          .select()
          .from(schema.pending)
          .where(and(gt(schema.pending.expiresAt, now), isNull(schema.pending.resolvedAt)))
          .all();
        const zh = this.config.bot.lang === "zh";
        const where = (subject: string) => {
          const ip = subject.split("|")[0] ?? subject;
          const info = this.geo.cached(ip);
          if (!info) return "";
          if (info.scope !== "public")
            return info.scope === "cgnat" ? "Tailscale / CGNAT" : info.scope;
          let country = info.countryName ?? info.country ?? "";
          if (info.country)
            try {
              country =
                new Intl.DisplayNames([zh ? "zh-CN" : "en"], { type: "region", style: "short" }).of(
                  info.country,
                ) ?? country;
            } catch {}
          return [flag(info.country), country, info.asn].filter(Boolean).join(" ");
        };
        const until = (ts: number) => `${Math.max(1, Math.round((ts - now) / 60000))} min`;
        const lines = [
          `${this.text("Active grants / blocks / pending", "有效授权 / 封禁 / 待授权")}: ${active.length} / ${blocked.length} / ${pending.length}`,
          ...active
            .slice(0, 15)
            .map((g) =>
              `✅ ${g.subject} ${where(g.subject)} · ${until(g.expiresAt)}`.replace(/ +/g, " "),
            ),
          ...pending.slice(-10).map((p) => `⏳ ${p.subject} ${where(p.subject)}`.trimEnd()),
        ];
        await this.send(chatId, lines.join("\n"));
        break;
      }
      case "/grant": {
        const ip = normalizeIp(arg ?? "");
        const minutes = parts[2] ? Number(parts[2]) : this.config.durations.grant_default / 60;
        if (!ip || !Number.isFinite(minutes) || minutes <= 0 || minutes > 525600) {
          await this.send(chatId, "/grant <ip> [minutes: 1..525600]");
          break;
        }
        this.store.db
          .insert(schema.grants)
          .values({
            id: ulid(),
            subjectKind: "ip",
            subject: ip,
            scope: ["*"],
            grantedBy: actor,
            expiresAt: now + minutes * 60000,
            createdAt: now,
          })
          .run();
        await this.send(chatId, `${this.text("Granted", "已授权")}: ${ip} · ${minutes} min`);
        break;
      }
      case "/revoke": {
        const ip = normalizeIp(arg ?? "");
        let count = 0;
        if (ip) {
          const rows = this.store.db
            .select()
            .from(schema.grants)
            .where(isNull(schema.grants.revokedAt))
            .all()
            .filter((g) => g.subject === ip || g.subject.startsWith(`${ip}|`));
          for (const row of rows)
            count += this.store.db
              .update(schema.grants)
              .set({ revokedAt: now })
              .where(eq(schema.grants.id, row.id))
              .run().changes;
        } else if (arg)
          count = this.store.db
            .update(schema.tokens)
            .set({ revokedAt: now })
            .where(and(eq(schema.tokens.id, arg), isNull(schema.tokens.revokedAt)))
            .run().changes;
        await this.send(chatId, `${this.text("Revoked", "已撤销")}: ${count}`);
        break;
      }
      case "/tokens": {
        const rows = this.store.db
          .select({
            id: schema.tokens.id,
            kind: schema.tokens.kind,
            expiresAt: schema.tokens.expiresAt,
            revokedAt: schema.tokens.revokedAt,
            lastUsedAt: schema.tokens.lastUsedAt,
          })
          .from(schema.tokens)
          .orderBy(desc(schema.tokens.createdAt))
          .limit(20)
          .all();
        await this.send(
          chatId,
          `${this.text("Latest tokens (no secrets)", "最近令牌（不含密钥）")}\n${JSON.stringify(rows)}`,
        );
        break;
      }
      case "/audit": {
        const requested = Number(arg ?? 10);
        const limit = Number.isFinite(requested)
          ? Math.max(1, Math.min(50, Math.floor(requested)))
          : 10;
        const rows = this.store.db
          .select()
          .from(schema.requests)
          .orderBy(desc(schema.requests.ts))
          .limit(limit)
          .all();
        await this.send(
          chatId,
          `${this.text("Recent requests", "最近请求")}\n${rows.map((r) => `${r.id} ${r.ip} ${r.method} ${r.path} ${r.decision} ${r.status}`).join("\n")}`,
        );
        break;
      }
      case "/login": {
        const code = createLoginCode(this.store, this.secrets.sessionSecret, now);
        await this.send(
          chatId,
          `${this.text("One-time login code (5 minutes)", "一次性登录验证码（5 分钟有效）")}: ${code}`,
        );
        break;
      }
      default:
        await this.send(chatId, this.text("Use /help for commands", "使用 /help 查看命令"));
    }
  }
  async pollOnce(signal?: AbortSignal): Promise<void> {
    const offset = Number(getState(this.store, "telegram_offset") ?? 0);
    const updates = z
      .array(updateSchema)
      .max(100)
      .parse(
        await this.api.call(
          "getUpdates",
          { offset, timeout: 30, limit: 100, allowed_updates: ["message", "callback_query"] },
          signal,
        ),
      );
    for (const update of updates) {
      if (update.update_id < offset) continue;
      await this.handle(update);
      setState(this.store, "telegram_offset", String(update.update_id + 1));
    }
  }
  startPolling(): { stop: () => void; done: Promise<void> } {
    const controller = new AbortController();
    const done = (async () => {
      let failures = 0;
      for (
        let polls = 0;
        polls < this.config.telegram.max_polls && !controller.signal.aborted;
        polls++
      ) {
        try {
          await this.pollOnce(controller.signal);
          failures = 0;
        } catch {
          if (controller.signal.aborted) break;
          this.event("system", "poll_failed");
          if (++failures >= 8) break;
          try {
            await delay(Math.min(30000, 1000 * 2 ** failures), undefined, {
              signal: controller.signal,
            });
          } catch {
            break;
          }
        }
      }
      if (!controller.signal.aborted) this.event("system", "polling_stopped_at_bound");
    })();
    return { stop: () => controller.abort(), done };
  }
}
