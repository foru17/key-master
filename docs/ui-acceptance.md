# Admin fixes UI acceptance — 2026-09-27

VERDICT: PASS

Built preview: `http://localhost:4175`; automated suite: `http://localhost:4174`.
Baseline: commit `768eab2`, copied to ignored `.verification/baseline/` before editing.

| Check | Observed result |
| --- | --- |
| Sticky sidebar | Light/dark scroll tests pass; 900 px manual viewport, scrollY 402, sidebar top 0 and height 900. Full-page background reaches the document bottom. |
| Brand | Exact `key-master` text on desktop and mobile navigation; decorative slash removed. |
| Typography and controls | Eight requested screenshots individually opened: readable, no clipped controls or horizontal overflow. Mobile chart retains three time labels. |
| Dark contrast | Rendered foreground/background checks report zero failures below 4.5:1 in all four viewport/theme runs. |
| Dialogs and zoom | Login/search remain dialogs; workflow tests pass; viewport permits zoom. Request drawer timestamp fits on mobile. |
| Time | Singapore/New York browser contexts and en/zh UI changes pass; ISO title values remain intact. Denial displays configured zone; default UTC shown in screenshots. |
| Baseline diff | Same navigation, stats, chart, approval actions and rankings; sidebar canvas extends, slash disappears, denial time becomes localized with zone label. No missing features found. |
| Public entertainment notice | Not applicable to this private admin console. |

Committed screenshots: `docs/screenshots/{overview,denied}-{1440,390}-{light,dark}.png` (eight).
Independent headless agent-browser viewport screenshots: `.ui-acceptance/2026-09-27/fixes/` with the same eight names, plus `overview-scrolled-dark.png`.
Playwright also generated the complete 36-view gate under `.ui-acceptance/phase-two/`; only the eight requested repository screenshots are refreshed in this change.
Agent-browser login, theme menu, system color schemes and long-page scrolling were exercised against the real preview server.
The full automated workflow suite passed **10 tests (15.8s)**; health and browser-denial curl checks returned **200** and **403**.

---

# Phase-one UI acceptance

VERDICT: PASS

Tested on 2026-09-27 against the built server on local port 3099.

| Check | Result |
| --- | --- |
| Desktop, 1440 × 900 | Both pages readable, consistent spacing, no clipped text |
| Mobile, 390 × 844 | Both pages have `scrollWidth <= innerWidth`; viewport permits zoom |
| Dark color scheme | Both pages use readable foreground/background contrast |
| Dialogs and controls | Not applicable: static placeholder and informational denial page |
| Public entertainment disclaimer | Not applicable |
| Behavior | `/admin` returned 200; browser denial returned 403; `/healthz` returned 200 |
| Baseline diff | No previous UI exists; these screenshots establish the initial baseline |

Screenshots (local, intentionally ignored by Git):

- `.ui-acceptance/2026-09-27/admin-desktop.png`
- `.ui-acceptance/2026-09-27/admin-mobile.png`
- `.ui-acceptance/2026-09-27/admin-dark.png`
- `.ui-acceptance/2026-09-27/denied-desktop.png`
- `.ui-acceptance/2026-09-27/denied-mobile.png`
- `.ui-acceptance/2026-09-27/denied-dark.png`

The placeholder contains no login or search controls. Those flows are deferred to phase two.
