import {
  allowlistValueForIp,
  clientFamilies,
  describeUserAgent,
  hashToken,
  inCidrs,
  normalizeIp,
} from "@key-master/core";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { ulid } from "ulid";
import { z } from "zod";
import { createAllowlist, revokeAllowlist } from "./allowlist.js";
import { clearPendingSubject, resolveApproval } from "./approval.js";
import { createLoginCode, rateLimit, redeemCode } from "./auth.js";
import {
  allowlistInput,
  type Config,
  configSchema,
  resourceSchema,
  SCOPE_ITEM_PATTERN,
  type Secrets,
} from "./config.js";
import { getState, issueToken, type Store, setState } from "./db.js";
import { GeoService } from "./geo.js";
import * as schema from "./schema.js";

const duration = z.number().int().min(1).max(31536000);
const scope = z.array(z.string().regex(SCOPE_ITEM_PATTERN)).min(1).max(100);
const grantInput = z
  .object({
    subjectKind: z.enum(["ip", "ip_client"]),
    subject: z.string().max(200),
    scope,
    duration,
  })
  .superRefine((v, ctx) => {
    const [ip, client, extra] = v.subject.split("|");
    if (
      !normalizeIp(ip ?? "") ||
      (v.subjectKind === "ip"
        ? client !== undefined
        : !clientFamilies.includes(client as (typeof clientFamilies)[number]) ||
          extra !== undefined)
    )
      ctx.addIssue({ code: "custom", message: "Invalid subject" });
  });
const settingsInput = z.object({
  observe_mode: z.boolean(),
  durations: configSchema.shape.durations,
  notice: configSchema.shape.notice,
});
export function restoreSettings(store: Store, config: Config) {
  const saved = getState(store, "admin_settings");
  if (saved) {
    const raw = JSON.parse(saved);
    const parsed = settingsInput.parse(raw);
    if (raw.notice?.timezone === undefined) parsed.notice.timezone = config.notice.timezone;
    Object.assign(config, parsed);
  }
}
export function createAdmin(options: {
  store: Store;
  config: Config;
  secrets: Secrets;
  clock: () => number;
  sendCode?: (code: string) => Promise<void>;
  geo?: GeoService;
}) {
  const { store, config, secrets, clock } = options;
  const geo = options.geo ?? new GeoService(store, config);
  const subjectIp = (subject: string) => subject.split("|")[0] ?? subject;
  restoreSettings(store, config);
  const api = new Hono<{ Variables: { ip: string } }>();
  const pendingRows = () =>
    store.db
      .select()
      .from(schema.pending)
      .where(and(isNull(schema.pending.resolvedAt), gt(schema.pending.expiresAt, clock())))
      .orderBy(desc(schema.pending.expiresAt))
      .limit(200)
      .all();
  const pending = () =>
    pendingRows().map((p) => {
      const request = store.db
        .select({ ua: schema.requests.ua })
        .from(schema.requests)
        .where(eq(schema.requests.id, p.requestId))
        .get();
      return {
        ...p,
        ipInfo: geo.cached(subjectIp(p.subject)),
        client: request ? describeUserAgent(request.ua) : null,
      };
    });
  const fail = (message: string) => ({ error: message });
  api.use("*", async (c, next) => {
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    if (!inCidrs(c.get("ip"), config.admin.allowed_cidrs))
      return c.json(fail("Access denied / 访问被拒绝"), 403);
    if (!["GET", "HEAD"].includes(c.req.method)) {
      const origin = c.req.header("origin");
      if (
        (origin &&
          origin !== new URL(config.public_base_url).origin &&
          origin !== new URL(c.req.url).origin) ||
        c.req.header("sec-fetch-site") === "cross-site"
      )
        return c.json(fail("Invalid origin / 来源无效"), 403);
      if (!c.req.header("content-type")?.startsWith("application/json"))
        return c.json(fail("JSON required / 需要 JSON"), 415);
      if (Number(c.req.header("content-length") ?? 0) > 1048576)
        return c.json(fail("Body too large / 内容过大"), 413);
      const body = await c.req.text();
      if (body.length > 1048576) return c.json(fail("Body too large / 内容过大"), 413);
    }
    if (c.req.path.startsWith("/api/admin")) {
      const cookie = getCookie(c, "km_session") ?? "";
      const session = store.sqlite
        .prepare("SELECT expires_at FROM sessions WHERE secret_hash = ?")
        .get(hashToken(cookie, secrets.sessionSecret)) as { expires_at: number } | undefined;
      if (!session || session.expires_at <= clock())
        return c.json(fail("Sign in required / 请先登录"), 401);
    }
    await next();
  });
  api.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json(fail("Invalid input / 输入无效"), 400);
    if (error.message.includes("UNIQUE constraint"))
      return c.json(fail("Already exists / 已存在"), 409);
    return c.json(fail("Service unavailable / 服务暂不可用"), 503);
  });
  api.post("/auth/request-code", async (c) => {
    if (
      !rateLimit(store, `send:${c.get("ip")}`, 3, 300000, clock()) ||
      !rateLimit(store, "send:global", 10, 300000, clock())
    )
      return c.json(fail("Try later / 请稍后重试"), 429);
    if (!options.sendCode) return c.json(fail("Telegram unavailable / Telegram 未连接"), 503);
    const code = createLoginCode(store, secrets.sessionSecret, clock());
    try {
      await options.sendCode(code);
    } catch {
      store.db
        .update(schema.loginCodes)
        .set({ usedAt: clock() })
        .where(isNull(schema.loginCodes.usedAt))
        .run();
      return c.json(fail("Delivery failed / 发送失败"), 503);
    }
    return c.json({ ok: true, expiresIn: 300 });
  });
  api.post("/auth/verify", async (c) => {
    if (
      !rateLimit(store, `verify:${c.get("ip")}`, 5, 300000, clock()) ||
      !rateLimit(store, "verify:global", 30, 300000, clock())
    )
      return c.json(fail("Try later / 请稍后重试"), 429);
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/) }).parse(await c.req.json());
    const session = redeemCode(store, code, secrets.sessionSecret, clock());
    if (!session) return c.json(fail("Invalid or expired code / 验证码无效或已过期"), 401);
    setCookie(c, "km_session", session, {
      httpOnly: true,
      secure: true,
      sameSite: "Strict",
      maxAge: 43200,
      path: "/",
    });
    return c.json({ ok: true });
  });
  api.post("/auth/logout", (c) => {
    store.sqlite
      .prepare("DELETE FROM sessions WHERE secret_hash = ?")
      .run(hashToken(getCookie(c, "km_session") ?? "", secrets.sessionSecret));
    deleteCookie(c, "km_session", { path: "/", secure: true, httpOnly: true, sameSite: "Strict" });
    return c.json({ ok: true });
  });
  api.get("/admin/session", (c) => c.json({ authenticated: true }));
  api.get("/admin/events", (c) => c.json({ pending: pending(), at: clock() }));
  api.get("/admin/overview", (c) => {
    const days = c.req.query("range") === "7d" ? 7 : 1;
    const since = clock() - 86400000;
    const count = (sql: string, ...args: (string | number)[]) =>
      (store.sqlite.prepare(sql).get(...args) as { n: number }).n;
    const stats = {
      requests: count(
        "SELECT count(*) n FROM requests WHERE resource_slug IS NOT NULL AND ts >= ?",
        since,
      ),
      denied: count(
        "SELECT count(*) n FROM requests WHERE resource_slug IS NOT NULL AND ts >= ? AND decision LIKE 'deny_%'",
        since,
      ),
      pending: count(
        "SELECT count(*) n FROM pending WHERE resolved_at IS NULL AND expires_at > ?",
        clock(),
      ),
      grants: count(
        "SELECT count(*) n FROM grants WHERE revoked_at IS NULL AND expires_at > ?",
        clock(),
      ),
    };
    const bucket = days === 1 ? 3600000 : 86400000;
    const start = Math.floor(clock() / bucket) * bucket - (days === 1 ? 23 : 6) * bucket;
    const series = store.sqlite
      .prepare(
        "SELECT CAST((ts-?)/? AS INTEGER) bucket, sum(decision LIKE 'allow_%') allowed, sum(decision LIKE 'deny_%') denied FROM requests WHERE ts >= ? AND resource_slug IS NOT NULL GROUP BY bucket",
      )
      .all(start, bucket, start) as { bucket: number; allowed: number; denied: number }[];
    return c.json({
      stats,
      series: Array.from({ length: days === 1 ? 24 : 7 }, (_, i) => ({
        ts: start + i * bucket,
        allowed: series.find((s) => s.bucket === i)?.allowed ?? 0,
        denied: series.find((s) => s.bucket === i)?.denied ?? 0,
      })),
      pending: pending(),
      clients: store.sqlite
        .prepare(
          "SELECT client_family label, count(*) count FROM requests WHERE resource_slug IS NOT NULL AND ts >= ? GROUP BY client_family ORDER BY count DESC LIMIT 5",
        )
        .all(since),
      ips: (
        store.sqlite
          .prepare(
            "SELECT ip label, count(*) count FROM requests WHERE resource_slug IS NOT NULL AND ts >= ? GROUP BY ip ORDER BY count DESC LIMIT 5",
          )
          .all(since) as { label: string; count: number }[]
      ).map((row) => ({ ...row, ipInfo: geo.cached(row.label) })),
    });
  });
  api.get("/admin/requests", (c) => {
    const query = z
      .object({
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
        from: z.coerce.number().optional(),
        to: z.coerce.number().optional(),
        decision: z.enum(schema.requests.decision.enumValues).optional(),
        client: z.enum(clientFamilies).optional(),
        resource: z.string().max(1024).optional(),
        q: z.string().max(200).optional(),
      })
      .parse(c.req.query());
    const clauses = ["1=1"];
    const values: (string | number)[] = [];
    for (const [column, value, operator] of [
      ["ts", query.from, ">="],
      ["ts", query.to, "<="],
      ["decision", query.decision, "="],
      ["client_family", query.client, "="],
      ["resource_slug", query.resource, "="],
    ] as const)
      if (value !== undefined && value !== "") {
        clauses.push(`${column} ${operator} ?`);
        values.push(value);
      }
    if (query.q) {
      clauses.push("(ip LIKE ? ESCAPE '\\' OR id LIKE ? ESCAPE '\\')");
      const q = `%${query.q.replace(/[\\%_]/g, "\\$&")}%`;
      values.push(q, q);
    }
    const where = clauses.join(" AND ");
    const total = (
      store.sqlite.prepare(`SELECT count(*) n FROM requests WHERE ${where}`).get(...values) as {
        n: number;
      }
    ).n;
    const ids = store.sqlite
      .prepare(`SELECT id FROM requests WHERE ${where} ORDER BY ts DESC, id DESC LIMIT ? OFFSET ?`)
      .all(...values, query.pageSize, (query.page - 1) * query.pageSize) as { id: string }[];
    return c.json({
      items: ids.map(({ id }) => {
        const row = store.db.select().from(schema.requests).where(eq(schema.requests.id, id)).get();
        return row && { ...row, ipInfo: geo.cached(row.ip), client: describeUserAgent(row.ua) };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    });
  });
  api.get("/admin/requests/:id", async (c) => {
    const row = store.db
      .select()
      .from(schema.requests)
      .where(eq(schema.requests.id, c.req.param("id")))
      .get();
    return row
      ? c.json({
          ...row,
          ipInfo: await geo.lookup(row.ip),
          client: describeUserAgent(row.ua),
          allowlist: row.allowlistId
            ? (store.db
                .select()
                .from(schema.allowlist)
                .where(eq(schema.allowlist.id, row.allowlistId))
                .get() ?? null)
            : null,
        })
      : c.json(fail("Not found / 未找到"), 404);
  });
  api.get("/admin/approvals", (c) =>
    c.json({
      pending: pending(),
      recent: store.db
        .select()
        .from(schema.approvals)
        .orderBy(desc(schema.approvals.ts))
        .limit(100)
        .all()
        .map((a) => ({ ...a, ipInfo: geo.cached(subjectIp(a.subject)) })),
    }),
  );
  api.post("/admin/approvals/:id", async (c) => {
    const input = z
      .object({
        action: z.enum(["allow", "deny", "device_token", "always"]),
        duration: duration.optional(),
      })
      .parse(await c.req.json());
    const result = resolveApproval(
      store,
      secrets,
      {
        id: c.req.param("id"),
        action: input.action,
        duration:
          input.duration ??
          (input.action === "deny" ? config.durations.block : config.durations.grant_default),
        actor: "admin:owner",
      },
      clock(),
    );
    if (!result) return c.json(fail("Expired or already handled / 已过期或已处理"), 409);
    return c.json({
      ok: true,
      ...result.token,
      urls: result.token
        ? result.pending.slugs.map(
            (slug) =>
              `${config.public_base_url.replace(/\/$/, "")}${slug}?k=${result.token?.secret}`,
          )
        : [],
    });
  });
  api.get("/admin/allowlist", (c) =>
    c.json(
      store.db
        .select()
        .from(schema.allowlist)
        .where(isNull(schema.allowlist.revokedAt))
        .orderBy(desc(schema.allowlist.createdAt))
        .limit(1000)
        .all(),
    ),
  );
  api.post("/admin/allowlist", async (c) => {
    const input = z
      .union([allowlistInput, z.strictObject({ requestId: z.string().min(1).max(50) })])
      .parse(await c.req.json());
    if ("requestId" in input) {
      const request = store.db
        .select()
        .from(schema.requests)
        .where(eq(schema.requests.id, input.requestId))
        .get();
      if (!request) return c.json(fail("Not found / 未找到"), 404);
      const value = allowlistValueForIp(request.ip);
      if (!value) return c.json(fail("Invalid IP / IP 无效"), 400);
      const row = store.db.transaction(() => {
        const row = createAllowlist(
          store,
          {
            value,
            label: `admin ${request.clientFamily} ${new Date(clock()).toISOString().slice(0, 10)}`,
            scope: ["*"],
            source: "admin",
            createdBy: "admin:owner",
          },
          clock(),
        );
        clearPendingSubject(store, request.ip, request.clientFamily, clock());
        return row;
      });
      return c.json({ id: row.id }, 201);
    }
    const row = createAllowlist(
      store,
      { ...input, source: "admin", createdBy: "admin:owner" },
      clock(),
    );
    return c.json({ id: row.id }, 201);
  });
  api.delete("/admin/allowlist/:id", (c) =>
    revokeAllowlist(store, c.req.param("id"), clock())
      ? c.json({ ok: true })
      : c.json(fail("Not found or already removed / 未找到或已移除"), 404),
  );
  api.get("/admin/grants", (c) =>
    c.json(
      store.db
        .select()
        .from(schema.grants)
        .orderBy(desc(schema.grants.createdAt))
        .limit(1000)
        .all()
        .map((g) => ({ ...g, ipInfo: geo.cached(subjectIp(g.subject)) })),
    ),
  );
  api.post("/admin/grants", async (c) => {
    const input = grantInput.parse(await c.req.json());
    const id = ulid();
    store.db
      .insert(schema.grants)
      .values({
        id,
        subjectKind: input.subjectKind,
        subject: input.subject,
        scope: input.scope,
        expiresAt: clock() + input.duration * 1000,
        createdAt: clock(),
        grantedBy: "admin:owner",
      })
      .run();
    return c.json({ id }, 201);
  });
  api.patch("/admin/grants/:id", async (c) => {
    const input = grantInput.parse(await c.req.json());
    const result = store.db
      .update(schema.grants)
      .set({
        subjectKind: input.subjectKind,
        subject: input.subject,
        scope: input.scope,
        expiresAt: clock() + input.duration * 1000,
      })
      .where(eq(schema.grants.id, c.req.param("id")))
      .run();
    return result.changes ? c.json({ ok: true }) : c.json(fail("Not found / 未找到"), 404);
  });
  api.delete("/admin/grants/:id", (c) => {
    const r = store.db
      .update(schema.grants)
      .set({ revokedAt: clock() })
      .where(eq(schema.grants.id, c.req.param("id")))
      .run();
    return r.changes ? c.json({ ok: true }) : c.json(fail("Not found / 未找到"), 404);
  });
  api.post("/admin/blocks", async (c) => {
    const input = z
      .object({ ip: z.string().refine((v) => !!normalizeIp(v)), duration })
      .parse(await c.req.json());
    store.db.transaction((tx) => {
      tx.insert(schema.blocks)
        .values({
          subject: input.ip,
          until: clock() + input.duration * 1000,
          reason: "admin:owner",
        })
        .onConflictDoUpdate({
          target: schema.blocks.subject,
          set: { until: clock() + input.duration * 1000, reason: "admin:owner" },
        })
        .run();
      const rows = tx
        .select()
        .from(schema.grants)
        .where(isNull(schema.grants.revokedAt))
        .all()
        .filter((g) => g.subject === input.ip || g.subject.startsWith(`${input.ip}|`));
      for (const row of rows)
        tx.update(schema.grants)
          .set({ revokedAt: clock() })
          .where(eq(schema.grants.id, row.id))
          .run();
    });
    return c.json({ ok: true });
  });
  api.get("/admin/tokens", (c) =>
    c.json(
      store.db
        .select({
          id: schema.tokens.id,
          label: schema.tokens.label,
          scope: schema.tokens.scope,
          kind: schema.tokens.kind,
          expiresAt: schema.tokens.expiresAt,
          lastUsedAt: schema.tokens.lastUsedAt,
          revokedAt: schema.tokens.revokedAt,
          createdAt: schema.tokens.createdAt,
        })
        .from(schema.tokens)
        .orderBy(desc(schema.tokens.createdAt))
        .limit(1000)
        .all()
        .map((token) => ({
          ...token,
          usage: store.sqlite
            .prepare(
              "SELECT CAST((ts-?)/86400000 AS INTEGER) day, count(*) count FROM requests WHERE token_id=? AND ts>=? GROUP BY day",
            )
            .all(clock() - 7 * 86400000, token.id, clock() - 7 * 86400000),
        })),
    ),
  );
  api.post("/admin/tokens", async (c) => {
    const input = z
      .object({
        label: z.string().trim().min(1).max(100),
        scope,
        kind: z.enum(["machine", "device"]),
        expiresAt: z
          .number()
          .int()
          .refine((v) => v > clock())
          .nullable()
          .optional(),
      })
      .parse(await c.req.json());
    const token = issueToken(
      store,
      { ...input, expiresAt: input.expiresAt ?? null },
      secrets.tokenPepper,
      clock(),
    );
    const slugs = input.scope.includes("*")
      ? store.db
          .select({ slug: schema.resources.slug })
          .from(schema.resources)
          .limit(100)
          .all()
          .map((r) => r.slug)
      : input.scope;
    return c.json(
      {
        ...token,
        urls: slugs.map(
          (slug) => `${config.public_base_url.replace(/\/$/, "")}${slug}?k=${token.secret}`,
        ),
      },
      201,
    );
  });
  api.delete("/admin/tokens/:id", (c) => {
    const r = store.db
      .update(schema.tokens)
      .set({ revokedAt: clock() })
      .where(eq(schema.tokens.id, c.req.param("id")))
      .run();
    return r.changes ? c.json({ ok: true }) : c.json(fail("Not found / 未找到"), 404);
  });
  api.get("/admin/resources", (c) => {
    const recent = new Map(
      (
        store.sqlite
          .prepare(
            "SELECT resource_slug slug, count(*) n, sum(decision LIKE 'deny_%') denied FROM requests WHERE resource_slug IS NOT NULL AND ts >= ? GROUP BY resource_slug",
          )
          .all(clock() - 86400000) as { slug: string; n: number; denied: number }[]
      ).map((row) => [row.slug, row]),
    );
    const last = new Map(
      (
        store.sqlite
          .prepare(
            "SELECT resource_slug slug, max(ts) ts FROM requests WHERE resource_slug IS NOT NULL GROUP BY resource_slug",
          )
          .all() as { slug: string; ts: number }[]
      ).map((row) => [row.slug, row.ts]),
    );
    return c.json(
      store.db
        .select()
        .from(schema.resources)
        .orderBy(desc(schema.resources.createdAt))
        .limit(1000)
        .all()
        .map((r) => ({
          ...r,
          size: Buffer.byteLength(r.source),
          hash: hashToken(r.source),
          requests24h: recent.get(r.slug)?.n ?? 0,
          denied24h: recent.get(r.slug)?.denied ?? 0,
          lastRequestAt: last.get(r.slug) ?? null,
        })),
    );
  });
  for (const method of ["post", "put"] as const)
    api[method](method === "post" ? "/admin/resources" : "/admin/resources/:id", async (c) => {
      const input = resourceSchema.parse(await c.req.json());
      const value = {
        slug: input.slug,
        kind: input.kind,
        source: input.source,
        contentType: input.content_type,
        policy: input.policy,
        enabled: input.enabled,
        updatedAt: clock(),
      };
      if (method === "post") {
        const id = ulid();
        store.db
          .insert(schema.resources)
          .values({ ...value, id, createdAt: clock() })
          .run();
        return c.json({ id }, 201);
      }
      const r = store.db
        .update(schema.resources)
        .set(value)
        .where(eq(schema.resources.id, c.req.param("id") ?? ""))
        .run();
      return r.changes ? c.json({ ok: true }) : c.json(fail("Not found / 未找到"), 404);
    });
  api.delete("/admin/resources/:id", (c) => {
    const r = store.db
      .delete(schema.resources)
      .where(eq(schema.resources.id, c.req.param("id")))
      .run();
    return r.changes ? c.json({ ok: true }) : c.json(fail("Not found / 未找到"), 404);
  });
  const settings = () => ({
    observe_mode: config.observe_mode,
    durations: config.durations,
    notice: config.notice,
    telegram: {
      mode: config.telegram.mode,
      connected: !!options.sendCode && getState(store, "telegram_connected") !== "false",
      username: getState(store, "telegram_username") ?? null,
      ownerChats: config.telegram.owner_chat_ids,
    },
    version: "0.2.0",
  });
  api.get("/admin/settings", (c) => c.json(settings()));
  api.put("/admin/settings", async (c) => {
    const input = settingsInput.parse(await c.req.json());
    setState(store, "admin_settings", JSON.stringify(input));
    Object.assign(config, input);
    return c.json(settings());
  });
  api.all("*", (c) => c.json(fail("Not found / 未找到"), 404));
  return api;
}
