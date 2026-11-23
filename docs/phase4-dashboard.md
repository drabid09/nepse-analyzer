# Phase 4: Dashboard

Status: built, merged into `main` (PR #3) and deployed on Vercel. Live address: https://nepse-analyzer-peach.vercel.app

The dashboard is the one place to look. It reads everything the jobs from Phases 2 and 3 write, and says plainly when something is late or failed a check instead of showing old or doubtful numbers as if they were current.

## Pages

| Page | What it answers |
|---|---|
| Market (`/`) | How is the market doing today? NEPSE index with today's intraday line, turnover, transactions, advancing and declining companies, every sector index, the strongest buy calls next to how much such calls have been worth, top gainers and losers (shares only) |
| Signals (`/signals`) | What does the model say about each company? Call, score, confidence, trend, RSI and the 1-month price range for every tradable company. Filter by call and sector, search by name, sort by column |
| Company (`/c/SYMBOL`) | Should I look closer at this one? Price chart (adjusted for bonus and right shares by default, raw on request) with buy zone, stop loss and targets drawn on it, today's intraday line, the call and the reasons behind it, 1-week to 3-month price ranges, this company's own backtest, indicators, company facts, floorsheet summary (top brokers), adjustments and data checks |
| Track record (`/track-record`) | How often has this been right? The three-year backtest of calls and ranges, and the live record of every published range once its date has passed |
| Data health (`/health`) | Is the data up to date? Last run of every job, open data-check issues, recent runs |

Search (top right) jumps to any company by symbol or name.

## How it stays correct

- **Read-only.** Every query runs on Vercel's server with the Supabase publishable key. Row level security lets that key read and nothing else. The secret key is never used by the website.
- **Fresh.** Pages are rebuilt at most once a minute. During trading hours an open page refreshes itself every minute, so a page left open on a phone keeps up.
- **Says when it is behind.** A banner appears on every page when:
  - live prices are more than 15 minutes old during trading (after 11:15);
  - today's close is not final by 16:30, so calls are still from the previous close;
  - a market-wide data check failed, in which case no new calls are shown.
  The pill at the top shows whether the market is open and when data last arrived; it turns amber when something is wrong and links to Data health.
- **No call on bad data.** A company whose data failed a check shows "No call" with the reason, not a buy or sell.
- **Honest about accuracy.** The buy-call list carries its measured edge from the backtest, sell calls are labelled as having had no edge, and the footer on every page says this is educational analysis, not financial advice.
- **Nepal time, Nepali number grouping.** Times are Nepal time; rupee amounts use lakh and crore.

## Setup (Vercel)

Project `nepse-analyzer` in team `drabid-s-personal-work`, root directory `web`, framework Next.js, production branch `main`. Every push to `main` deploys automatically.

| Environment variable | Value |
|---|---|
| `SUPABASE_URL` | `https://tpmlcthylkmrxsnazfef.supabase.co` |
| `SUPABASE_ANON_KEY` | The publishable key (Supabase, Project Settings, API Keys, starts with `sb_publishable_`). Never the secret key |

Changing a variable takes effect on the next deployment (Vercel, Deployments, Redeploy).

## Verification

Done on the live site on Monday 23 Nov 2026, during trading.

| Check | Result |
|---|---|
| First production deployment (commit `b533cf8`) | Ready in 29 s, no build errors |
| All pages load with real data | Market, Signals (269 companies), Company (NABIL), Track record, Data health. An unknown symbol shows "Not found" |
| Live prices against NEPSE's own live page | 10 of 10 companies identical (price and % change): the dashboard's 12:55 snapshot against nepalstock.com "as of 12:54:59". Sharesansar's live page (stamped 12:52) agreed on previous closes |
| Historical candles against Sharesansar | NABIL, 3 to 7 Aug 2026: open, high, low, close and volume identical. The tall candles on some days are real: NEPSE's first trade of the day is sometimes far from the close |
| Bonus adjustment | NABIL's 5% bonus shows as a factor of 0.9524 (1/1.05 = 0.9524) |
| Freshness | Market pill and Data health showed the live job's last update within 5 minutes throughout the checks (12:50 to 13:10); no banners, because nothing was late |
| Chart usability | Mouse wheel and vertical swipes scroll the page instead of zooming the chart (fixed after the first deployment); drag sideways or pinch to explore |
| Phone width | No sideways scrolling (390 px, tested on the same build) |

How to check it yourself at any time:

1. Open Data health. Every job should say ok or running, and "Latest final trading day" should be the last trading day.
2. During trading, compare two or three prices on Signals with nepalstock.com's Live Market page. They agree to the snapshot (every 5 minutes).
3. After 16:30 on a trading day, the Market page should no longer say "so far today".

## Known limits

- The dashboard can only be as fresh as the jobs: live prices arrive about every 5 minutes during trading, closing prices at about 15:20, calls and ranges at about 15:50.
- Vercel's free plan is for non-commercial use, which fits a site shared within the family.
- The address is unlisted (search engines are asked not to index it) but not private: anyone with the link can open it.
