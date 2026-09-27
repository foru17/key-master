import { randomBytes, randomInt } from "node:crypto";
import { hashToken, tokenMatches } from "@key-master/core";
import { eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { Store } from "./db.js";
import * as schema from "./schema.js";

export function createLoginCode(store: Store, secret: string, now: number) {
  const code = String(randomInt(0, 1000000)).padStart(6, "0");
  store.db.transaction((tx) => {
    tx.update(schema.loginCodes).set({ usedAt: now }).where(isNull(schema.loginCodes.usedAt)).run();
    tx.insert(schema.loginCodes)
      .values({ id: ulid(), secretHash: hashToken(code, secret), expiresAt: now + 300000 })
      .run();
  });
  return code;
}
export function redeemCode(store: Store, code: string, secret: string, now: number) {
  return store.sqlite.transaction(() => {
    const row = store.db
      .select()
      .from(schema.loginCodes)
      .where(isNull(schema.loginCodes.usedAt))
      .get();
    if (!row || row.expiresAt <= now || !tokenMatches(code, row.secretHash, secret)) return null;
    store.db
      .update(schema.loginCodes)
      .set({ usedAt: now })
      .where(eq(schema.loginCodes.id, row.id))
      .run();
    const session = randomBytes(32).toString("base64url");
    store.sqlite.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
    store.sqlite
      .prepare("INSERT INTO sessions (secret_hash, expires_at) VALUES (?, ?)")
      .run(hashToken(session, secret), now + 43200000);
    return session;
  })();
}
export function rateLimit(store: Store, key: string, limit: number, window: number, now: number) {
  return store.sqlite.transaction(() => {
    store.sqlite.prepare("DELETE FROM auth_limits WHERE expires_at <= ?").run(now);
    store.sqlite
      .prepare(
        "INSERT INTO auth_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
      )
      .run(key, now + window);
    return (
      (
        store.sqlite.prepare("SELECT count FROM auth_limits WHERE key = ?").get(key) as {
          count: number;
        }
      ).count <= limit
    );
  })();
}
