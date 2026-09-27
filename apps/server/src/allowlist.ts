import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { normalizeIp, parseAllowlistValue } from "@key-master/core";
import { and, asc, eq, isNull } from "drizzle-orm";
import { ulid } from "ulid";
import type { Config } from "./config.js";
import type { Store } from "./db.js";
import * as schema from "./schema.js";

export function syncAllowlist(store: Store, config: Config, now = Date.now()) {
  store.db.transaction((tx) => {
    for (const entry of config.allowlist.entries) {
      const parsed = parseAllowlistValue(entry.value);
      if (!parsed) throw new Error("Invalid allowlist value");
      const old = tx.select().from(schema.allowlist).where(eq(schema.allowlist.id, entry.id)).get();
      const value = {
        ...parsed,
        label: entry.label,
        scope: entry.scope,
        source: "config" as const,
        createdBy: "config",
      };
      tx.insert(schema.allowlist)
        .values({ id: entry.id, ...value, createdAt: now })
        .onConflictDoUpdate({
          target: schema.allowlist.id,
          set: {
            ...value,
            ...(old?.value !== parsed.value ? { resolved: [], resolvedAt: null } : {}),
          },
        })
        .run();
    }
  });
}

export function createAllowlist(
  store: Store,
  input: {
    value: string;
    label: string;
    scope: string[];
    source: "telegram" | "admin" | "command";
    createdBy: string;
  },
  now: number,
) {
  const parsed = parseAllowlistValue(input.value);
  if (!parsed) throw new Error("Invalid allowlist value");
  const row = { ...input, ...parsed, id: ulid(), createdAt: now };
  store.db.insert(schema.allowlist).values(row).run();
  return row;
}
export function revokeAllowlist(store: Store, id: string, now: number): boolean {
  return (
    store.db
      .update(schema.allowlist)
      .set({ revokedAt: now })
      .where(and(eq(schema.allowlist.id, id), isNull(schema.allowlist.revokedAt)))
      .run().changes > 0
  );
}

type Dns = Pick<Resolver, "resolve4" | "resolve6">;
export class AllowlistResolver {
  private running: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private stopped = false;
  constructor(
    private store: Store,
    private intervalSeconds: number,
    private dns: Dns = new Resolver({ timeout: 5000, tries: 1 }),
    private clock: () => number = Date.now,
  ) {}
  refresh(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.running) return this.running;
    this.running = this.resolveEntries().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async resolveEntries() {
    const entries = this.store.db
      .select()
      .from(schema.allowlist)
      .where(and(eq(schema.allowlist.kind, "host"), isNull(schema.allowlist.revokedAt)))
      .orderBy(asc(schema.allowlist.resolvedAt))
      .limit(1000)
      .all();
    // Each tick makes at most 2,000 DNS calls, with no retries or overlapping ticks.
    for (const entry of entries) {
      if (this.stopped) return;
      const results = await Promise.allSettled([
        this.dns.resolve4(entry.value),
        this.dns.resolve6(entry.value),
      ]);
      if (this.stopped) return;
      const failed = results.some(
        (result) =>
          result.status === "rejected" && (result.reason as { code?: string })?.code !== "ENODATA",
      );
      const addresses = results
        .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
        .filter((ip) => isIP(ip) !== 0)
        .map((ip) => normalizeIp(ip) ?? ip);
      // A failed family lookup preserves the complete previous snapshot, including IPv6.
      if (failed || addresses.length === 0) {
        this.store.db
          .insert(schema.botEvents)
          .values({
            id: ulid(),
            ts: this.clock(),
            actor: "system",
            event: `allowlist_resolve_failed:${entry.id}`,
          })
          .run();
        continue;
      }
      this.store.db
        .update(schema.allowlist)
        .set({ resolved: [...new Set(addresses)], resolvedAt: this.clock() })
        .where(
          and(
            eq(schema.allowlist.id, entry.id),
            eq(schema.allowlist.value, entry.value),
            isNull(schema.allowlist.revokedAt),
          ),
        )
        .run();
    }
  }
  start() {
    const initial = this.refresh();
    this.timer = setInterval(() => {
      void this.refresh();
    }, this.intervalSeconds * 1000);
    this.timer.unref();
    return initial;
  }
  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }
}
