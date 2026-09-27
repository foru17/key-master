import { fileURLToPath } from "node:url";
import type { HttpBindings } from "@hono/node-server";
import { type DecisionName, decide, deniedResponse, detectClient, inCidrs } from "@key-master/core";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { ulid } from "ulid";
import { createAdmin } from "./admin.js";
import { recordPending } from "./approval.js";
import type { Config, Secrets } from "./config.js";
import type { Store } from "./db.js";
import { clientIp } from "./ip.js";
import { containedFile, type Fetcher, serveResource } from "./resource.js";
import * as schema from "./schema.js";
export type PendingRequest = {
  requestId: string;
  ip: string;
  family: string;
  ua: string;
  slug: string;
  now: number;
};
export type BotHandler = {
  notify: (request: PendingRequest) => Promise<void>;
  handle: (update: unknown) => Promise<void>;
  sendLoginCode?: (code: string) => Promise<void>;
};
export function createApp(options: {
  store: Store;
  config: Config;
  secrets: Secrets;
  bot?: BotHandler;
  fetcher?: Fetcher;
  now?: () => number;
  adminRoot?: string;
}) {
  const { store, config, secrets } = options;
  const clock = options.now ?? Date.now;
  const adminRoot =
    options.adminRoot ?? fileURLToPath(new URL("../../admin/dist", import.meta.url));
  const app = new Hono<{
    Bindings: Partial<HttpBindings>;
    Variables: {
      requestId: string;
      ip: string;
      family: string;
      decision: DecisionName;
      resourceSlug: string | null;
      tokenId: string | null;
      grantId: string | null;
      pending: PendingRequest | null;
    };
  }>();
  app.use("*", async (c, next) => {
    const started = clock();
    const id = ulid();
    const ua = (c.req.header("user-agent") ?? "").slice(0, 1024);
    const ip = clientIp(
      c.env?.incoming?.socket.remoteAddress ?? "unknown",
      c.req.raw.headers,
      config.trusted_proxies,
    );
    c.set("requestId", id);
    c.set("ip", ip);
    c.set("family", detectClient(ua, c.req.header("accept")));
    c.set("decision", "not_found");
    c.set("resourceSlug", null);
    c.set("tokenId", null);
    c.set("grantId", null);
    c.set("pending", null);
    await next();
    c.header("X-Request-Id", id);
    if (c.req.method === "HEAD" && c.res.body)
      c.res = new Response(null, { status: c.res.status, headers: c.res.headers });
    let body: Uint8Array<ArrayBuffer>;
    try {
      body = c.res.body ? new Uint8Array(await c.res.arrayBuffer()) : new Uint8Array();
      c.res = new Response(
        c.req.method === "HEAD" || [204, 205, 304].includes(c.res.status) ? null : body,
        { status: c.res.status, headers: c.res.headers },
      );
    } catch {
      for (const name of [
        "content-length",
        "etag",
        "last-modified",
        "content-range",
        "accept-ranges",
      ])
        c.res.headers.delete(name);
      body = new TextEncoder().encode("Resource unavailable / 资源暂不可用\n");
      c.res = new Response(body, {
        status: 502,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Request-Id": id,
        },
      });
    }
    store.db
      .insert(schema.requests)
      .values({
        id,
        ts: started,
        ip,
        ua,
        headers: Object.fromEntries(
          ["accept", "accept-language", "range", "if-none-match"].flatMap((name) => {
            const value = c.req.header(name);
            return value ? [[name, value.slice(0, 512)]] : [];
          }),
        ),
        clientFamily: c.get("family"),
        method: c.req.method,
        path: c.req.path,
        resourceSlug: c.get("resourceSlug"),
        decision: c.get("decision"),
        tokenId: c.get("tokenId"),
        grantId: c.get("grantId"),
        status: c.res.status,
        bytes: body.length,
        latencyMs: Math.max(0, clock() - started),
        source: "app",
      })
      .run();
    const pending = c.get("pending");
    if (pending && !options.bot) recordPending(store, config, pending);
    if (pending && options.bot) {
      try {
        await options.bot.notify(pending);
      } catch {
        /* A failed notification must not change the authorization response. */
      }
    }
  });
  app.onError((_error, c) => c.text("Service unavailable / 服务暂不可用\n", 503));
  app.get("/healthz", (c) => {
    store.sqlite.prepare("SELECT 1").get();
    c.set("decision", "allow_public");
    return c.json({ status: "ok" });
  });
  app.route(
    "/api",
    createAdmin({
      store,
      config,
      secrets,
      clock,
      ...(options.bot?.sendLoginCode
        ? { sendCode: options.bot.sendLoginCode.bind(options.bot) }
        : {}),
    }),
  );
  app.on(["GET", "HEAD"], ["/admin", "/admin/*"], async (c) => {
    if (!inCidrs(c.get("ip"), config.admin.allowed_cidrs)) {
      c.set("decision", "deny_unknown");
      return deniedResponse({
        family: detectClient(c.req.header("user-agent") ?? "", c.req.header("accept")),
        requestId: c.get("requestId"),
        now: clock(),
        timeZone: config.notice.timezone,
        acceptLanguage: c.req.header("accept-language") ?? "",
        contactText: config.notice.contact_text,
        contactUrl: config.notice.contact_url,
        footer: config.notice.footer,
      });
    }
    const requested = c.req.path.replace(/^\/admin\/?/, "") || "index.html";
    const path = requested.includes(".") ? requested : "index.html";
    try {
      const body = await containedFile(adminRoot, path);
      c.set("decision", "allow_internal");
      const type = path.endsWith(".js")
        ? "application/javascript"
        : path.endsWith(".woff2")
          ? "font/woff2"
          : path.endsWith(".css")
            ? "text/css"
            : "text/html";
      return new Response(new Uint8Array(body), {
        headers: {
          "Content-Type": `${type}; charset=utf-8`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch {
      return c.text(config.notice.not_found_body, 404);
    }
  });
  if (config.telegram.mode === "webhook" && config.telegram.webhook_path)
    app.post(config.telegram.webhook_path, async (c) => {
      const { tokenMatches, hashToken } = await import("@key-master/core");
      if (
        !tokenMatches(
          c.req.header("x-telegram-bot-api-secret-token") ?? "",
          hashToken(config.telegram.webhook_secret),
        )
      )
        return c.text(config.notice.not_found_body, 404);
      if (!options.bot) return c.text("Service unavailable\n", 503);
      await options.bot.handle(await c.req.json());
      c.set("decision", "allow_token");
      return c.json({ ok: true });
    });
  app.all("*", async (c) => {
    const resource =
      store.db.select().from(schema.resources).where(eq(schema.resources.slug, c.req.path)).get() ??
      null;
    const now = clock();
    const result = decide({
      resource,
      ip: c.get("ip"),
      ua: c.req.header("user-agent") ?? "",
      accept: c.req.header("accept") ?? "",
      queryToken: c.req.query("k") ?? "",
      now,
      tokens: store.db.select().from(schema.tokens).all(),
      grants: store.db.select().from(schema.grants).all(),
      blocks: store.db.select().from(schema.blocks).all(),
      internalCidrs: config.internal_cidrs,
      pepper: secrets.tokenPepper,
      method: c.req.method,
      range: c.req.header("range") ?? "",
      ifNoneMatch: c.req.header("if-none-match") ?? "",
    });
    c.set("decision", result.decision);
    c.set("resourceSlug", resource?.slug ?? null);
    c.set("tokenId", result.tokenId ?? null);
    c.set("grantId", result.grantId ?? null);
    if (result.notify && resource)
      c.set("pending", {
        requestId: c.get("requestId"),
        ip: c.get("ip"),
        family: c.get("family"),
        ua: (c.req.header("user-agent") ?? "").slice(0, 300),
        slug: resource.slug,
        now,
      });
    if (!resource?.enabled || (!result.allowed && !config.observe_mode))
      return deniedResponse({
        family: detectClient(c.req.header("user-agent") ?? "", c.req.header("accept")),
        requestId: c.get("requestId"),
        now,
        notFound: result.decision === "not_found",
        notFoundBody: config.notice.not_found_body,
        timeZone: config.notice.timezone,
        acceptLanguage: c.req.header("accept-language") ?? "",
        contactText: config.notice.contact_text,
        contactUrl: config.notice.contact_url,
        footer: config.notice.footer,
      });
    if (result.tokenId)
      store.db
        .update(schema.tokens)
        .set({ lastUsedAt: now })
        .where(eq(schema.tokens.id, result.tokenId))
        .run();
    try {
      return await serveResource(resource, c.req.raw, config.file_root, options.fetcher);
    } catch {
      return c.text("Resource unavailable / 资源暂不可用\n", 502);
    }
  });
  return app;
}
