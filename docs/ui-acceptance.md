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
