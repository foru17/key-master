import { closeSync, fstatSync, openSync, readSync } from "node:fs";
import { detectClient, normalizeIp } from "@key-master/core";
import { ulid } from "ulid";
import { z } from "zod";
import { getState, type Store, setState } from "./db.js";
import { requests } from "./schema.js";

const entrySchema = z.object({
  time_iso8601: z.string(),
  remote_addr: z.string(),
  request_method: z.string(),
  uri: z.string(),
  status: z.coerce.number().int().min(100).max(599),
  body_bytes_sent: z.coerce.number().int().nonnegative(),
  request_time: z.coerce.number().nonnegative(),
  http_user_agent: z.string().default(""),
  km_source: z.literal("direct"),
});
export function ingestLine(store: Store, line: string): boolean {
  try {
    const entry = entrySchema.parse(JSON.parse(line));
    const ip = normalizeIp(entry.remote_addr);
    const ts = Date.parse(entry.time_iso8601);
    if (!ip || !Number.isFinite(ts)) return false;
    const path = entry.uri.split("?")[0] ?? "/";
    store.db
      .insert(requests)
      .values({
        id: ulid(),
        ts,
        ip,
        ua: entry.http_user_agent.slice(0, 1024),
        clientFamily: detectClient(entry.http_user_agent),
        method: entry.request_method,
        path,
        resourceSlug: path,
        decision:
          entry.status < 400 ? "allow_token" : entry.status === 404 ? "not_found" : "deny_unknown",
        status: entry.status,
        bytes: entry.body_bytes_sent,
        latencyMs: Math.round(entry.request_time * 1000),
        source: "nginx",
      })
      .run();
    return true;
  } catch {
    return false;
  }
}
export function tailNginx(store: Store, path: string): { imported: number; skipped: number } {
  const key = `nginx:${path}`;
  let fd: number;
  try {
    fd = openSync(path, "r");
  } catch {
    return { imported: 0, skipped: 0 };
  }
  try {
    const stat = fstatSync(fd);
    const identity = `${stat.dev}:${stat.ino}`;
    const previous = getState(store, key);
    const cursor = previous ? (JSON.parse(previous) as { identity: string; offset: number }) : null;
    let offset = cursor?.identity === identity && cursor.offset <= stat.size ? cursor.offset : 0;
    const buffer = Buffer.alloc(Math.min(1024 * 1024, stat.size - offset));
    const size = readSync(fd, buffer, 0, buffer.length, offset);
    let start = 0;
    let imported = 0;
    let skipped = 0;
    store.db.transaction(() => {
      for (let count = 0; count < 2000; count++) {
        const end = buffer.indexOf(10, start);
        if (end === -1 || end >= size) break;
        if (ingestLine(store, buffer.subarray(start, end).toString("utf8"))) imported++;
        else skipped++;
        start = end + 1;
      }
      if (start === 0 && size === 1024 * 1024) {
        start = size;
        skipped++;
      }
      offset += start;
      setState(store, key, JSON.stringify({ identity, offset }));
    });
    return { imported, skipped };
  } finally {
    closeSync(fd);
  }
}
