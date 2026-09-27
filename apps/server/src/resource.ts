import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { resources } from "./schema.js";
export type Fetcher = typeof fetch;
export async function containedFile(root: string, path: string): Promise<Buffer> {
  const rootPath = await realpath(root);
  const target = await realpath(resolve(rootPath, path));
  const rel = relative(rootPath, target);
  if (rel === ".." || rel.startsWith("../") || isAbsolute(rel))
    throw new Error("File escapes configured root");
  return readFile(target);
}
export async function serveResource(
  resource: typeof resources.$inferSelect,
  request: Request,
  fileRoot: string,
  fetcher: Fetcher = fetch,
): Promise<Response> {
  if (!["GET", "HEAD"].includes(request.method))
    return new Response("Method not allowed / 方法不允许\n", {
      status: 405,
      headers: { Allow: "GET, HEAD" },
    });
  if (resource.kind === "upstream") {
    const headers = new Headers();
    for (const name of ["range", "if-none-match", "if-modified-since", "if-range"]) {
      const value = request.headers.get(name);
      if (value) headers.set(name, value);
    }
    const response = await fetcher(resource.source, {
      method: request.method,
      headers,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
    });
    const safeHeaders = new Headers({
      "Cache-Control": "private, no-store",
      "Content-Type": resource.contentType,
    });
    for (const name of [
      "content-type",
      "content-length",
      "etag",
      "last-modified",
      "content-range",
      "accept-ranges",
    ]) {
      const value = response.headers.get(name);
      if (value) safeHeaders.set(name, value);
    }
    return new Response(response.body, { status: response.status, headers: safeHeaders });
  }
  const body =
    resource.kind === "inline"
      ? Buffer.from(resource.source)
      : await containedFile(fileRoot, resource.source);
  const etag = `"${createHash("sha256").update(body).digest("hex")}"`;
  const headers = new Headers({
    "Content-Type": resource.contentType,
    ETag: etag,
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  });
  const candidates = request.headers
    .get("if-none-match")
    ?.split(",")
    .map((s) => s.trim().replace(/^W\//, ""));
  if (candidates?.some((value) => value === "*" || value === etag))
    return new Response(null, { status: 304, headers });
  let selected = body;
  let status = 200;
  const range = request.method === "GET" ? request.headers.get("range") : null;
  const ifRange = request.headers.get("if-range");
  if (range && (!ifRange || ifRange === etag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (!match[1] && !match[2]))
      return new Response(null, {
        status: 416,
        headers: { ...Object.fromEntries(headers), "Content-Range": `bytes */${body.length}` },
      });
    const start = match[1] ? Number(match[1]) : Math.max(0, body.length - Number(match[2]));
    const end =
      match[1] && match[2] ? Math.min(body.length - 1, Number(match[2])) : body.length - 1;
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start > end ||
      start >= body.length
    )
      return new Response(null, {
        status: 416,
        headers: { ...Object.fromEntries(headers), "Content-Range": `bytes */${body.length}` },
      });
    selected = body.subarray(start, end + 1);
    status = 206;
    headers.set("Content-Range", `bytes ${start}-${end}/${body.length}`);
  }
  headers.set("Content-Length", String(selected.length));
  return new Response(request.method === "HEAD" ? null : new Uint8Array(selected), {
    status,
    headers,
  });
}
