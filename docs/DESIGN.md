# key-master admin — design system

The admin UI is where the owner audits who fetched what, approves or revokes access, and manages tokens and
resources. It follows the Vercel / Cloudflare dashboard language: neutral surfaces, hairline borders, one quiet
accent, dense data set in a monospace face, and tables whose columns line up exactly.

## Tokens (`apps/admin/src/style.css`)

Light is the bare `:root` / `[data-theme="light"]`; dark is `[data-theme="dark"]` and
`@media (prefers-color-scheme: dark)` for `system`. Tokens are also scoped by `[data-theme]` so the settings page
can preview both themes side by side.

| token | light | dark | use |
|---|---|---|---|
| `--bg-page` | `#fafafa` | `#0a0a0a` | app background, sidebar |
| `--bg` | `#ffffff` | `#111111` | tables, cards, dialogs, inputs |
| `--bg-subtle` | `#f5f5f5` | `#171717` | table header, hover, code boxes |
| `--bg-muted` | `#ededed` | `#222222` | selected nav item, meters |
| `--border` | `#eaeaea` | `#262626` | every hairline |
| `--border-strong` | `#d4d4d4` | `#3a3a3a` | hover borders, switch track |
| `--fg` | `#171717` | `#ededed` | primary text |
| `--fg-muted` | `#616161` | `#a1a1a1` | secondary text; ≥ 4.5:1 on `--bg`, `--bg-page`, `--bg-subtle` |
| `--fg-faint` | `#8f8f8f` | `#707070` | placeholders and decoration only, never body text |
| `--primary-bg` / `--primary-fg` | `#171717` / `#fff` | `#ededed` / `#0a0a0a` | primary button, brand mark, avatar |
| `--accent` / `--accent-ring` | `#0a6cdf` | `#4b9dff` | focus ring |
| `--{green,amber,red,blue,gray}-{fg,bg}` | | | status badges (dot + tinted background) |
| `--chart-1` / `--chart-2` | `#0a6cdf` / `#e5484d` | `#3b8eff` / `#ff6369` | allowed / denied series, meters |

Status mapping: allow / active / enabled / public → green; deny / revoked → red; pending / approval required →
amber (a request waiting for the owner, not a failure); token only / device token → blue; expired / not found →
gray.

## Type

- UI: `Geist Variable` (`@fontsource-variable/geist`, bundled locally), fallback system + PingFang / YaHei.
- Data: `Geist Mono Variable` (`@fontsource-variable/geist-mono`) with `tabular-nums` for IPs, paths, request ids,
  tokens, ASNs, counts, durations and times (`.cell-mono`).
- Scale: 11 (meta) / 12 (table header, badges, labels) / 13 (table cells, buttons) / 14 (body) / 16 (dialog
  title) / 24 (page title, semibold, -0.02em) / 28 (stat numbers, mono).

## Spacing and shape

- 4px grid. Page gutter 24px (16px on phones); content max width 1200px (+ gutters), centred.
- Radius: 6px controls, 8px tables/cards/popovers, 12px dialogs. Shadows only on buttons (1px), popovers and
  dialogs.

## Layout

- Sidebar 240px on `--bg-page`, divider drawn on the main column so it spans the document. Nav items 34px, 14px,
  muted; hover `--bg-subtle`; selected `--bg-muted` + `--fg` + 500 weight. No outlines except the focus ring.
- Top bar 56px, translucent `--bg-page` with blur: breadcrumb, ⌘K search, observe chip, theme, language, avatar.
- Page heading: 24px title, one-line description, primary action on the right, 1px divider below, 24px gap.
- Sections: 14px semibold title + gray count badge, optional right-aligned meta / link; 32px between sections.

## Tables

- Every list is a grid table: `.data-table.is-grid` with `--cols` set per table (`t-pending`, `t-decisions`,
  `t-grants`, `t-tokens`, `t-resources`, `t-rank`). Rows (`.tr`) and the header (`.thead`) are CSS **subgrids** of
  the table, so a column is as wide as its widest cell in any row and every row lines up; zero-width edge tracks
  plus the 16px column gap provide the side padding.
- Header 40px on `--bg-subtle`, 12px muted. Rows ≥ 56px, cells vertically centred, 1px dividers, hover tint.
- The first cell (`.td.primary`) is the identity (IP + origin, resource path, token label). Numbers and times are
  mono. The action column is last, sized to its widest row, buttons left-aligned inside it so the first button of
  every row shares one edge. Actions that do not apply to a row are replaced by an invisible placeholder of the
  same width (e.g. an expired grant shows **Renew** where active grants show **Edit**, and no Revoke).
- Secondary and destructive actions live in the ⋯ menu or behind an in-page confirm popover.
- The virtualised request log keeps a fixed column template (`.audit-grid`) because its rows are absolutely
  positioned.
- Phones (< 768px): the header hides and each row becomes a card. The primary cell sits top-left with the row's
  actions top-right (pending approvals put their four buttons on the last line). Every other cell renders its
  `data-label` in a fixed 96px label column, so values line up across cards. No horizontal scrolling.

## Time

- Tables use relative time with the ISO timestamp in `title` ("3 minutes ago", "10 hr left"). Grants: active →
  "N left"; expired / revoked → gray badge + "N ago". The request log and the request drawer keep absolute times
  in the browser's zone because they are an audit trail.

## Controls

- Buttons 32px, 6px radius, 13px/500. Primary: `--primary-bg`. Secondary: `--bg` + 1px border + 1px shadow.
  Quiet: transparent. Danger text is red; confirmed danger buttons are solid red.
- Inputs 36px (32px in filter bars), 1px border, border darkens on hover, focus ring `0 0 0 2px var(--bg),
  0 0 0 4px var(--accent-ring)`. Switches: 32×18 track, green when on (also for `input[role="switch"]`).
- Segmented filters: 2px inset group on `--bg-subtle`, selected segment on `--bg` with a 1px shadow, counts in mono.
- Badges 22px pills with a 6px dot; scope chips (private / Tailscale / reserved) are 20px, 4px radius.

## Empty states

Each page states exactly what will appear and why, never a generic "adjust filters or create" line: approvals
"You're all caught up — new access requests show up here in real time"; recent decisions, grants, tokens and
rankings each have their own title and hint. A button is shown only when the page can actually create something.

## Quality bar (checked before release)

- Desktop 1440 and phone 390 screenshots, light and dark, for login, overview, requests (+ drawer), approvals,
  grants, tokens (issue dialog), resources and settings (`pnpm test:ui` writes them to `docs/screenshots/`).
- Column edges align across rows (check with long IPv6 / ASN / path data), action columns align, no clipped or
  wrapped control labels, no horizontal page scroll, text contrast ≥ 4.5:1 in both themes (rendered check in
  `tests/ui/admin.spec.ts`; muted rows use `--fg-muted`, never opacity).
- The denied notice page (server-rendered, `packages/core/src/theme.ts`) keeps its own tokens and passes the same
  checks.
