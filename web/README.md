# Dashboard

Next.js (App Router, TypeScript, Tailwind) site for the NEPSE analyzer. Deployed on Vercel with this folder (`web/`) as the project root.

Every query runs on the server with the Supabase project's publishable key, which row level security limits to reading, plus sending a feedback message (insert-only, see `docs/sanjeev-edition.md`). Pages are re-rendered at most once a minute and refresh themselves in the browser every minute during trading hours, and at once if the copy on screen is more than 90 seconds old.

## Environment variables (Vercel project settings)

| Name | Value |
|---|---|
| `SUPABASE_URL` | `https://tpmlcthylkmrxsnazfef.supabase.co` |
| `SUPABASE_ANON_KEY` | The project's publishable key (Supabase, Project Settings, API Keys). Never the secret key |

## Pages

| Path | What |
|---|---|
| `/` | NEPSE index today, market totals, sector indices, strongest buy calls with their track record, top movers |
| `/signals` | Every tradable company: call, score, confidence, trend, RSI, 1-month range; filter by call and sector |
| `/c/SYMBOL` | Chart (adjusted or raw) with trade levels, call and reasons, price ranges, company track record, indicators, company facts, floorsheet summary, adjustments and data checks |
| `/track-record` | Backtest of the calls and ranges, and the live record of published ranges |
| `/health` | Each job's last run, data checks, recent runs |
| `/guide` | Step-by-step guide to every page, a worked example, and a reference of every term |
| `/feedback` | "Tell Drabid": a private message box; the feedback workflow notifies Drabid through a GitHub issue that does not quote the message |

## Run locally

```
npm ci
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run dev
npm test            # freshness rules, formatting, key guard, Signals filters, symbols, index repair
npm run typecheck
```

### Click-through tests (no real database)

`e2e/mock-postgrest.mjs` stands in for Supabase with made-up data; `e2e/run.mjs` drives a
production build in Chromium (Playwright): every page without console errors, the Signals chips
left to right and back, rapid clicks, Back/refresh keeping filters, no background prefetch,
invalid symbols, call-consistent levels, NEPSE change, Your stocks, layout shift, late jobs,
the feedback form failing and double-clicked, the database down, search keys, phone width.

```
node e2e/mock-postgrest.mjs &
export SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_ANON_KEY=sb_publishable_test
npm run build && (npx next start -p 3100 &) && node e2e/run.mjs   # needs the playwright package
```

The website refuses to run with a secret or service_role key. Reads that change once a day are reused for 10 minutes and price history for 15, to stay well inside Supabase's free data transfer (see `docs/phase5-quality.md`).
