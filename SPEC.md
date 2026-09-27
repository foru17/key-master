# key-master — specification

Self-hosted gatekeeper that serves arbitrary resources (files, inline content, upstream URLs) only to callers that
hold a machine token, match an owner-managed long-term allowlist, or hold a time-limited grant approved by the owner on Telegram. Every request is recorded for audit.

This file is the contract for implementation. Keep it in sync with the code. All identifiers in English.
The repository is meant to be open source: **no real domains, IPs, tokens, bot names or subscription content**
anywhere in the repo. Use `example.com`, `203.0.113.0/24`, `YOUR_BOT_TOKEN` style placeholders.

## Stack

- TypeScript, Node 22+, pnpm workspace.
- Server: Hono (`@hono/node-server`), SQLite via `better-sqlite3` + Drizzle ORM (migrations checked in).
- Admin UI: React 19 + Vite + Tailwind 4, built into static assets served by the server under `/admin`.
- Tests: Vitest. Lint/format: Biome.
- Single Docker image (multi-stage), `docker-compose.yml` example. Health check `GET /healthz` → 200.

## Layout

```
apps/server     Hono app, Telegram bot, decision engine, audit, log ingest
apps/admin      React admin SPA
packages/core   pure logic shared by server + tests: client detection, decision function, token hashing
config.example.yaml, .env.example, Dockerfile, docker-compose.yml, README.md (English), LICENSE (MIT)
```

## Concepts and data model (SQLite)

- `resources`: id, slug (URL path, e.g. `/clash`), kind (`file` | `inline` | `upstream`), source (file path under a
  configured root / inline body / upstream URL), content_type, policy (`token_only` | `approval` | `public`),
  enabled, created_at, updated_at. Resources can also be declared in `config.yaml` (synced to DB at boot).
- `tokens`: id, label, secret_hash (sha256 hex), scope (JSON array of slugs or `["*"]`), kind (`machine` | `device`),
  expires_at (nullable), last_used_at, revoked_at, created_at. The plaintext is shown once at creation.
  Config `tokens[]` imports `{id, label, secret_sha256, scope, kind: machine, expires_at?}` at boot, upserting
  by id while preserving created/last-used/revoked timestamps. SHA-256 hex only; no plaintext. Expiry accepts
  zoned ISO timestamps or Unix milliseconds. Removal from config does not delete the DB entry.
- `grants`: id, subject_kind (`ip` | `ip_client`), subject (IP or `IP|client_family`), scope (slugs or `*`),
  granted_by (`telegram:<user id>` | `admin:<user>` | `command`), expires_at, revoked_at, created_at.
- `allowlist`: id, label, value (IPv4/IPv6, CIDR or DNS hostname), kind (`ip` | `cidr` | `host`, inferred
  from value), scope (JSON slugs, default `["*"]`), source (`config` | `telegram` | `admin` | `command`),
  created_by, created_at, revoked_at (nullable), resolved (JSON array, default `[]`), resolved_at (nullable),
  last_matched_at (nullable). Active until revoked; no expiry. Config imports upsert by id, preserving
  created/last-matched/revoked timestamps; deleting configuration entries does not delete DB rows.
- `requests` (append-only audit): id (ULID, also shown to the caller as request id), ts, ip, ua, client_family,
  method, path, resource_slug (nullable), decision (`allow_token` | `allow_allowlist` | `allow_grant` | `allow_internal` | `allow_public`
  | `deny_pending` | `deny_blocked` | `deny_unknown` | `not_found`), token_id, grant_id, allowlist_id (nullable), status, bytes, latency_ms,
  source (`app` | `nginx`).
- `approvals`: id, request_id, subject, tg_message_id, action (`allow` | `deny` | `device_token` | `always`), actor, duration_s, ts.
- `blocks`: subject, until, reason (deny suppresses notifications until `until`).

## Decision (packages/core, pure function, table-driven tests)

Input: resource, client ip, ua, query token, now, allowlist entries (including resolved addresses and revocation), active grants/blocks, internal CIDRs. Order:
1. resource missing or disabled → `not_found` (404, same body as a static 404; never reveal existence).
2. policy `public` → `allow_public`.
3. valid token for the resource (constant-time compare of sha256) → `allow_token`.
4. client IP in `internal_cidrs` → `allow_internal`.
5. policy `token_only` → `deny_unknown` (403, no notification).
6. non-revoked allowlist entry covering the resource and matching the client IP → `allow_allowlist`.
   Fixed IPs match exactly; CIDRs match their prefix; hostname IPv4 answers match exactly and IPv6 answers
   match /64. Record `allowlist_id`, leave `grant_id` null, and update `last_matched_at`.
7. active grant for `ip` or `ip|client_family` → `allow_grant`.
8. active block → `deny_blocked` (403, no notification).
9. otherwise → `deny_pending` (403) and notify owner (at most one notification per subject per pending window).

HEAD / Range / If-None-Match must not bypass the decision: evaluate first, then serve (304 only after allow).

## Allowlist validation and DNS refresh

- CIDRs must be IPv4 /24–/32 or IPv6 /48–/128. Reject wider networks in config, Telegram and admin API.
  Canonicalize CIDR network bits; IPv4-mapped IPv6 CIDRs are rejected to avoid ambiguous prefix semantics.
- Hostnames use ASCII DNS labels, at least two labels, no wildcards, URLs, ports, underscores or empty labels.
  Normalize case and an optional trailing dot. Punycode labels are supported. Invalid numeric IP forms are
  not treated as hostnames. Entry values and labels are bounded; scopes are validated resource paths or `*`.
- Background refresh starts immediately at boot, then every `allowlist.resolve_interval_s` (default 300,
  inclusive range 60–86400). Resolve A and AAAA. Successful snapshots replace previous results; lookups never
  happen inside the pure decision function. Fixed IP/CIDR entries do not use DNS.
- A lookup failure (including one failed address family), or no usable answers, preserves the complete previous
  snapshot and `resolved_at`, and records `allowlist_resolve_failed:<id>` in `bot_events`. ENODATA for one family
  is valid when the other family has addresses. On first failure with no previous answers the entry cannot match.
- Each tick handles at most 1,000 active host entries / 2,000 DNS calls, with a 5-second resolver timeout,
  one try, no overlapping refreshes, and clean shutdown. Newly added hosts resolve on the next tick.
- Config label/value/kind/scope/source fields are synced by id. DNS cache is preserved for unchanged values;
  changing the value clears its old DNS cache. Upsert never reactivates a revoked entry.
- Migration `0003_allowlist.sql` adds the table and request reference, preserves prior requests/approvals,
  extends decision/action constraints, and restores audit indexes and append-only triggers.
- Observe mode remains unchanged: denied decisions may serve enabled resources while retaining the original
  decision and actual HTTP status. Allowlist entries never bypass `token_only` denial.

## Client detection (packages/core)

`client_family` from User-Agent (case-insensitive, first match): `clash-verge`, `stash`, `mihomo` (`mihomo`,
`clash.meta`, `clashmeta`), `clashx`, `clash` (`clash`), `surge` (`surge`), `shadowrocket`, `quantumult-x`
(`quantumult%20x`, `quantumult x`), `loon`, `sing-box` (`sing-box`, `sfi`, `sfa`, `sfm`), `v2rayn`/`v2rayng`,
`surfboard`, `curl`, `wget`, `python`, `browser` (`mozilla/` and `Accept` contains `text/html`), else `unknown`.
Table-driven tests with real UA samples.

### Client description and source details (display only)

Decisions only ever use `client_family`. For humans, `describeUserAgent(ua)` (packages/core) returns
`{ kind, name, version, os, osVersion, device, label }` with `kind` one of `proxy`, `browser`, `system`
(e.g. Apple WebKit networking / CFNetwork apps), `tool` (curl, scripts, HTTP libraries), `preview` (chat link
previews), `crawler`, `scanner`, `unknown`. Scanners, crawlers and previews are matched before browsers because
they embed browser tokens. Darwin kernel versions are shown verbatim, never mapped to marketing versions.
`ipScope(ip)` classifies `public`, `private`, `loopback`, `cgnat` (100.64.0.0/10 and the Tailscale ULA
fd7a:115c:a1e0::/48), `link_local`, `reserved`, `invalid`.

Source details (`geo`, apps/server) are opt-in: `provider: off` (default) sends nothing anywhere. `online`
GETs `online_url` (`{ip}` placeholder, otherwise `?ip=` is appended) and reads the JSON fields `country`,
`country_name`, `city`, `asn`, `as_name`, `as_domain`, `continent`, `reserved`. `mmdb` reads local
`GeoLite2-City.mmdb` + `GeoLite2-ASN.mmdb` from `mmdb_dir`, so no address leaves the host. Only `public`
addresses are ever looked up. Results are cached in SQLite (`ip_geo`, `cache_days`), concurrent lookups for one
address are merged, at most 4 run at once, failures cool down for 30 minutes. Telegram approval messages wait at
most `timeout_ms` for a lookup and are sent without location otherwise; admin lists read the cache only and fill
in on the next poll. Admin JSON adds `ipInfo` (requests, approvals, grants, overview IPs) and `client`
(requests, approvals); resources add `requests24h`, `denied24h`, `lastRequestAt`.

## Denied responses (never 2xx, never a config body)

Proxy clients replace their whole node list when a subscription returns 200, so a "notice node" config would wipe
the user's nodes. Always non-2xx so clients keep the cached copy.
- `browser`: 403 `text/html` notice page (i18n zh/en by `Accept-Language`, light/dark via `prefers-color-scheme`),
  formats time using `notice.timezone` (IANA, default UTC), labels the zone, and exposes ISO on hover;
  shows: "access requires the administrator's approval", request id, time, contact line from config
  (`notice.contact_text`, `notice.contact_url`; defaults: generic "please contact the administrator", no URL).
  `Cache-Control: no-store`.
- every other family: 403 `text/plain; charset=utf-8`, one line: notice + request id + contact text.
- `not_found`: 404 identical to the fronting web server's static 404 (configurable body).
- Header `X-Request-Id` on every response.

## Telegram (apps/server/bot)

- Mode `polling` (default, getUpdates long poll) or `webhook` (secret path + `X-Telegram-Bot-Api-Secret-Token`).
- Only `owner_chat_ids` may act; everything else is ignored and audited.
- Pending message: resource(s), ip, client family + raw UA (trimmed), time, request id; inline buttons:
  `Allow 10 min` | `Allow 1 h` | `Issue device token` | `Deny 1 h` (durations configurable). After a choice the
  message is edited to show the outcome. A third button row adds `Always allow this IP` / `长期放行此 IP`
  (`always:<pending id>`). It creates a wildcard-scope entry with source `telegram`, label
  `telegram <client_family> <UTC date>`, and the request IP (IPv6 normalized to a /64 CIDR). Entry creation,
  approval history (`always`, duration 0), pending resolution and removal of that subject/IP block are atomic.
  Expired, resolved or unrelated-message callbacks are rejected. `Issue device token` creates a `device` token scoped to the requested
  slugs and replies with ready-to-copy URLs (`<public_base_url><slug>?k=<token>`).
- Commands: `/status` (active grants, blocks, recent pending), `/grant <ip> [minutes]`, `/revoke <ip|token id>`,
  `/allow <ip|cidr|host> [label]` (source `command`, default label is value, wildcard scope),
  `/allowlist` (latest 50 active entries, id/label/value/resolved addresses/last match, each with a Remove button),
  `/unallow <id>` (soft revoke), `/tokens`, `/audit [n]` (last n requests), `/login` (one-time code for the admin UI), `/help`.
- Owner-facing texts support zh/en (`bot.lang`).

## Admin UI (/admin)

- Login: popup dialog; code sent to the owner chat via Telegram (6 digits, 5 min, single use); session cookie
  (HttpOnly, Secure, SameSite=Strict, 12 h). Also `admin.allowed_cidrs` checked server-side.
- Pages: Overview (requests today, denied, pending, active grants), Audit (filter by time, ip, client family,
  resource, decision; request detail drawer), Grants (list, revoke, create), Tokens (issue, revoke, last used),
  Resources (list/create/edit/disable), Settings (observe mode toggle, durations, notice texts).
- Grants begins with a long-term Allowlist section (label/value/scope, kind pill, resolved IPs, last match,
  source), with a value/label/scope add dialog and an in-page remove confirmation popover. Requests supports
  `allow_allowlist` filtering and a green pill; details show the matched entry including revoked history.
  Request details and Overview pending cards offer `Always allow this IP`; IPv6 quick actions use /64.
- `GET /api/admin/allowlist` returns up to 1,000 active entries. `POST /api/admin/allowlist` accepts
  `{value,label,scope?}` or `{requestId}` for the request quick action; inferred kind, source `admin` and creator
  `admin:owner` are server-owned. `DELETE /api/admin/allowlist/:id` sets `revoked_at`, preserving audit history.
  `POST /api/admin/approvals/:id` also accepts `action: always`. Existing session/CIDR/origin checks and mutation
  audit apply to every endpoint. Quick actions clear the corresponding pending subject and IP/subject block.
- Admin timestamps use the browser local timezone and current UI language, with ISO values on hover.
- Modern SaaS look, light + dark (both must pass contrast), responsive (phone width), zh/en.

## Nginx front (docs/nginx.md, example only)

Token paths are served by nginx directly (no dependency on key-master); nginx writes a JSON access log that
key-master ingests (`ingest.nginx_log`) so audit also covers token-served requests (`source = nginx`).
An optional fixed `km_token_id` log label is copied to audit `token_id` (missing/empty/`-` becomes null).
Requests without a valid token are proxied to key-master. Provide the example config with placeholder names.

## Config

`config.yaml` (see `config.example.yaml`) + env for secrets: `KM_TELEGRAM_TOKEN`, `KM_SESSION_SECRET`,
`KM_TOKEN_PEPPER` (optional). Keys: `public_base_url`, `listen`, `db_path`, `file_root`, `internal_cidrs`,
`trusted_proxies` (for X-Forwarded-For / X-Real-IP), `observe_mode` (allow everything, still notify + audit),
`telegram.{mode, owner_chat_ids, webhook_secret}`, `durations.{grant_default, options, block}`,
`notice.{contact_text, contact_url, footer, timezone}`, `resources[]`, `tokens[]`, `allowlist`, `ingest.nginx_log`, `admin.allowed_cidrs`.

`allowlist` accepts either an array `[{id,label,value,scope?}]` (300-second refresh) or an object
`{entries: [{id,label,value,scope?}], resolve_interval_s: 300}` to configure the interval. IDs are unique,
1–50 ASCII letters/digits/underscores/hyphens; up to 1,000 configured entries. Default: no entries.

## Acceptance (automated where possible)

1. `pnpm -r test` and `pnpm -r build` pass; `docker build` succeeds; `docker compose up` with `.env.example`
   values starts and `/healthz` → 200.
2. Decision table tests cover every branch above incl. HEAD/Range/304.
3. UA table tests cover each family.
4. Denied responses for each family are non-2xx and never contain `proxies:` / `server:` / `[Proxy]`.
5. Repo contains no real infrastructure identifiers (gitleaks clean; placeholders only).

6. Allowlist tests cover hit/miss/scope/revoked/token-only/IPv6 /64, configuration CIDR/hostname validation,
   historical migration, import timestamp preservation, DNS failure preservation and timer lifecycle,
   owner-only Telegram callbacks/commands, admin CRUD/audit, and UI controls in desktop/mobile/dark modes.
