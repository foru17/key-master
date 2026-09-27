# Allowlist acceptance — 2026-09-28

VERDICT: PASS

Base URLs: `http://localhost:4174/admin` (Playwright) and `http://localhost:4173/admin`
(agent-browser). Local SQLite and example data only; Telegram delivery is mocked. DNS failure and
refresh behavior are exercised with injected resolvers in server tests, not a live DDNS provider.

## UI evidence

`pnpm test:ui`: 13 passed. Log: `.verification/allowlist-ui.log`.
`pnpm --filter @key-master/admin build`: exit 0.

Screenshots in `.ui-acceptance/2026-09-28/`:

- `{grants,overview,approvals,requests,requests-drawer}-{desktop,mobile,dark}.png`
- `{allowlist-dialog,allowlist-remove,matched-drawer}-{desktop,mobile,dark}.png`
- `agent-{grants,overview,approvals,requests,requests-drawer}-{desktop,mobile,dark}.png`
- agent-browser navigation/layout record: `agent-browser-evidence.json`.

Desktop: 1440 × 900; mobile: 390 × 844; dark: 1440 × 900. Full-page captures preserve content below
the fold; drawer captures include both matched-entry details and scrolled quick actions.

- PASS: light/dark rendered text contrast ≥ 4.5:1; neutral kind pills and green allow decisions.
- PASS: no horizontal document overflow; each pending/drawer action has its own viewport-bound assertion.
- PASS: original four approval actions remain visible; phone actions wrap, including Deny and Block IP.
- PASS: add dialog and confirmation popover fit the viewport; no native confirm dialog.
- PASS: long IPv6 values wrap within cards; labels, scope, source and last match remain readable.
- PASS: existing viewport permits zoom; button sizing follows the shared design system.
- PASS: zh/en labels, theme controls, popup login/search and existing management workflows remain functional.
- N/A: public entertainment compliance notice; this is an authenticated administration console.

## Baseline comparison

`CLAUDE.md` identifies the original baseline and existing screenshot candidate. The immediate pre-change
UI at `80f074d` was built and captured in all three modes before modifying the UI; four baseline screenshot
tests passed. Captures are retained under `.ui-acceptance/2026-09-28/baseline/`.
No production URL is configured, so no production comparison is claimed.

| Surface | Change | Retained behavior / visual check |
| --- | --- | --- |
| Grants | Allowlist section above temporary grants | Existing filters, create/edit/renew/revoke, grid columns and phone cards retained |
| Overview / Approvals | Fifth long-term action and permanent outcome | Original four actions, chart, ranks and decision history retained |
| Requests | Allowlist filter/pill | Existing filters, pagination, phone cards and virtualization retained |
| Request drawer | Matched entry and quick allow | Existing headers, client/origin details, grant/block actions retained |
| Dialogs | Network form and remove confirmation | Shared tokens, focus, error states and responsive positioning retained |

Visual review found two action-row clipping regressions on phones; both were fixed with wrapping and
verified by fresh screenshots plus explicit button-bound checks. No remaining missing controls identified.

## Behavior assertions

- Form rejects IPv4 /23, then creates a hostname with a custom label and resource scope in real SQLite.
- Cached A/AAAA display and last-match rendering checked with a seeded resolver snapshot.
- Remove → Cancel retains the entry; Remove → Confirm soft-deletes and removes it from the active list.
- Overview long-term action clears the pending card and creates an IPv6 /64 entry.
- Request drawer action creates a persistent entry and shows success feedback.
- Real gateway access through an allowlist entry records `allow_allowlist`; filtering finds it and the
  drawer displays the matched label, value and id, with a green semantic pill.
- agent-browser independently clicked add/save, remove/cancel/confirm, Overview and request quick actions.
- Existing login, bilingual themes, grant/token/resource CRUD, rollback, timezone and navigation tests pass.
