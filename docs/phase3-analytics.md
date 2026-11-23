# Phase 3: analytics, checks and monitoring

Status: built on branch `phase-3/analytics`, run against the live database on 23 Nov 2026. Educational analysis, not financial advice.

## What it is for

The end goal is a dashboard that can be shared, keeps itself current, and never quietly shows a wrong number. Phase 3 supplies three things the dashboard needs:

1. **Checked data.** Every trading day is checked before anything is computed from it, and failures are written down where the website can show them.
2. **Signals and price ranges**, computed by fixed rules from adjusted prices, each with its own measured track record.
3. **Monitoring.** A watchdog checks every few hours that each job ran and the data is fresh, and fails loudly when not.

## Jobs

| Workflow | Script | When (Nepal time) | Writes |
|---|---|---|---|
| Daily analytics | `scripts/analytics/daily_analytics.py` | Right after the end-of-day workflow finishes; backups 15:50, 17:20, 19:40 | `quality_issues`, `signals`, `forecasts`; scores forecasts whose date has passed; prunes old daily rows |
| Weekly backtest | `scripts/analytics/backtest.py` | Saturdays 10:15 | `backtest_results` |
| Watchdog | `scripts/analytics/watchdog.py` | Hourly 11:05 to 18:05 on weekdays, and 08:25 every day | A `job_runs` row per check; the run fails, and GitHub emails you, if any check fails |

The rules live in one file, `scripts/analytics/engine.py`, used by both the daily job and the backtest, so what the website shows is exactly what was measured.

## Data checks (before any signal)

| Check | What it catches | Effect |
|---|---|---|
| Freshness | After 16:30 on a weekday, today should be final unless it is a recorded holiday | Market-wide error: no new signals, the dashboard shows "stale" |
| Row count | Prices stored for the day against NEPSE's number of traded securities | Warning |
| End-of-day status | The end-of-day run finished only partly (for example without a floorsheet) | Warning |
| 10% daily limit | A close more than 10.5% from NEPSE's previous close (NEPSE's circuit breaker is 10%) | That company: no call |
| Price order | Open or close outside the day's low-high range | That company: no call |
| Pending adjustment | A possible bonus or right adjustment not yet confirmed | That company: no call until reviewed |
| Independent source | Every close compared with Sharesansar's page for the same day (one request). Both start from NEPSE, so a difference means a fault in our pipeline | That company: no call; more than 10% different is a market-wide error |
| Fallback prices | The day's prices came from the Sharesansar fallback | Recorded for information |

A company with a failed check still gets a row in `signals`, with `data_ok = false`, the reason in `data_note`, and no buy or sell call. The website shows the reason instead of a call.

## How a signal is made

All on prices adjusted for bonus and right shares, only for tradable equities (debentures, mutual funds, preference and promoter shares are excluded).

- **Trends**: short (price against its 20-day average), medium (20-day against 50-day) and long (price against its 200-day average, from 120 days of history), each up, sideways or down.
- **Score, 0 to 100**: trend 30%, momentum 20% (20-day return relative to volatility, MACD), relative strength 20% (3-month return ranked against every NEPSE equity), RSI 15%, volume confirmation 15%; 10 points off when volatility is above 60% a year.
- **Call**: buy at 65 or more (unless the short-term trend is down), sell at 35 or less, hold in between. **Avoid** when the company has less than 120 days of history, has not traded for 10 days, trades less than Rs 5 lakh a day on average, or is extremely volatile; and whenever a data check failed.
- **Trade levels**: support is the 20-day low, resistance the 60-day high. Buy zone from the higher of support and close − 1 ATR, up to the close. Stop loss at the higher of support − 0.5 ATR and close − 3 ATR. First take-profit at resistance, but no closer than close + 1.5 ATR and no further than close + 4 ATR (so a stock far below an old high gets a target it can plausibly reach within weeks); second one ATR above. Rounded to NEPSE's Rs 0.10 tick.
- **Confidence**: from how far the score is from 50, whether the three trends agree, and how the same rule did on this company in the backtest.
- **Reasons** for and against, in plain words, generated from the same numbers.
- P/E, P/B, EPS and dividend yield stay empty: there is still no verified free source for fundamentals.

## Price ranges

For 1 week, 1 month and 3 months ahead: an 80% range (1 in 5 outcomes should fall outside) and a middle estimate. Never a single promised price.

- Three models: no change (random walk), damped recent trend, and drift back toward the 50-day average.
- The range width comes from the company's own history of moves over that horizon (last 2 years), scaled to current volatility, and capped by NEPSE's 10% daily limit.
- The middle estimate weights the three models by their backtest accuracy for that company, and the range is widened or narrowed by how often it held in the backtest.
- `reliable = true` only when the backtest has at least 20 past forecasts for that company and horizon, the range held 70 to 90% of the time, and the middle estimate was no worse than "no change".
- Every published range is scored once its date passes (`actual_close`, corrected for any bonus in between), so the website can show a live track record, not only a backtest.

## What the backtest found

Run on 23 Nov 2026 over 30 Jul 2023 to 20 Nov 2026 (about 3 years), 281 tradable equities, prices adjusted for bonus and right shares, using only data available on each day. The rules were written before this test and not changed after it.

**What followed each kind of call (next 21 trading days, before costs):**

| Call | Times it was given | Average change | Rose |
|---|---|---|---|
| Buy | 45,557 | **+1.94%** | 46% of the time |
| Hold | 84,603 | +0.87% | 45% |
| Sell | 36,894 | +1.03% | 50% |
| All calls | 167,054 | +1.20% | 47% |

**Following the buy calls as a strategy** (sell at the stop loss, the first take-profit, a sell call or after 63 days; 0.75% costs per round trip and 5% tax on gains): 4,806 trades, 49% profitable, average gain 8.6%, average loss 8.3%. Roughly break-even after costs.

**Price ranges** (target: 80% of outcomes inside the range):

| Horizon | Forecasts tested | Inside the range | Average miss of the middle estimate | "No change" model's miss |
|---|---|---|---|---|
| 1 week | 15,145 | 83% | 3.4% | 3.4% |
| 1 month | 14,857 | 83% | 7.2% | 7.1% |
| 3 months | 13,882 | 82% | 12.4% | 12.2% |

**What this means, plainly:**

- **The ranges are trustworthy as ranges.** About 4 in 5 outcomes landed inside, as designed, across 44,000 tests. This is the most reliable thing the site will show: how far a price can realistically move.
- **The middle estimates are not better than "no change".** Nobody's model should be read as "the price will be X".
- **Buy calls have a small edge, sell calls have none.** After a buy call, stocks rose 0.7 percentage points a month more than the average call. On a local copy of the same history, ranking all stocks by score into five groups, the top group beat the bottom group in both halves of the period: by 0.6 points a month in the rising half and 1.1 points in the falling half. That is consistent but small, and a month's market swing (+3% or −1% for everything) is far larger. Sell calls were followed by slightly *better* than average returns, so a sell call is not evidence that a price will fall.
- **So the dashboard should present calls as a ranking with a measured track record, never as instructions.** The backtest table, the live track record and the data checks will sit next to every call.

Costs and tax are from ShareHub Nepal's published rates (broker commission 0.33% each way for trades of Rs 50,000 to 5 lakh, SEBON fee 0.015%, DP charge Rs 25; capital gains tax 5% for individuals on shares held up to 365 days, from 22 Sep 2026). Confirm with a broker.

## Monitoring

First run, 23 Nov 2026 at 11:30, during the session. All checks passed: database answered; the live job had reported in at 11:30; no unresolved failures; no stuck runs; backtest 0 days old; no market-wide data errors for 20 Nov; database 127 MB of 500 MB.

The watchdog counts a failure until a later run of the same job succeeds, and ignores its own failures so one bad hour does not echo for a day.

## First live run (23 Nov 2026, for 20 Nov)

- **Data checks**: 352 prices stored, NEPSE reported 352. Independent check: all 279 closes Sharesansar also lists matched ours exactly. No issues.
- **269 signals**: 64 buy, 101 hold, 96 sell, 8 avoid; 12 companies have too little history for a call. 783 price ranges.
- **The checks caught a real fault on their first run.** The row-count check found 499 prices for 20 Nov against NEPSE's 352. The cause was the Phase 2 gap fill: NEPSE's history endpoint also lists days without trades, with the last price carried forward and zero quantity, and 31,395 such rows had been stored as if they were trades (mostly debentures and promoter shares). They were deleted, the gap fill now skips them, and the re-run shows 352 of 352.

## Storage

Signals are kept daily for 120 days, then one per week; ranges daily for 14 days, then one per week. About 300 signal rows and 900 range rows a trading day, so roughly 20 MB a year at the weekly archive rate. The database was 119 MB after the history import.

## Things to know

- **Not financial advice.** The rules are simple, fixed and public in `engine.py`. They were not tuned on the period they were tested on.
- **Schedules need the merge.** Like Phases 1 and 2, the schedules start once the branch is merged into `main`. `workflow_run` (analytics right after end of day) also only works from `main`.
- **Failure emails.** GitHub emails the account that last changed a scheduled workflow when its run fails. Check that Actions notifications are on: GitHub, Settings, Notifications, Actions.
- **Supabase's free plan pauses a project after a week of low activity.** The jobs touch the database every weekday and the watchdog every day, which the Supabase docs describe as enough ("a few requests a day"), though they say it is not a guarantee. A paused project can be restored for up to a year with its data.

## How to verify it yourself

1. **Actions tab**: "Weekly backtest" and "Daily analytics" run summaries show the figures in this document.
2. **Supabase SQL editor** (read-only):

   ```sql
   -- Today's calls and why
   select c.symbol, s.recommendation, s.score, s.confidence, s.close, s.stop_loss, s.take_profit_low,
          s.reasons_for, s.reasons_against, s.data_ok, s.data_note
   from signals s join companies c on c.id = s.company_id
   where s.date = (select max(date) from signals) order by s.score desc limit 20;

   -- What happened after each kind of call, in the backtest
   select variant, sample_size, avg_gain_pct as avg_next_21d_pct, hit_rate
   from backtest_results where kind = 'strategy' and name = 'call_next_21_days';

   -- Health
   select job, status, trade_date, started_at, message from latest_job_runs;
   select * from quality_issues order by trade_date desc, severity limit 20;
   ```
3. **Security**: `supabase/tests/security_checks.sql`, "Run without RLS": every row `true` (22 of 22 on 23 Nov 2026).
