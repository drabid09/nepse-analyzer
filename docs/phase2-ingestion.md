# Phase 2: ingestion

Status: built, deployed on branch `phase-2/ingestion`, and run against the live database on Monday 23 Nov 2026. Scheduled runs start once the branch is merged into `main` (GitHub only runs schedules from the default branch).

## What runs, and when

All jobs are Python, run on GitHub-hosted runners (free for a public repository), and write to Supabase with the service key held in repository secrets. Times are Nepal time; the workflows hold the UTC equivalents.

| Workflow | Script | When | NEPSE load | Writes |
|---|---|---|---|---|
| Live market | `scripts/ingest/live_market.py` | One run per session: starts 10:37, snapshot every 5 min from the 11:00 open to the 15:00 close. Backups 11:57 and 13:27 | About 5 requests per snapshot | Today's `daily_prices` row (`is_final = false`), `intraday_snapshots`, `index_daily`, `index_intraday`, `market_daily`, heartbeat in `job_runs` |
| End of day | `scripts/ingest/eod_market.py` | 15:20, backups 16:40 and 19:10 (they do nothing once the day is final) | About 105 requests, once | Final `daily_prices`, `floorsheet_daily`, `index_daily` with open/high/low, `index_intraday` graph, `market_daily`, `price_adjustments`; retention clean-up; storage check |
| Company details | `scripts/ingest/company_details.py` | 17:18, Sunday to Friday | 110 requests, 3 s apart | ISIN, listing date, face value, shares, paid-up capital, market cap, promoter/public split in `companies` |
| Sync companies | `scripts/ingest/sync_companies.py` (Phase 1) | Sundays 09:02 | 2 requests | New, renamed and delisted securities in `companies` |
| History backfill | `scripts/ingest/backfill_history.py` | Once, by hand (re-runnable) | One request per company without a CSV, 3 s apart | `daily_prices` history, `price_adjustments` |
| Keep schedules alive | `.github/workflows/keepalive.yml` | 1st of each month | none | Nothing; re-enables the scheduled workflows |

Every write is an upsert keyed on company or index and date, so any job can be re-run, and a fallback machine in Nepal could run the same scripts alongside GitHub without creating duplicates (Phase 0, "If cloud IPs get blocked later").

## Why the live job is one long run

GitHub starts scheduled runs late, sometimes skips them under load, and allows at most one every 5 minutes. A 5-minute cron would lose snapshots on exactly the busy days that matter. Instead one run follows the whole session and sleeps between snapshots (taken at :00:20, :05:20, ...). Two backup schedules cover a main run that never started; a backup that starts while the session's run is still going waits in the queue and exits when its turn comes. A run that fails 6 snapshots in a row (about 30 minutes) stops and is marked `failed`.

## Database changes (migration 4)

`supabase/migrations/20261123000100_ingestion_support.sql`, applied 23 Nov 2026 through the SQL editor (checksum matched before running).

| Object | Purpose |
|---|---|
| `job_runs` | One row per job run: status, heartbeat, requests, rows written, details. The website's "last updated" stamp and health badge read it. Runs with status `holiday` are the calendar's record of weekdays without trading |
| `price_adjustments` | Bonus and right-share events detected from the data, with the factor, both prices it came from, and `confirmed` / `unconfirmed` / `rejected` |
| `companies.details_checked_at` | Rotation order for the company details job |
| `storage_report()` | Size of each table and of the database |
| `latest_closes_before(date, date)`, `trading_days(date)` | Inputs to the end-of-day adjustment check |
| `apply_price_adjustments(company)` | Recomputes `daily_prices.adj_factor` from confirmed events |

Same security model as Phase 1: both tables are publicly readable and not writable; the four functions can be called only with the service key. `supabase/tests/security_checks.sql` now covers them: 17 of 17 checks passed on the live database.

## Price adjustments: detected from the data

Phase 0 found no free source for bonus and right-share announcements. They do not need one. On the first trading day after a book closure NEPSE adjusts the previous close; the data carries both numbers.

- **History.** From March 2018 the dataset's percent change is measured against NEPSE's adjusted previous close, so the implied previous close is `close / (1 + change / 100)`. Before March 2018 the dataset's "open" column *is* NEPSE's previous close (it equals the previous row 97 to 100% of the time, against 10 to 25% afterwards). Either way, `factor = NEPSE's previous close / last traded close`.
- **Daily.** The end-of-day job compares NEPSE's previous close with the last close stored for each company. It confirms an event only if every weekday in between is a known trading day or a recorded holiday, so a missed day cannot pass as a bonus.
- **Checked against a known event.** NABIL, 26 Feb 2019: 708.91 / 794.00 = 0.8928 = 1 / 1.12, its 12% bonus with book closure on Falgun 14, 2075 ([ShareSansar](https://www.sharesansar.com/newsdetail/last-day-to-grab-12-bonus-and-22-cash-dividend-of-nabil-bank-limited-book-closure-on-falgun-14)). NABIL's ten confirmed events since 2013 are all exact bonus ratios (25%, 20%, 30%, 30%, 30%, 12%, 33.5%, 33.6%, 18.5%, 5%).
- **What is not applied.** A factor above 1, a jump that reverses the next trading day, and dates where many companies show a "factor" at once, mostly near or above 1, are kept as `unconfirmed` and not applied. Those are skipped days or reference changes in the source, not company events. The largest was 6 Oct 2026, right after Dashain: 137 companies at once.
- **Threshold.** Differences of 1% or less are ignored, so very small cash-dividend adjustments are not captured.

`daily_prices` keeps the traded price. `close * adj_factor` is the adjusted price, so raw and adjusted charts come from one table.

## Results of the first runs (23 Nov 2026)

Read back from the database after the runs, not taken from the jobs' own reports.

| Run | Result |
|---|---|
| End of day, catch-up for Friday 20 Nov | Run on Monday morning, when NEPSE's live list had already been cleared, so it used the `today-price` list. **352 securities**, floorsheet **39,966 trades in 80 pages, exactly what NEPSE reported**, summarised for 352 companies, 17 indices with open/high/low from 3,316 graph points, market totals. 107 NEPSE requests |
| Spot check against Phase 0 | NABIL on 20 Nov: open 551, high 554, low 548.5, close 550, volume 40,217, 286 trades; market turnover Rs 3,887,563,470.82, 10,602,468 shares, 39,966 transactions. All identical to the Phase 0 probe |
| History backfill | 372 CSV files, 365 matched to our companies (7 are delisted or merged symbols with no company row: LBL, NIB, PLI, PLIC, RHPC, SLI, SLICL). **508,197 rows, 20 Jul 1995 to 20 Nov 2026**, written in 132 s; the 330 rows for 20 Nov already written by the end-of-day job were kept. Cleaned: 302 opening prices outside the day's range, 113 highs below lows, 650 repeated dates, 6 unusable rows |
| Adjustments | **1,217 confirmed** (329,879 rows given a factor, 234 companies), 924 kept for review |
| NEPSE gap fill | 199 tradable companies without a CSV: 35,673 rows; 29 returned no history (mostly recent listings), none failed. 224 requests, 3 s apart |
| Is NEPSE's history raw or adjusted? | Raw. On 8 companies with an adjustment in the last year, 8 to 12 days before each event matched our raw closes and 0 to 1 matched the adjusted ones. So NEPSE rows and CSV rows mean the same thing and take the same factors |
| Company details | 110 of 110 refreshed (ISIN, listing date, shares, market cap, promoter split); 120 requests |
| Weekly company sync | Ran from the branch without errors |
| Live market | Started 09:48, polling every 5 minutes until the open. See "Trading hours" below |
| `job_runs` | One row per run above, all `ok`. A first end-of-day attempt (before the fallback existed) stopped with "live market list empty"; it is recorded as `failed` with that reason |
| Security checks | 17 of 17 passed on the live database |

### Trading hours

First session, 23 Nov 2026. The run started at 09:48 and polled every 5 minutes. NEPSE first reported the market open at the 11:00:20 snapshot (nothing traded yet). At 11:05:20:

- 135 securities traded, 135 intraday points, 17 index values, and running market totals: Rs 52.1 million turnover, 474 transactions, 50 advancers, 61 decliners.
- **The newest trade in NEPSE's live list was 22 seconds older than our snapshot.** The list is close to real time during trading, which answers Phase 0's open question about freshness.
- The run's `job_runs` row (status `running`) is updated at every snapshot, so the website can show "last updated" and spot a stalled job.

The session's totals (snapshots, failures, lag range) and today's end-of-day run are added below once they are in.

## Data quality notes

- **Opening prices before March 2018 are left empty.** The dataset's "open" for that period is the previous close; it is stored as `prev_close` instead.
- **CSV rows cleaned** rather than dropped: an opening price outside the day's high-low range is emptied, a high below the low empties both, rows without a usable close are skipped, a repeated date keeps the last row. Counts are in the backfill run summary.
- **NEPSE's own history has no opening price** (Phase 0). Rows from it have `open` empty and `source = 'nepse'`.
- **"Today's price" list.** When the live list has already been cleared (a catch-up run the next morning), the end-of-day job reads NEPSE's `today-price` list for the business date instead. Its fields, as returned on 23 Nov 2026, are recorded in that run's `job_runs.details`.
- **Close.** The end-of-day close is NEPSE's `closePrice` where it gives one, otherwise the last traded price.
- **Price sources, in order.** NEPSE's live market list (verified in Phase 0), NEPSE's `today-price` list, then Sharesansar's `today-share-price` page (Phase 0 decision 3; one request, only if the page is dated the same business day; `source = 'sharesansar'`). If NEPSE does not answer at all, the job stores Sharesansar's prices and market totals and leaves the day non-final. A day only counts as final with NEPSE prices and a floorsheet; otherwise the 16:40 and 19:10 backups try again and NEPSE's figures replace the fallback's.
- **The Sharesansar parser** finds the price table by its column names (taken from the live page on 23 Nov 2026) and stops with a clear error if any is renamed. It has been tested against a copy of that structure, not yet in a real NEPSE outage.

## Storage

| | Size |
|---|---|
| Whole database after the backfill | **119 MB** of the free plan's 500 MB (125 MB reported by the job just after writing, before Postgres tidied up) |
| `daily_prices` (about 544,000 rows, 1995 to today) | 106 MB, about 230 bytes per row with its two indexes |
| Growth from daily capture | About 350 price rows and 350 floorsheet summaries a trading day: roughly 20 MB a year for prices and, by the Phase 1 estimate, 25 MB for floorsheet summaries. The intraday tables are rolling (21 and 30 days), about 30 MB at most |

At that rate the database stays under 300 MB for about four years. The Phase 1 estimate (150 to 200 MB for the history) was on the high side because many companies listed recently.

Retention: `intraday_snapshots` 21 days, `index_intraday` 30 days, both cleaned by the end-of-day job, which also writes the database size into `job_runs` and flags it above 400 MB.

## Not done in Phase 2, and why

| Item | Why | Next step |
|---|---|---|
| Fundamentals (EPS, P/E, book value), dividend announcements, IPO calendar | No free source verified (Phase 0). NEPSE's company details call has none of these fields | A small probe of candidate sources, then a decision; `fundamentals` and `issues` stay empty until then |
| Behaviour from other GitHub regions and IPs | Only observed from the runners GitHub assigned | Every run's `job_runs` row records its outcome; watch for failures |

## Things to know

- **Schedules need the merge.** Until `phase-2/ingestion` is merged into `main`, only pushes to the branch start these jobs.
- **60-day rule.** GitHub disables scheduled workflows in a public repository after 60 days without repository activity ([GitHub Docs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/disable-and-enable-workflows)). The keepalive workflow re-enables them monthly through the API; a commit also resets the clock. If the site ever stops updating, check the Actions tab for a disabled workflow first.
- **TLS.** Verification stays on. NEPSE's certificate expires 10 Dec 2026; if the chain breaks at renewal, add the intermediate certificate to the job instead of switching verification off (Phase 0 decision 6).
- **Timezone.** The workflows set `TZ=Asia/Kathmandu` because the NEPSE library builds request ids from today's date.

## How to verify it yourself

1. **Actions tab**: each workflow's run summary shows what it fetched and wrote.
2. **Supabase SQL editor** (read-only):

   ```sql
   select job, status, trade_date, started_at, requests, rows_written, message
   from job_runs order by id desc limit 20;

   select c.symbol, d.date, d.open, d.high, d.low, d.close, d.volume, d.trades
   from daily_prices d join companies c on c.id = d.company_id
   where c.symbol = 'NABIL' and d.date = '2026-11-20';
   -- expect 551, 554, 548.5, 550, volume 40,217, 286 trades (Phase 0 figures)

   select * from storage_report() limit 6;
   ```
3. **Security**: run `supabase/tests/security_checks.sql` and choose "Run without RLS". Every row should say `true`.
