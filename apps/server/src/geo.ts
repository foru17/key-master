import { existsSync } from "node:fs";
import { join } from "node:path";
import { type IpScope, ipScope, normalizeIp } from "@key-master/core";
import { eq } from "drizzle-orm";
import type { Config } from "./config.js";
import type { Store } from "./db.js";
import * as schema from "./schema.js";

/** Where an address comes from, for humans. Display-only: decisions never read it. */
export type IpInfo = {
  ip: string;
  scope: IpScope;
  country: string | null;
  countryName: string | null;
  city: string | null;
  continent: string | null;
  asn: string | null;
  asName: string | null;
  asDomain: string | null;
  source: "online" | "mmdb" | "none";
};
type Fields = Omit<IpInfo, "ip" | "scope" | "source">;
type MmdbRecord = {
  country?: { iso_code?: string; names?: Record<string, string> };
  registered_country?: { iso_code?: string; names?: Record<string, string> };
  continent?: { code?: string };
  city?: { names?: Record<string, string> };
  autonomous_system_number?: number;
  autonomous_system_organization?: string;
};
type Reader = { get(ip: string): MmdbRecord | null };

const FAIL_COOLDOWN_MS = 30 * 60 * 1000;
const MEMORY_LIMIT = 5000;
const MAX_CONCURRENT = 4;
const MAX_QUEUE = 200;
const blank: Fields = {
  country: null,
  countryName: null,
  city: null,
  continent: null,
  asn: null,
  asName: null,
  asDomain: null,
};
const str = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, 200);
  return trimmed.length ? trimmed : null;
};
const english = (names?: Record<string, string>) =>
  str(names?.en) ?? str(Object.values(names ?? {})[0]);

export class GeoService {
  private memory = new Map<string, IpInfo>();
  private failed = new Map<string, number>();
  private inflight = new Map<string, Promise<IpInfo>>();
  private active = 0;
  private waiting: (() => void)[] = [];
  private readers: Promise<{ city: Reader; asn: Reader } | null> | null = null;

  constructor(
    private store: Store,
    private config: Config,
    private fetchImpl: typeof fetch = fetch,
    private clock: () => number = Date.now,
  ) {}

  get enabled() {
    return this.config.geo.provider !== "off";
  }

  /** Non-blocking: cached answer or null (a background lookup is started for public misses). */
  cached(raw: string): IpInfo | null {
    const ip = normalizeIp(raw) ?? raw;
    const scope = ipScope(ip);
    if (scope !== "public" || !this.enabled) return { ip, scope, ...blank, source: "none" };
    const hit = this.fromCache(ip);
    if (hit) return hit;
    void this.lookup(ip).catch(() => undefined);
    return null;
  }

  /** Resolves within waitMs (defaults to geo.timeout_ms); never rejects. */
  async lookup(raw: string, waitMs = this.config.geo.timeout_ms): Promise<IpInfo> {
    const ip = normalizeIp(raw) ?? raw;
    const scope = ipScope(ip);
    const none: IpInfo = { ip, scope, ...blank, source: "none" };
    if (scope !== "public" || !this.enabled) return none;
    const hit = this.fromCache(ip);
    if (hit) return hit;
    const failedAt = this.failed.get(ip);
    if (failedAt && this.clock() - failedAt < FAIL_COOLDOWN_MS) return none;
    let job = this.inflight.get(ip);
    if (!job) {
      if (this.inflight.size >= MAX_QUEUE) return none;
      job = this.run(ip, none).finally(() => this.inflight.delete(ip));
      this.inflight.set(ip, job);
    }
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<IpInfo>((resolve) => {
      timer = setTimeout(() => resolve(none), waitMs);
    });
    try {
      return await Promise.race([job, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  private fromCache(ip: string): IpInfo | null {
    const now = this.clock();
    const maxAge = this.config.geo.cache_days * 86400000;
    const mem = this.memory.get(ip);
    if (mem) return mem;
    const row = this.store.db.select().from(schema.ipGeo).where(eq(schema.ipGeo.ip, ip)).get();
    if (!row || now - row.fetchedAt > maxAge) return null;
    const info: IpInfo = {
      ip,
      scope: "public",
      ...blank,
      ...(row.data as Partial<Fields>),
      source: row.source,
    };
    this.remember(info);
    return info;
  }

  private remember(info: IpInfo) {
    this.memory.delete(info.ip);
    this.memory.set(info.ip, info);
    while (this.memory.size > MEMORY_LIMIT) {
      const oldest = this.memory.keys().next().value;
      if (oldest === undefined) break;
      this.memory.delete(oldest);
    }
  }

  private async slot() {
    if (this.active < MAX_CONCURRENT) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
  }

  private release() {
    this.active -= 1;
    this.waiting.shift()?.();
  }

  private async run(ip: string, none: IpInfo): Promise<IpInfo> {
    await this.slot();
    try {
      const provider = this.config.geo.provider;
      const fields = provider === "mmdb" ? await this.fromMmdb(ip) : await this.fromOnline(ip);
      if (!fields) {
        this.failed.set(ip, this.clock());
        return none;
      }
      const source = provider === "mmdb" ? "mmdb" : "online";
      const info: IpInfo = { ip, scope: "public", ...fields, source };
      const now = this.clock();
      this.store.db
        .insert(schema.ipGeo)
        .values({ ip, data: fields, source, fetchedAt: now })
        .onConflictDoUpdate({
          target: schema.ipGeo.ip,
          set: { data: fields, source, fetchedAt: now },
        })
        .run();
      this.failed.delete(ip);
      this.remember(info);
      return info;
    } catch {
      this.failed.set(ip, this.clock());
      return none;
    } finally {
      this.release();
    }
  }

  private async fromOnline(ip: string): Promise<Fields | null> {
    const template = this.config.geo.online_url;
    let url: string;
    if (template.includes("{ip}")) url = template.replaceAll("{ip}", encodeURIComponent(ip));
    else {
      const parsed = new URL(template);
      parsed.searchParams.set("ip", ip);
      url = parsed.toString();
    }
    const response = await this.fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(this.config.geo.timeout_ms * 3, 5000)),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as Record<string, unknown>;
    if (data.reserved === true) return { ...blank, countryName: "Reserved" };
    const asnRaw = str(data.asn);
    return {
      country: str(data.country)?.toUpperCase().slice(0, 2) ?? null,
      countryName: str(data.country_name),
      city: str(data.city),
      continent: str(data.continent),
      asn: asnRaw ? (/^\d+$/.test(asnRaw) ? `AS${asnRaw}` : asnRaw.toUpperCase()) : null,
      asName: str(data.as_name),
      asDomain: str(data.as_domain),
    };
  }

  private async fromMmdb(ip: string): Promise<Fields | null> {
    this.readers ??= this.openReaders();
    const readers = await this.readers;
    if (!readers) return null;
    const city = readers.city.get(ip);
    const asn = readers.asn.get(ip);
    if (!city && !asn) return null;
    const country = city?.country ?? city?.registered_country;
    return {
      country: str(country?.iso_code),
      countryName: english(country?.names),
      city: english(city?.city?.names),
      continent: str(city?.continent?.code),
      asn: asn?.autonomous_system_number ? `AS${asn.autonomous_system_number}` : null,
      asName: str(asn?.autonomous_system_organization),
      asDomain: null,
    };
  }

  private async openReaders(): Promise<{ city: Reader; asn: Reader } | null> {
    const dir = this.config.geo.mmdb_dir;
    const cityPath = join(dir, "GeoLite2-City.mmdb");
    const asnPath = join(dir, "GeoLite2-ASN.mmdb");
    if (!existsSync(cityPath) || !existsSync(asnPath)) return null;
    const maxmind = await import("maxmind");
    const [city, asn] = await Promise.all([maxmind.open(cityPath), maxmind.open(asnPath)]);
    return { city: city as Reader, asn: asn as Reader };
  }
}

/** Regional-indicator flag emoji for an ISO 3166-1 alpha-2 country code. */
export function flag(country: string | null): string {
  if (!country || !/^[A-Z]{2}$/.test(country)) return "";
  return String.fromCodePoint(...[...country].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
