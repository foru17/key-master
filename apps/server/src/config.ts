import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { validCidr, validTimeZone } from "@key-master/core";
import { parse } from "yaml";
import { z } from "zod";

const cidrs = z.array(z.string().refine(validCidr, "Invalid CIDR"));
const httpUrl = z
  .url()
  .max(2048)
  .refine(
    (value) => URL.canParse(value) && ["http:", "https:"].includes(new URL(value).protocol),
    "HTTP(S) required",
  );
// Path-like slug: letters, digits, "_", "-", "." and "/"; no "." or ".." segments.
export const SLUG_PATTERN = /^(?!.*\/\.{1,2}(?:\/|$))\/[A-Za-z0-9._/-]+$/;
export const SCOPE_ITEM_PATTERN = /^(?:\*|(?!.*\/\.{1,2}(?:\/|$))\/[A-Za-z0-9._/-]+)$/;

export const resourceSchema = z
  .object({
    slug: z
      .string()
      .max(1024)
      .regex(SLUG_PATTERN)
      .refine(
        (s) =>
          !s.startsWith("/api") &&
          !s.startsWith("/admin") &&
          s !== "/healthz" &&
          !s.startsWith("/_telegram"),
        "Reserved route",
      ),
    kind: z.enum(["file", "inline", "upstream"]),
    source: z.string(),
    content_type: z.string().default("text/plain; charset=utf-8"),
    policy: z.enum(["token_only", "approval", "public"]).default("approval"),
    enabled: z.boolean().default(true),
  })
  .superRefine((resource, ctx) => {
    if (resource.kind === "upstream" && !httpUrl.safeParse(resource.source).success)
      ctx.addIssue({ code: "custom", path: ["source"], message: "Upstream must be HTTP(S)" });
  });
export const machineTokenSchema = z.strictObject({
  id: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[A-Za-z0-9_-]+$/),
  label: z.string().min(1).max(200),
  secret_sha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .transform((value) => value.toLowerCase()),
  scope: z.array(z.string().regex(SCOPE_ITEM_PATTERN)).min(1).max(100),
  kind: z.literal("machine"),
  expires_at: z
    .union([
      z.number().int().nonnegative().max(8640000000000000),
      z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
    ])
    .optional(),
});
export const configSchema = z
  .object({
    public_base_url: httpUrl.default("https://example.com"),
    listen: z
      .object({
        host: z.string().default("0.0.0.0"),
        port: z.number().int().min(1).max(65535).default(3000),
      })
      .default({ host: "0.0.0.0", port: 3000 }),
    db_path: z.string().default("data/key-master.db"),
    file_root: z.string().default("data/files"),
    internal_cidrs: cidrs.default([]),
    trusted_proxies: cidrs.default([]),
    observe_mode: z.boolean().default(false),
    telegram: z
      .object({
        mode: z.enum(["polling", "webhook"]).default("polling"),
        owner_chat_ids: z.array(z.string().regex(/^-?\d+$/)).default([]),
        webhook_secret: z.string().default(""),
        webhook_path: z
          .string()
          .regex(/^\/_telegram\/[A-Za-z0-9_-]{24,}$/)
          .optional(),
        lang: z.enum(["zh", "en"]).default("en"),
        max_polls: z.number().int().min(1).max(100000).default(10000),
      })
      .default({
        mode: "polling",
        owner_chat_ids: [],
        webhook_secret: "",
        lang: "en",
        max_polls: 10000,
      }),
    bot: z.object({ lang: z.enum(["zh", "en"]).default("en") }).default({ lang: "en" }),
    durations: z
      .object({
        grant_default: z.number().int().positive().max(31536000).default(600),
        options: z
          .tuple([
            z.number().int().positive().max(31536000),
            z.number().int().positive().max(31536000),
          ])
          .default([600, 3600]),
        block: z.number().int().positive().max(31536000).default(3600),
        pending: z.number().int().positive().max(86400).default(600),
      })
      .default({ grant_default: 600, options: [600, 3600], block: 3600, pending: 600 }),
    notice: z
      .object({
        timezone: z.string().refine(validTimeZone, "Invalid IANA timezone").default("UTC"),
        contact_text: z.string().default(""),
        contact_url: z.union([httpUrl, z.literal("")]).default(""),
        footer: z.string().default(""),
        not_found_body: z.string().default("404 Not Found\n"),
      })
      .default({
        timezone: "UTC",
        contact_text: "",
        contact_url: "",
        footer: "",
        not_found_body: "404 Not Found\n",
      }),
    tokens: z.array(machineTokenSchema).max(10000).default([]),
    resources: z.array(resourceSchema).max(10000).default([]),
    ingest: z.object({ nginx_log: z.string().optional() }).default({}),
    admin: z.object({ allowed_cidrs: cidrs.default([]) }).default({ allowed_cidrs: [] }),
  })
  .superRefine((config, ctx) => {
    if (new Set(config.tokens.map((t) => t.id)).size !== config.tokens.length)
      ctx.addIssue({ code: "custom", path: ["tokens"], message: "Duplicate token id" });
    if (new Set(config.resources.map((r) => r.slug)).size !== config.resources.length)
      ctx.addIssue({ code: "custom", path: ["resources"], message: "Duplicate resource slug" });
    if (
      config.telegram.mode === "webhook" &&
      (!config.telegram.webhook_path || config.telegram.webhook_secret.length < 24)
    )
      ctx.addIssue({
        code: "custom",
        path: ["telegram"],
        message: "Webhook needs a secret path and a secret of at least 24 characters",
      });
  });
export type Config = z.infer<typeof configSchema>;
export type Secrets = { telegramToken: string; sessionSecret: string; tokenPepper: string };
export function loadConfig(
  path: string,
  env: NodeJS.ProcessEnv = process.env,
): { config: Config; secrets: Secrets } {
  const raw: unknown = parse(readFileSync(path, "utf8"));
  const config = configSchema.parse(raw);
  const root = dirname(resolve(path));
  config.db_path = config.db_path === ":memory:" ? config.db_path : resolve(root, config.db_path);
  config.file_root = resolve(root, config.file_root);
  if (config.ingest.nginx_log) config.ingest.nginx_log = resolve(root, config.ingest.nginx_log);
  const secrets = {
    telegramToken: env.KM_TELEGRAM_TOKEN ?? "",
    sessionSecret: env.KM_SESSION_SECRET ?? "",
    tokenPepper: env.KM_TOKEN_PEPPER ?? "",
  };
  if (secrets.sessionSecret.length < 32)
    throw new Error("KM_SESSION_SECRET must contain at least 32 characters");
  return { config, secrets };
}
