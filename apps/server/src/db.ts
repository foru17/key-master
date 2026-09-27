import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { hashToken } from "@key-master/core";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { ulid } from "ulid";
import type { Config } from "./config.js";
import * as schema from "./schema.js";

export type Store = { db: BetterSQLite3Database<typeof schema>; sqlite: Database.Database };
export function openStore(path = ":memory:"): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  return { db, sqlite };
}
export function syncResources(store: Store, config: Config, now = Date.now()) {
  store.db.transaction((tx) => {
    for (const resource of config.resources)
      tx.insert(schema.resources)
        .values({
          id: ulid(),
          slug: resource.slug,
          kind: resource.kind,
          source: resource.source,
          contentType: resource.content_type,
          policy: resource.policy,
          enabled: resource.enabled,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: schema.resources.slug,
          set: {
            kind: resource.kind,
            source: resource.source,
            contentType: resource.content_type,
            policy: resource.policy,
            enabled: resource.enabled,
            updatedAt: now,
          },
        })
        .run();
  });
}
export function syncTokens(store: Store, config: Config, now = Date.now()) {
  store.db.transaction((tx) => {
    for (const token of config.tokens) {
      const value = {
        label: token.label,
        secretHash: token.secret_sha256,
        scope: token.scope,
        kind: token.kind,
        expiresAt: token.expires_at ?? null,
      };
      tx.insert(schema.tokens)
        .values({ id: token.id, ...value, createdAt: now })
        .onConflictDoUpdate({ target: schema.tokens.id, set: value })
        .run();
    }
  });
}
export function issueToken(
  store: Store,
  input: { label: string; scope: string[]; kind: "machine" | "device"; expiresAt?: number | null },
  pepper = "",
  now = Date.now(),
) {
  const secret = randomBytes(32).toString("base64url");
  const id = ulid();
  store.db
    .insert(schema.tokens)
    .values({
      id,
      label: input.label,
      scope: input.scope,
      kind: input.kind,
      secretHash: hashToken(secret, pepper),
      expiresAt: input.expiresAt ?? null,
      createdAt: now,
    })
    .run();
  return { id, secret };
}
export function setState(store: Store, key: string, value: string) {
  store.db
    .insert(schema.state)
    .values({ key, value })
    .onConflictDoUpdate({ target: schema.state.key, set: { value } })
    .run();
}
export function getState(store: Store, key: string): string | undefined {
  return store.db.select().from(schema.state).where(eq(schema.state.key, key)).get()?.value;
}
