# key-master

A self-hosted resource gateway with machine/device tokens, temporary Telegram approvals, and an append-only SQLite audit trail. No telemetry or paid services.

## Architecture

```text
Caller -> optional nginx -> Hono gateway -> file / inline / upstream
               |                 |
          JSON access log    pure decision core
               |                 |
               +-----------> SQLite + Drizzle
                                 |
                         Telegram owner approvals

/admin -> React 19 + Tailwind 4 administration console
```

- `packages/core`: client detection, ordered authorization, SHA-256 token verification, safe denials.
- `apps/server`: Hono, checked-in SQLite migration, YAML/Zod configuration, resource delivery, audit, Telegram bot, nginx tailer.
- `apps/admin`: bilingual Vite/React console with seven pages, secure Telegram login, live approvals, and light/dark/system themes.
- `tasks.json`: implementation checklist and verification evidence.

The decision order is missing/disabled → public → valid token → internal CIDR → token-only denial → active grant → active block → pending approval. HEAD, Range, and conditional GET pass through the same gate. Denials use 403 (404 for absent/disabled resources), never subscription configuration bodies.

## Quick start

Requires Node 22.12+ and pnpm 10.29.2. Native SQLite compilation may require Python, make and a C++ compiler if a prebuilt binary is unavailable.

```sh
cp config.example.yaml config.yaml
cp .env.example .env
pnpm install
pnpm -r test
pnpm -r build
pnpm lint
pnpm start
```

```sh
curl -i http://localhost:3000/healthz
curl -i http://localhost:3000/welcome
curl -i http://localhost:3000/private
```

Expected: health and welcome return 200; private returns 403 and `X-Request-Id`. Visit `/admin` through your HTTPS deployment for the administration console. Localhost supports the secure-cookie preview workflow below. Only `admin.allowed_cidrs` can access it; an empty list denies everyone. The sample permits loopback.

Replace the session-secret placeholder in `.env` with a random secret before deployment. `KM_TELEGRAM_TOKEN=YOUR_BOT_TOKEN` or an empty owner list intentionally disables Telegram for offline startup. Secret values belong only in `.env`, never in tracked configuration. `KM_TOKEN_PEPPER` optionally prefixes secrets before SHA-256; changing it invalidates existing token hashes. `KM_SESSION_SECRET` must contain at least 32 characters and protects login-code hashes.

Resources declared in YAML are upserted on boot; changed fields overwrite that resource's DB values. Removing an entry does not delete it: set `enabled: false` to disable it explicitly. Restart after configuration changes. Paths are relative to the configuration file, selected with `KM_CONFIG` (default `config.yaml`). Durations are seconds, timestamps in the database are Unix milliseconds, and scopes are JSON arrays including `"*"` for all resources.

## Docker

```sh
docker build -t key-master:local .
docker compose --env-file .env.example up -d --wait
curl -i http://localhost:3000/healthz
docker compose down
```

The multi-stage image compiles and tests on Node 22, runs as the unprivileged `node` user, includes SQLite migrations and admin assets, and health-checks `/healthz`. Compose uses a named data volume and binds the HTTP port only to loopback. Change `KM_PORT` to select the host port; keep the container port at 3000 for its healthcheck. The example environment starts without external Telegram calls.

Optionally set `KM_DATA_DIR=./data` to bind a local directory instead of the named volume. Create it first and ensure UID 1000 can write to it. This also permits testing when a Docker Desktop virtual disk has no free space for a SQLite data volume, while the host filesystem still has capacity.

Compose mounts `config.example.yaml` for a reproducible demo. For deployment, copy it to ignored `config.yaml` and change the compose mount source to `./config.yaml`. Grant the configured proxy address access to `/admin` only if appropriate for your deployment; the Docker bridge peer is not loopback. Mount resource files under `/app/data/files`; mount nginx logs read-only and set `ingest.nginx_log` to their container path. Preserve the data volume for tokens, grants, polling offsets and log cursors. Do not run multiple bot pollers for the same token.

## Telegram

Set `KM_TELEGRAM_TOKEN` in `.env` and quoted numeric `telegram.owner_chat_ids` in YAML, then restart. Only configured chats can act; other chats are ignored and recorded in `bot_events`. Use `bot.lang: en` or `zh`. No live bot credentials are included in this repository.

Pending messages contain the resource, IP, client family, trimmed UA, UTC timestamp, request ID and four buttons: allow 10 minutes, allow 1 hour, issue a device token, deny 1 hour. The first two durations and block duration are configurable. Approval updates the original message. Device issuance replies with a URL for each requested resource, using `?k=`; the database stores only the hash. Keep those links private.

| Command | Behavior |
| --- | --- |
| `/status` | Active grants, blocks and recent pending subjects |
| `/grant <ip> [minutes]` | Grant that IP access to all resource slugs |
| `/revoke <ip\|token id>` | Revoke matching grants or a token |
| `/tokens` | Latest 20 tokens, without secrets |
| `/audit [n]` | Latest requests, bounded to 50 |
| `/login` | Issue a hashed 6-digit, 5-minute code; supersede the previous code |
| `/help` | Command reference |

Polling uses 30-second `getUpdates` calls, persisted offsets and a maximum of 100 updates per call. `telegram.max_polls` sets a hard per-process cap (default 10,000); reaching it or eight consecutive failures stops polling and records a `bot_events` entry. Restart to resume. Notifications attempt delivery once per subject per pending window, including after delivery failure, to prevent retry storms. At most 20 owner chats are contacted.

Optional webhook mode is implemented: set `telegram.mode: webhook`, a random `telegram.webhook_path` under `/_telegram/` (at least 24 characters after the prefix), and a distinct `telegram.webhook_secret` of at least 24 characters. Configure Telegram's webhook separately with the matching secret header. The application does not automatically register a webhook. Polling is the default and is the phase-one deployment path.

## Administration

`/admin` includes Overview, Requests, Approvals, Grants, Tokens, Resources and Settings. Use the popup to request a six-digit Telegram code, or issue `/login` in an owner chat. Theme and language preferences stay in local storage; credentials never do. Command-K / Control-K opens search. Mobile navigation uses a drawer and audit tables become cards.

| Endpoint | Methods and behavior |
| --- | --- |
| `/api/auth/request-code`, `/api/auth/verify`, `/api/auth/logout` | POST; request a code, redeem `{code}`, revoke the current session |
| `/api/admin/session` | GET; session status |
| `/api/admin/overview?range=24h` | GET; 24-hour totals, active grants, pending, time buckets, top clients/IPs; also `range=7d` |
| `/api/admin/requests` | GET; `page`, `pageSize` (1–100), `from`, `to` (Unix milliseconds), `decision`, `client`, `resource`, `q` (IP/request ID substring) |
| `/api/admin/requests/:id` | GET; full audit record, safe header subset, matched grant/token IDs |
| `/api/admin/approvals` | GET; pending and recent decisions |
| `/api/admin/approvals/:id` | POST `{action, duration?}`; `allow`, `deny`, `device_token`; same transaction as Telegram buttons |
| `/api/admin/grants`, `/api/admin/grants/:id` | GET/POST collection, PATCH/DELETE item; DELETE revokes, preserving history |
| `/api/admin/tokens`, `/api/admin/tokens/:id` | GET/POST collection, DELETE item; list includes seven-day usage, never secrets or hashes |
| `/api/admin/resources`, `/api/admin/resources/:id` | GET/POST collection, PUT/DELETE item; PUT includes the `enabled` flag |
| `/api/admin/settings` | GET/PUT; observe mode, all durations, notice text/URL/footer; persisted in SQLite |
| `/api/admin/events` | GET; pending snapshot, polled every five seconds, capped at 10,000 polls per mounted session |
| `/api/admin/blocks` | POST `{ip,duration}`; blocks and revokes matching grants; valid tokens/public/internal rules still have precedence |

All mutation bodies are JSON, bounded to 1 MiB. Grants use `{subjectKind,subject,scope,duration}`; `subjectKind` is `ip` or `ip_client`, with an `IP|client_family` subject for the latter. Tokens use `{label,kind,scope,expiresAt?}`; expiry is Unix milliseconds or null. Resources use `{slug,kind,source,content_type,policy,enabled}`. Resource previews expose the source string's byte length and SHA-256 fingerprint, never rendered subscription content. Editing opens source as plain text only.

Code sends allow three attempts per IP and ten globally per five minutes. Verification allows five per IP and thirty globally per five minutes. Limits survive restarts. Telegram identity is fetched once at startup; unavailable metadata is shown honestly. No live Telegram credentials are necessary for tests.

### Local example preview

```sh
pnpm install
pnpm -r build
pnpm seed
pnpm preview:admin
```

Open `http://localhost:4173/admin`. The local-only preview uses a mocked Telegram transport; its single-use code is written to ignored `.verification/telegram-code.txt`. The production entry point never imports this preview or exposes a development login endpoint. `pnpm seed` creates `data/seed.db`, refuses a nonempty database, and generates only example resources, documentation IPs, placeholder UAs, and unissued token hashes. `KM_SEED_DB` may select another empty local database.

```sh
pnpm test:ui
```

After building, this starts its own preview on port 4174 with a freshly seeded `.verification/ui.db`, uses local Chrome through Playwright, checks workflows/contrast/layout, and regenerates `docs/screenshots/`. Install Chrome or change the Playwright channel to your installed Chromium. The only mocked network operation is Telegram delivery (plus the explicit settings-failure test); CRUD tests use the real server and SQLite. The harness deliberately clears rate-limit counters between independent login scenarios; server tests separately assert rate limits. Test databases and one-time codes stay ignored.

## nginx and audit

See [docs/nginx.md](docs/nginx.md) for an example of nginx serving explicitly mapped machine-token requests independently, and proxying other requests to key-master. nginx token mappings are a separate authorization plane: SQLite revocation does not change nginx mappings. Device tokens use the app path unless explicitly mapped in nginx.

Forwarded IP headers are ignored unless the socket peer belongs to `trusted_proxies`. Trusted chains are walked right-to-left to the first untrusted hop. Configure only your actual proxy addresses, not arbitrary client networks.

Every application response, including health/admin/error responses, has a ULID request ID and an audit row. Paths omit query strings to avoid persisting `?k=`. The nginx tailer imports only `km_source: direct` records; app-proxied requests are already audited. It persists inode/offset cursors, waits for complete lines, handles rotation/truncation, and processes at most 1 MiB/2,000 lines per tick. Invalid records are skipped. SQLite triggers reject updates and deletes of `requests`.

## Design notes

- Config `tokens[]` imports existing machine tokens by stable `id` at startup. Only `secret_sha256` is accepted; hash UTF-8 `KM_TOKEN_PEPPER + token` when pepper is configured. Configured label/hash/scope/kind/expiry overwrite those DB fields; created/last-used/revoked timestamps survive upserts. Omitted expiry means no expiry; an expiry may be a zoned ISO string or Unix milliseconds. Removing an entry does not delete/revoke it. nginx remains an independent authorization plane; its fixed `km_token_id` log label links audit rows to imported tokens without logging plaintext. See [nginx import example](docs/nginx.md).

- Admin timestamps use the browser local timezone and selected language, include year/seconds, and expose ISO values on hover. Chart axes stay compact. Server denial pages and their settings previews use `notice.timezone` (validated IANA name, default `UTC`) and label the zone. Persisted UI settings override YAML, including the timezone; legacy settings without a timezone inherit the configured value.

- `docs/DESIGN.md` is the visual contract. Light brass foreground/background alone yields only 4.01:1, so count badges use the existing ink token over brass. Muted rather than faint is used for text and placeholders. Server denial HTML and the SPA import the same theme token source.
- Overview totals count resource traffic, excluding admin/API/health traffic. Audit queries still expose every recorded request. Pending/recent list windows are bounded to 200/100, management lists to 1,000; requests have database pagination and browser virtualization.
- Settings written in the UI override YAML on restart. Resources explicitly declared in YAML are still synced at boot, so edit the YAML too when changing those entries permanently. Requests persist only Accept, Accept-Language, Range and If-None-Match; cookie, authorization and query tokens are never copied into details.
- Admin and Telegram resolve approvals atomically. A stale Telegram button is rejected after an admin decision. UI token plaintext is kept only in the open copy dialog, excluded from query/mutation caches, then discarded.

- Admin sessions store only a secret hash in SQLite, expire after 12 hours, and are deleted on logout. Codes expire after five minutes, supersede earlier codes, and redeem once in a transaction. Cookies always use HttpOnly, Secure and SameSite=Strict; HTTPS is required outside localhost.
- Both admin assets and every authentication/administration API enforce `admin.allowed_cidrs`. Every admin API additionally requires a valid session. SPA routes fall back to its index; missing static assets and unknown resource paths retain a 404. Mutations require JSON and reject cross-origin browser requests.
- Approval subjects are normalized `IP|client_family`; `/grant` creates a broader IP grant. This handles multiple clients at one IP without automatically authorizing all of them.
- `v2rayng` is matched before `v2rayn` to avoid its prefix being misclassified. Browser classification requires both Mozilla UA and HTML Accept. Language follows the first Accept-Language entry, with English fallback.
- `observe_mode` serves existing enabled resources even when the decision would deny, while retaining the original decision and actual HTTP status in audit. Missing/disabled resources still return 404; blocked and token-only subjects still suppress notifications. Do not enable observe mode for resources that must stay private.
- File paths are resolved through symlinks and checked against `file_root`. Protect that directory from untrusted writers. Files and inline bodies are buffered; upstream responses are buffered by audit counting, so this phase targets modest resource sizes rather than large media.
- Only GET and HEAD serve resources. Local single-byte ranges are supported; unsupported or unsatisfiable ranges return 416. HEAD ignores Range. ETags are calculated only after authorization. Upstream conditional/range headers are forwarded only after authorization; caller cookies, authorization headers and query tokens are never forwarded. Upstream redirects fail closed.
- Configured upstream URLs are administrator-controlled HTTP(S) endpoints. No user-controlled URL proxy is exposed. Requests have a 15-second upstream timeout.
- Device tokens do not expire by default and are scoped to requested resources; revoke them with `/revoke`. Machine tokens can be issued through the authenticated admin API; no unauthenticated issuance endpoint exists.
- The database adds `pending`, `bot_events`, `state`, `login_codes`, `sessions`, and `auth_limits` support tables to persist deduplication, unauthorized bot actions, cursors and login-code hashes. Migrations run on startup through Drizzle.
- Core denial templates escape HTML, restrict contact URLs to HTTP(S), remove config-like markers from notice text, and set no-store. The default static 404 body is exactly `404 Not Found\n`.
- External package registries and the Telegram API are software dependencies, not example infrastructure. Deployment examples use reserved domains and documentation IP addresses only.
- The runtime image retains the workspace dependency store for reliable native-module and symlink resolution; build tools are not installed in its OS layer.

## Development and validation

```sh
pnpm test
pnpm build
pnpm lint
```

Core tests are table-driven across every client family and decision branch. Server tests use in-memory SQLite and mocked Telegram/fetch transports, covering denial-before-serving, token revocation, trusted proxies, file containment, append-only audit, nginx rotation, notification deduplication, callbacks, commands and polling bounds. No real Telegram calls are required. Phase-two browser verification and screenshots are recorded in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

MIT licensed; see [LICENSE](LICENSE).
