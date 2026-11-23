# Audit follow-up, 24 Nov 2026

A second, independent QA and security pass, run in parallel with the one in
[audit-2026-11-23.md](audit-2026-11-23.md). Most findings overlapped and are fixed there
(filters in the address, stable charts, security headers, ordered paging, feedback limits,
error text, symbol checks, movers, sort). This change adds what that pass did not cover.
Each finding was reproduced on a production build of `main` after the first audit.

## Findings and fixes

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | High | **Track record downloads every checked range.** Ordered now, but still all of them: about 780 ranges are published each trading day, so within a year each read is tens of MB, refreshed hourly. That alone would use up Supabase's free 5 GB monthly transfer and get the database restricted, taking the whole site down. | View `forecast_live_record` (migration `20261124000100`, applied to production) counts per horizon in the database; the page reads 3 rows. Visitors read it through the table's own row level security. |
| F2 | Medium | **Debenture pages unreachable.** 11 NEPSE symbols contain a slash (`GBD80/81`, `NIFRAUR85/86`, …; 4 traded on 23 Nov). The symbol rule allowed letters and digits only, so `/c/GBD80%2F81` answered "not found", search led there, and they could not be starred. | The rule allows the slash (and `. _ & -`); the page's canonical redirect compares encoded addresses (it would otherwise loop for a slash); the watchlist uses the same rule. |
| F3 | Medium | **A badly encoded company address gave a server error.** `/c/%E0%A4` answered 500: Next.js fails on it before the page's own check runs. | `proxy.ts` checks company addresses first: malformed ones answer 404; other spellings, including an old two-segment link `/c/GBD80/81`, redirect to the canonical address. |
| F4 | Medium | **Freshness warnings vanished when they mattered most.** If the header's reads failed, the market status and every freshness warning were silently dropped. | The page says the freshness could not be checked, and retries every minute. |
| F5 | Medium | **A page left behind by a failed refresh looked current.** When the cache cannot make a new copy, the last good page keeps being served. | After 30 seconds on the page, if the copy is more than 15 minutes old a notice says so (never shown on a normal visit). |
| F6 | Low | **A returning visitor could see an old copy for up to 10 minutes.** The cache hands out the previous copy while it makes a new one, and the page then waited for its next regular refresh. | When a copy older than 90 seconds arrives, the page asks again shortly, up to 3 times in a row (no refresh storm during an outage). |
| F7 | Low | **Feedback with a NUL or other control character failed to send** ("could not be sent"; Postgres refuses NUL), and a two-emoji message passed the form's length check but failed the database's. | Control characters and unpaired surrogates are removed; lengths are counted in characters, as Postgres counts them. |
| F8 | Low | Every 404 said "No company with that symbol", including `/no-such-page`. | "Page not found" for pages, "Company not found" for symbols. |
| F9 | Low | The site monitor only checked three headers, so a weakened CSP or a missing HSTS would go unnoticed. | It now requires the CSP's key parts (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri`, `form-action`), refuses `'unsafe-eval'` and `*`, and requires a year of HSTS and a Permissions-Policy. |

## Checked and found sound

- NEPSE's trading days: the data shows the move from Sunday–Thursday to Monday–Friday in April 2026 (last Sunday session 5 Apr, first Friday 10 Apr), matching the jobs' schedule.
- The database key never reaches the browser; `npm audit` reports 0 vulnerabilities; workflows pass inputs through `env`; React escapes all text.
- Row level security on production, including the new view (security checks).

## How it was verified

- `web/e2e/run.mjs` against a production build and the mock database: **67 checks pass** (the 53 from the first audit, plus 14 new: the Track record's coverage from the view, 5 malformed addresses, both not-found pages, the debenture page, its redirects, star and search, and a feedback message with a NUL). The mock now includes a debenture, serves the view, and refuses NUL like Postgres.
- Outage simulation (database down, clock moved forward 20 minutes): the last good page stays up, the notice appears after it is old and not before, refreshes stay bounded, no errors.
- `npm test`: 48 logic tests. `pytest tests`: 91 tests, including the view as the public role and the monitor's header checks.
- A separate 77-check Playwright run (navigation both ways, rapid clicks, back/forward, refresh mid-flow, malformed input, double submits) on the same fixes, before the first audit was merged.
