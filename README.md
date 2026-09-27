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

/admin -> compiled React 19 + Tailwind 4 placeholder
```

- `packages/core`: client detection, ordered authorization, SHA-256 token verification, safe denials.
- `apps/server`: Hono, checked-in SQLite migration, YAML/Zod configuration, resource delivery, audit, Telegram bot, nginx tailer.
- `apps/admin`: Vite/React placeholder. Interactive administration and session login are phase two.
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

Expected: health and welcome return 200; private returns 403 and `X-Request-Id`. Visit `http://localhost:3000/admin` for the placeholder. Only `admin.allowed_cidrs` can access it; an empty list denies everyone. The sample permits loopback.

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

## nginx and audit

See [docs/nginx.md](docs/nginx.md) for an example of nginx serving explicitly mapped machine-token requests independently, and proxying other requests to key-master. nginx token mappings are a separate authorization plane: SQLite revocation does not change nginx mappings. Device tokens use the app path unless explicitly mapped in nginx.

Forwarded IP headers are ignored unless the socket peer belongs to `trusted_proxies`. Trusted chains are walked right-to-left to the first untrusted hop. Configure only your actual proxy addresses, not arbitrary client networks.

Every application response, including health/admin/error responses, has a ULID request ID and an audit row. Paths omit query strings to avoid persisting `?k=`. The nginx tailer imports only `km_source: direct` records; app-proxied requests are already audited. It persists inode/offset cursors, waits for complete lines, handles rotation/truncation, and processes at most 1 MiB/2,000 lines per tick. Invalid records are skipped. SQLite triggers reject updates and deletes of `requests`.

## Design notes

- Phase one explicitly limits the admin UI to a placeholder. `/login` stores expiring codes but there is no login-redemption API, session cookie, or administrative CRUD API yet; codes cannot log in to this phase. Full session handling remains phase two.
- `/admin` is a static informational page behind a CIDR check. Unknown resource paths retain the same configured 404 body as disabled paths.
- Approval subjects are normalized `IP|client_family`; `/grant` creates a broader IP grant. This handles multiple clients at one IP without automatically authorizing all of them.
- `v2rayng` is matched before `v2rayn` to avoid its prefix being misclassified. Browser classification requires both Mozilla UA and HTML Accept. Language follows the first Accept-Language entry, with English fallback.
- `observe_mode` serves existing enabled resources even when the decision would deny, while retaining the original decision and actual HTTP status in audit. Missing/disabled resources still return 404; blocked and token-only subjects still suppress notifications. Do not enable observe mode for resources that must stay private.
- File paths are resolved through symlinks and checked against `file_root`. Protect that directory from untrusted writers. Files and inline bodies are buffered; upstream responses are buffered by audit counting, so this phase targets modest resource sizes rather than large media.
- Only GET and HEAD serve resources. Local single-byte ranges are supported; unsupported or unsatisfiable ranges return 416. HEAD ignores Range. ETags are calculated only after authorization. Upstream conditional/range headers are forwarded only after authorization; caller cookies, authorization headers and query tokens are never forwarded. Upstream redirects fail closed.
- Configured upstream URLs are administrator-controlled HTTP(S) endpoints. No user-controlled URL proxy is exposed. Requests have a 15-second upstream timeout.
- Device tokens do not expire by default and are scoped to requested resources; revoke them with `/revoke`. Machine-token creation is exposed as the server's `issueToken` helper for trusted local integration; no unauthenticated issuance endpoint exists.
- The database adds `pending`, `bot_events`, `state`, and `login_codes` support tables to persist deduplication, unauthorized bot actions, cursors and login-code hashes. Migrations run on startup through Drizzle.
- Core denial templates escape HTML, restrict contact URLs to HTTP(S), remove config-like markers from notice text, and set no-store. The default static 404 body is exactly `404 Not Found\n`.
- External package registries and the Telegram API are software dependencies, not example infrastructure. Deployment examples use reserved domains and documentation IP addresses only.
- The runtime image retains the workspace dependency store for reliable native-module and symlink resolution; build tools are not installed in its OS layer.

## Development and validation

```sh
pnpm test
pnpm build
pnpm lint
```

Core tests are table-driven across every client family and decision branch. Server tests use in-memory SQLite and mocked Telegram/fetch transports, covering denial-before-serving, token revocation, trusted proxies, file containment, append-only audit, nginx rotation, notification deduplication, callbacks, commands and polling bounds. No real Telegram calls are required. UI verification is recorded in [docs/ui-acceptance.md](docs/ui-acceptance.md).

MIT licensed; see [LICENSE](LICENSE).
