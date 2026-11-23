# Dashboard

Next.js (App Router, TypeScript, Tailwind) site for the NEPSE analyzer. Deployed on Vercel with this folder (`web/`) as the project root.

It only reads: every query runs on the server with the Supabase project's publishable key, which row level security limits to reading. Pages are re-rendered at most once a minute and refresh themselves in the browser every minute during trading hours.

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

## Run locally

```
npm ci
SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run dev
```
