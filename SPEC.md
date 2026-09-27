# key-master — specification

Self-hosted gatekeeper that serves arbitrary resources (files, inline content, upstream URLs) only to callers that
hold a machine token or a time-limited grant approved by the owner on Telegram. Every request is recorded for audit.

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
- `grants`: id, subject_kind (`ip` | `ip_client`), subject (IP or `IP|client_family`), scope (slugs or `*`),
  granted_by (`telegram:<user id>` | `admin:<user>` | `command`), expires_at, revoked_at, created_at.
- `requests` (append-only audit): id (ULID, also shown to the caller as request id), ts, ip, ua, client_family,
  method, path, resource_slug (nullable), decision (`allow_token` | `allow_grant` | `allow_internal` | `allow_public`
  | `deny_pending` | `deny_blocked` | `deny_unknown` | `not_found`), token_id, grant_id, status, bytes, latency_ms,
  source (`app` | `nginx`).
- `approvals`: id, request_id, subject, tg_message_id, action (`allow` | `deny` | `device_token`), actor, duration_s, ts.
- `blocks`: subject, until, reason (deny suppresses notifications until `until`).

## Decision (packages/core, pure function, table-driven tests)

Input: resource, client ip, ua, query token, now, active grants/blocks, internal CIDRs. Order:
1. resource missing or disabled → `not_found` (404, same body as a static 404; never reveal existence).
2. policy `public` → `allow_public`.
3. valid token for the resource (constant-time compare of sha256) → `allow_token`.
4. client IP in `internal_cidrs` → `allow_internal`.
5. policy `token_only` → `deny_unknown` (403, no notification).
6. active grant for `ip` or `ip|client_family` → `allow_grant`.
7. active block → `deny_blocked` (403, no notification).
8. otherwise → `deny_pending` (403) and notify owner (at most one notification per subject per pending window).

HEAD / Range / If-None-Match must not bypass the decision: evaluate first, then serve (304 only after allow).

## Client detection (packages/core)

`client_family` from User-Agent (case-insensitive, first match): `clash-verge`, `stash`, `mihomo` (`mihomo`,
`clash.meta`, `clashmeta`), `clashx`, `clash` (`clash`), `surge` (`surge`), `shadowrocket`, `quantumult-x`
(`quantumult%20x`, `quantumult x`), `loon`, `sing-box` (`sing-box`, `sfi`, `sfa`, `sfm`), `v2rayn`/`v2rayng`,
`surfboard`, `curl`, `wget`, `python`, `browser` (`mozilla/` and `Accept` contains `text/html`), else `unknown`.
Table-driven tests with real UA samples.

## Denied responses (never 2xx, never a config body)

Proxy clients replace their whole node list when a subscription returns 200, so a "notice node" config would wipe
the user's nodes. Always non-2xx so clients keep the cached copy.
- `browser`: 403 `text/html` notice page (i18n zh/en by `Accept-Language`, light/dark via `prefers-color-scheme`),
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
  message is edited to show the outcome. `Issue device token` creates a `device` token scoped to the requested
  slugs and replies with ready-to-copy URLs (`<public_base_url><slug>?k=<token>`).
- Commands: `/status` (active grants, blocks, recent pending), `/grant <ip> [minutes]`, `/revoke <ip|token id>`,
  `/tokens`, `/audit [n]` (last n requests), `/login` (one-time code for the admin UI), `/help`.
- Owner-facing texts support zh/en (`bot.lang`).

## Admin UI (/admin)

- Login: popup dialog; code sent to the owner chat via Telegram (6 digits, 5 min, single use); session cookie
  (HttpOnly, Secure, SameSite=Strict, 12 h). Also `admin.allowed_cidrs` checked server-side.
- Pages: Overview (requests today, denied, pending, active grants), Audit (filter by time, ip, client family,
  resource, decision; request detail drawer), Grants (list, revoke, create), Tokens (issue, revoke, last used),
  Resources (list/create/edit/disable), Settings (observe mode toggle, durations, notice texts).
- Modern SaaS look, light + dark (both must pass contrast), responsive (phone width), zh/en.

## Nginx front (docs/nginx.md, example only)

Token paths are served by nginx directly (no dependency on key-master); nginx writes a JSON access log that
key-master ingests (`ingest.nginx_log`) so audit also covers token-served requests (`source = nginx`). Requests
without a valid token are proxied to key-master. Provide the example config with placeholder names.

## Config

`config.yaml` (see `config.example.yaml`) + env for secrets: `KM_TELEGRAM_TOKEN`, `KM_SESSION_SECRET`,
`KM_TOKEN_PEPPER` (optional). Keys: `public_base_url`, `listen`, `db_path`, `file_root`, `internal_cidrs`,
`trusted_proxies` (for X-Forwarded-For / X-Real-IP), `observe_mode` (allow everything, still notify + audit),
`telegram.{mode, owner_chat_ids, webhook_secret}`, `durations.{grant_default, options, block}`,
`notice.{contact_text, contact_url, footer}`, `resources[]`, `ingest.nginx_log`, `admin.allowed_cidrs`.

## Acceptance (automated where possible)

1. `pnpm -r test` and `pnpm -r build` pass; `docker build` succeeds; `docker compose up` with `.env.example`
   values starts and `/healthz` → 200.
2. Decision table tests cover every branch above incl. HEAD/Range/304.
3. UA table tests cover each family.
4. Denied responses for each family are non-2xx and never contain `proxies:` / `server:` / `[Proxy]`.
5. Repo contains no real infrastructure identifiers (gitleaks clean; placeholders only).
