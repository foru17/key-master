import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
export const resources = sqliteTable("resources", {
  id: text().primaryKey(),
  slug: text().notNull().unique(),
  kind: text({ enum: ["file", "inline", "upstream"] }).notNull(),
  source: text().notNull(),
  contentType: text("content_type").notNull(),
  policy: text({ enum: ["token_only", "approval", "public"] }).notNull(),
  enabled: integer({ mode: "boolean" }).notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});
export const tokens = sqliteTable("tokens", {
  id: text().primaryKey(),
  label: text().notNull(),
  secretHash: text("secret_hash").notNull(),
  scope: text({ mode: "json" }).$type<string[]>().notNull(),
  kind: text({ enum: ["machine", "device"] }).notNull(),
  expiresAt: integer("expires_at"),
  lastUsedAt: integer("last_used_at"),
  revokedAt: integer("revoked_at"),
  createdAt: integer("created_at").notNull(),
});
export const grants = sqliteTable(
  "grants",
  {
    id: text().primaryKey(),
    subjectKind: text("subject_kind", { enum: ["ip", "ip_client"] }).notNull(),
    subject: text().notNull(),
    scope: text({ mode: "json" }).$type<string[]>().notNull(),
    grantedBy: text("granted_by").notNull(),
    expiresAt: integer("expires_at").notNull(),
    revokedAt: integer("revoked_at"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [index("grants_subject_idx").on(t.subject)],
);
export const requests = sqliteTable(
  "requests",
  {
    id: text().primaryKey(),
    ts: integer().notNull(),
    ip: text().notNull(),
    ua: text().notNull(),
    headers: text({ mode: "json" }).$type<Record<string, string>>().notNull().default({}),
    clientFamily: text("client_family").notNull(),
    method: text().notNull(),
    path: text().notNull(),
    resourceSlug: text("resource_slug"),
    decision: text({
      enum: [
        "allow_token",
        "allow_grant",
        "allow_internal",
        "allow_public",
        "deny_pending",
        "deny_blocked",
        "deny_unknown",
        "not_found",
      ],
    }).notNull(),
    tokenId: text("token_id"),
    grantId: text("grant_id"),
    status: integer().notNull(),
    bytes: integer().notNull(),
    latencyMs: integer("latency_ms").notNull(),
    source: text({ enum: ["app", "nginx"] }).notNull(),
  },
  (t) => [index("requests_ts_idx").on(t.ts)],
);
export const approvals = sqliteTable("approvals", {
  id: text().primaryKey(),
  requestId: text("request_id")
    .notNull()
    .references(() => requests.id),
  subject: text().notNull(),
  tgMessageId: integer("tg_message_id"),
  action: text({ enum: ["allow", "deny", "device_token"] }).notNull(),
  actor: text().notNull(),
  durationS: integer("duration_s").notNull(),
  ts: integer().notNull(),
});
export const blocks = sqliteTable("blocks", {
  subject: text().primaryKey(),
  until: integer().notNull(),
  reason: text().notNull(),
});
export const pending = sqliteTable(
  "pending",
  {
    id: text().primaryKey(),
    subject: text().notNull(),
    requestId: text("request_id").notNull(),
    slugs: text({ mode: "json" }).$type<string[]>().notNull(),
    expiresAt: integer("expires_at").notNull(),
    resolvedAt: integer("resolved_at"),
    messages: text({ mode: "json" }).$type<{ chatId: string; messageId: number }[]>().notNull(),
  },
  (t) => [index("pending_subject_idx").on(t.subject)],
);
export const botEvents = sqliteTable("bot_events", {
  id: text().primaryKey(),
  ts: integer().notNull(),
  actor: text().notNull(),
  event: text().notNull(),
});
export const state = sqliteTable("state", { key: text().primaryKey(), value: text().notNull() });
export const loginCodes = sqliteTable("login_codes", {
  id: text().primaryKey(),
  secretHash: text("secret_hash").notNull(),
  expiresAt: integer("expires_at").notNull(),
  usedAt: integer("used_at"),
});
