# Audit, second pass (23 Nov 2026, evening)

A second pass over the live site (https://nepse-analyzer-peach.vercel.app) after the first
audit of the same day ([audit-2026-11-23.md](audit-2026-11-23.md)), rebased on the follow-up
([audit-2026-11-24-followup.md](audit-2026-11-24-followup.md)) that was merged while it ran.
Findings the follow-up already fixed (malformed company addresses, the two not-found pages,
freshness warnings when the header fails, re-asking when an old copy arrives) are left to it and
listed at the end. Covered here: navigation and state in both
directions, erratic use (quick clicks, Back/Forward, refresh mid-flow, malformed input), data
accuracy against independent sources, and security. Each finding was reproduced on the live site
or on a production build against the mock database before it was fixed; each fix has a check in
`web/e2e/run.mjs` or a unit test.

## Findings and fixes

### High

| # | Finding | Evidence | Fix |
|---|---|---|---|
| H1 | **A filter chosen just before opening a company was lost on Back.** The address is written 250 ms after a change; a click on a company inside that window left `/signals` behind. | Live: Sell, then HRL at once, then Back: "All 269". | Any link click (capture phase, before the navigation starts) and leaving or refreshing the page write the pending filters first (`SignalsTable.tsx`). |
| H2 | **The Signals tab on a filtered Signals page showed a table that did not match the address.** The address became `/signals` but the table kept "Sell"; a refresh then showed every company. | Live: `/signals?call=sell`, press Signals: address plain, table "Sell 97". | The header tells the page when its own tab is pressed (`nepse:nav-reselect`); Signals resets to the plain table. Back still returns to the filtered one. |

### Medium

| # | Finding | Fix |
|---|---|---|
| M1 | **Search: Enter did nothing, or could open the wrong company, when typing fast on a slow phone.** The result list is rendered from a deferred copy of the box; Enter used that list. With CPU x8: "sbl" + Enter and "cfcl" + Enter stayed on the page. | Enter acts on what is typed now (`lib/search.ts` `pickOnEnter`); the highlighted row is used only when the list on screen is for the same text. |
| M2 | **Market breadth did not match NEPSE's figures.** "Advancing 132 / Declining 211" counted all 360 traded securities (debentures, mutual funds, promoter shares). The news reported 105 up, 165 down, 10 unchanged (280) for 23 Nov; among the 269 companies with calls the site's own Signals table shows 105 up, 155 down, 8 unchanged, so the published figures are ordinary shares. | "Shares rising / Shares falling" over every ordinary share traded (instrument type Equity), from the same price rows as the gainers (`breadth` in `lib/market.ts`), with the unchanged count; "Companies traded" renamed "Securities traded". The jobs' `market_daily` counts are unchanged. After deploying, compare the next day's figures with the news once. |
| M3 | **A price the site's own data check rejected headed "Top gainers" with no remark.** MCHL +10.58% (283.20 from 256.10) is beyond NEPSE's 10% limit; Data health lists it as an error and it gets no call, but the Market page showed it first among gainers. | The price stays (ShareHub shows the same 283.20 and 256.10) and is marked "data check failed" when that day's check failed. |
| M4 | **"Try again" on the error page did not re-read anything.** It called `reset()`, which in Next.js 16 only re-renders what is already in the browser. | `retry()` (re-reads from the server), and it retries by itself after 15, 30 and 60 seconds. |
| M5 | **An "unavailable" page stayed on screen up to 10 minutes after the database recovered.** That copy is new, so the follow-up's re-ask for old copies does not apply, and outside trading the page re-reads every 10 minutes. | "Data temporarily unavailable" asks again every 20 seconds for two minutes, then every minute (`RetrySoon`). Measured: back by itself about 15 s after the mock database recovered. |
| M6 | **One failed read blanked a whole page for everyone for a minute.** A page makes about ten reads; one gateway error (502/503/504) or dropped connection made it "unavailable", and that copy was cached. | Each read is retried once after 400 ms on a gateway error or a dropped connection (not on a timeout, not on 4xx) in `lib/db.ts`. Tested with a mock where the first attempt of every read fails. |
| M7 | **Old prices could stay on screen after the close.** Between 15:00 and 16:45 the final prices (about 15:20) and the day's calls (about 15:50) arrive, but open pages re-read only every 10 minutes then. | Every minute on weekdays 10:30 to 16:45 as well as during the session (`refreshEvery` in `lib/market.ts`), judged from the visitor's clock. |

### Low

| # | Finding | Fix |
|---|---|---|
| L1 | Every made-up but well-formed symbol (`/c/QQQQ1`) cost its own database read. | Company pages look the symbol up in the company list the header already reads (cached for an hour); debentures with a slash are in it too. |
| L2 | A feedback message being written was lost on a refresh or Back. | Kept in the browser's session storage (never sent, gone when the browser closes), per topic; cleared once sent. |
| L3 | Sectors card said "Today's change" on days without trading. | "Change of each NEPSE index on <day>", "so far" during the session. |

## Found here too, already fixed by the follow-up

* `/c/%E0%A4%A` and `/c/%ZZ` answered 500 (follow-up F3, `proxy.ts`).
* Every 404 said "No company with that symbol" (F8).
* With the header unreadable, the page stopped refreshing itself (F4: now refreshes every minute).
* A re-read could bring back the same cached copy and was not repeated (F6).

## Checked, not changed

* **NEPSE points change +2.27 vs +2.26 in the news.** Index values are stored with two decimals
  (`numeric(12,2)`); 2,623.56 − 2,621.29 = 2.27, while NEPSE computes from more decimals. The
  percentage (+0.09%) is the same. Fixing it needs wider columns and a migration; left as is.
  Sensitive Float shows +0.26% where the news gives +0.41 points (+0.25%): the same rounding.
* **News lists MCHL among the day's losers.** ShareHub's company page shows MCHL at 283.20, +10.58%
  from 256.10, as stored here, so the site's price is kept (marked, see M3).
* **Headers on the live site:** CSP (no `unsafe-eval` in production, `frame-ancestors 'none'`,
  `object-src 'none'`), HSTS, `X-Frame-Options: DENY`, COOP, `nosniff`, no `X-Powered-By`.
* **XSS and injection:** no `dangerouslySetInnerHTML`, `eval` or `innerHTML`; every dynamic value
  is React text; database filters are URL-encoded PostgREST parameters built from checked values.
* **Secrets:** only `SUPABASE_URL` and the publishable key, server-side; the site refuses a
  service key. GitHub Actions keep the service key in secrets and pass inputs through `env`.
  The weekly backup artifact holds market data only (no feedback).
* **Dependencies:** `npm audit` 0 vulnerabilities. GitHub Actions are GitHub's own, pinned to major
  versions (`@v4`, `@v5`); pinning to commit hashes would need Dependabot to keep them current.
* **Supabase row level security** was verified in the SQL editor in the first pass the same
  afternoon (`supabase/tests/security_checks.sql`, all passing); not re-run in this pass.

## How it was verified

* `npm test`: 54 logic tests (adds search on Enter, refresh rhythm, breadth).
* `npm run typecheck`, `npm run build`, `npm audit`.
* `pytest tests`: 80 passed, 11 database tests skipped without Postgres (no job code changed).
* `web/e2e/run.mjs` against a production build and the mock database: 80 checks, all passing
  (the 67 on `main` plus 13 new). The mock gains a price beyond the 10% limit (API), a flaky mode
  in which the first attempt of every read fails, and a log of the reads made.
