# key-master admin — design brief

The admin UI is where the owner audits who fetched what, approves or revokes access, and manages tokens and
resources. It should feel like a calm, precise security console: quiet neutrals, one warm accent for "needs your
attention", dense but readable data. Modern SaaS quality, not a legacy back office.

## Tokens (CSS variables, Tailwind 4 `@theme inline`)

Light (bare `:root`) / dark (`:root[data-theme="dark"]` and `@media (prefers-color-scheme: dark)` for `system`):

| token | light | dark | use |
|---|---|---|---|
| `--paper` | `#fafaf8` | `#111412` | app background |
| `--surface` | `#ffffff` | `#161a17` | cards, tables, dialogs |
| `--wash` | `#eff1ed` | `#1b221d` | hover rows, subtle fills, sidebar |
| `--ink` | `#191b1a` | `#f4f6f3` | primary text |
| `--muted` | `#5f6762` | `#a6b0a8` | secondary text (must stay ≥ 4.5:1 on surface) |
| `--faint` | `#9aa29c` | `#5f6962` | tertiary / placeholders only |
| `--line` | `#dde1dc` | `#2b322d` | borders |
| `--line-strong` | `#c9cfc9` | `#3c453e` | inputs, focus rings base |
| `--sage` / `--sage-text` | `#b8c8be` / `#53695a` | `#728c7b` / `#b8c8be` | brand, selected nav |
| `--brass` / `--brass-text` | `#e9d8b4` / `#8a5f16` | `#5a4520` / `#e0b872` | pending approvals, "needs you" |
| `--allow` | `#3f7d5a` | `#7fb894` | allow decisions |
| `--deny` | `#b3261e` | `#f2837a` | deny decisions |
| `--warn` | `#9a5b0b` | `#e0a54a` | warnings |

Semantic pills: allow (token / grant / internal / public), deny (pending / blocked / unknown), neutral (not_found).
Pending uses brass, not red: it is a request waiting for the owner, not a failure.

## Type

- UI: `Inter Variable` (@fontsource-variable/inter), fallback `-apple-system, BlinkMacSystemFont, "PingFang SC",
  "Hiragino Sans GB", "Microsoft YaHei", sans-serif`.
- Data: `JetBrains Mono` (@fontsource-variable/jetbrains-mono) for IPs, request ids, tokens, timestamps, paths.
  `font-variant-numeric: tabular-nums` on all numeric columns.
- Scale: 12 / 13 / 14 (body) / 16 / 20 / 28. Page titles 20 semibold; stat numbers 28 medium.

## Layout

- Desktop: left sidebar 232px (logo mark = small key glyph + "key-master"), nav: Overview, Requests (audit),
  Approvals (pending, with brass count badge), Grants, Tokens, Resources, Settings. Top bar: page title, ⌘K
  command palette (jump to IP / request id / resource), observe-mode chip when enabled, theme menu
  (light / dark / system), language (中文 / English), account menu (logout).
- Phone (< 768px): sidebar becomes a sheet from a menu button; tables become stacked cards; no horizontal page scroll.
- Content max width 1280px, 24px gutters (16px on phone).

## Pages

1. **Overview**: 4 stat cards (requests 24h, denied 24h, pending now, active grants), a requests-over-time chart
   (stacked allow / deny, 24h and 7d toggle, hand-drawn SVG or a small lib, theme-aware), "Needs you" list of pending
   approvals with Allow 10m / Allow 1h / Device token / Deny buttons (same actions as Telegram), top clients and
   top IPs today.
2. **Requests**: filter bar (time range, decision, client family, resource, IP/request id search), virtualized table
   (time, decision pill, resource, IP, client icon + family, status, latency, source app/nginx). Row → right drawer
   with full UA, headers subset, matched token/grant, and quick actions (grant this IP, block).
3. **Approvals**: pending + recent decisions with actor and duration.
4. **Grants**: active and expired; countdown for active; revoke; create grant (IP or IP+client, scope, duration).
5. **Tokens**: machine and device tokens; issue (plaintext shown once in a copy dialog with ready-made URLs),
   revoke, last used, usage sparkline.
6. **Resources**: list with policy pills; create / edit (kind file / inline / upstream, content type, policy),
   enable/disable; preview is never rendered inline for subscription-like content (show size + hash only).
7. **Settings**: observe mode, durations, notice texts (with live preview of the denied page in both themes),
   Telegram status (mode, bot username, owner chats), about/version.

## Interaction

- Login: popup dialog over a blurred empty shell (never a full-page redirect): step 1 "Send code to Telegram",
  step 2 six-digit input (auto-advance, paste support), errors inline. Session 12h.
- Every destructive action (revoke, block, delete) uses an in-page confirm popover, never `window.confirm`.
- Toasts for results ("Granted 203.0.113.7 for 10 minutes"). Optimistic updates with rollback on error.
- Live updates: poll `/api/admin/events` every 5 s (or SSE) for new pending approvals; brass badge + subtle pulse.
- Empty states with one clear next step. Loading skeletons, not spinners, for tables.
- Keyboard: ⌘K palette, `g o`/`g r` style nav shortcuts optional, visible focus rings (`--line-strong` + sage).
- Respect `prefers-reduced-motion`.

## Quality bar (checked before release)

- Desktop 1440 and phone 390 screenshots, light and dark, for Overview, Requests (with drawer), Tokens issue dialog,
  login dialog. No clipped text, no overflow, contrast ≥ 4.5:1 for text in both themes.
- Denied notice page (server-rendered, not the SPA) matches the same tokens and passes the same checks.
