# Phase-one acceptance

Verified on 2026-09-27. Implementation branch: `feat/phase-one`. No push was performed.

## Results

| Command / check | Observed result |
| --- | --- |
| `pnpm install && pnpm -r test && pnpm -r build` | Exit 0; core 168 tests, server 66 tests; admin typecheck; all three package builds passed |
| `pnpm lint` | Exit 0; no errors or warnings; one Biome configuration deprecation info message |
| Clean checkout ordering | Moved all generated dist directories aside; install → test → build passed without prebuilt core artifacts |
| `docker build -t key-master:local .` | Exit 0; image built with tests and lint inside Node 22 |
| `KM_DATA_DIR=./.verification/docker-data docker compose --env-file .env.example up -d --wait --wait-timeout 60` | Exit 0; healthy |
| `curl -fsS -i http://localhost:3000/healthz` | HTTP 200; `{"status":"ok"}`; ULID `X-Request-Id` |
| `docker compose exec -T key-master id` | `uid=1000(node) gid=1000(node)` |
| `/private`, `/welcome` | HTTP 403 and HTTP 200 respectively |
| Container-local `/admin` | HTTP 200, compiled `/admin/assets/` references present |
| nginx example `nginx -t` | Configuration syntax and test successful in an isolated container |
| Requested recursive identifier grep | No output; exit 1 means no matches |
| `gitleaks git --no-banner --redact .` | No leaks found |
| UI acceptance | PASS: desktop, mobile and dark screenshots for admin and denial page; see `docs/ui-acceptance.md` |

The Docker Desktop filesystem reported 59 GiB total and zero free bytes. Named-volume SQLite startup therefore failed with `SQLITE_FULL`. Validation used the supported repository-local bind mount instead; no unrelated images, volumes or infrastructure were removed. The Docker virtual disk still needs owner maintenance before using a named volume. The final application image itself builds and runs successfully.

Telegram behavior was tested with a mock transport; no live bot credentials were used. Admin login/session/CRUD are intentionally deferred: this phase provides the requested placeholder and the `/login` code-generation command only.

## Verification coverage

- Every decision branch is exercised for GET, HEAD, Range and conditional GET; expired, revoked, scope-mismatched and epoch-zero-revoked tokens cannot authorize.
- Each UA family is covered, including aliases, case handling, browser Accept detection and prefix ordering.
- Denials for every client are non-2xx, with no configuration markers; browser output escapes text, supports Chinese/English and light/dark, and rejects unsafe contact links.
- In-memory SQLite tests verify migrations, resource syncing, append-only audit, IP trust, file/symlink containment, conditional serving, upstream failure audit and log rotation/resume.
- Telegram tests verify owner-only actions, deduplication across restarts and concurrent requests, expiry, all four buttons, device scopes and complete long URL delivery, commands, login-code hashing, offsets, polling bounds and API failures.

## File list

`AGENTS.md` and `SPEC.md` were existing input files and were included in the initial commit without content changes. `docs/DESIGN.md` appeared separately during implementation and was left untouched and untracked.

- `.dockerignore`
- `.env.example`
- `.gitignore`
- `AGENTS.md`
- `Dockerfile`
- `LICENSE`
- `README.md`
- `SPEC.md`
- `apps/admin/index.html`
- `apps/admin/package.json`
- `apps/admin/src/main.tsx`
- `apps/admin/src/style.css`
- `apps/admin/tsconfig.json`
- `apps/admin/vite.config.ts`
- `apps/server/drizzle/0000_initial.sql`
- `apps/server/drizzle/meta/_journal.json`
- `apps/server/package.json`
- `apps/server/src/app.ts`
- `apps/server/src/bot/telegram.test.ts`
- `apps/server/src/bot/telegram.ts`
- `apps/server/src/config.ts`
- `apps/server/src/db.ts`
- `apps/server/src/index.ts`
- `apps/server/src/ingest.ts`
- `apps/server/src/ip.ts`
- `apps/server/src/resource.ts`
- `apps/server/src/schema.ts`
- `apps/server/src/server.test.ts`
- `apps/server/tsconfig.json`
- `apps/server/vitest.config.ts`
- `biome.json`
- `config.example.yaml`
- `docker-compose.yml`
- `docs/ACCEPTANCE.md`
- `docs/nginx.md`
- `docs/ui-acceptance.md`
- `package.json`
- `packages/core/package.json`
- `packages/core/src/index.test.ts`
- `packages/core/src/index.ts`
- `packages/core/tsconfig.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `tasks.json`
- `tsconfig.base.json`
