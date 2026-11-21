# Phase 1: database

Supabase project `tpmlcthylkmrxsnazfef`. Everything lives in the `public` schema.

## Files

| File | What it does |
|---|---|
| `supabase/migrations/20261121000100_core_schema.sql` | 15 tables and their indexes |
| `supabase/migrations/20261121000200_row_level_security.sql` | Public read-only, writes only with the service key |
| `supabase/migrations/20261121000300_seed_sectors_indices.sql` | 13 sectors and 17 indices |
| `supabase/tests/security_checks.sql` | Self-check you can run in the SQL editor; changes nothing |
| `scripts/ingest/sync_companies.py` | Seeds companies from NEPSE through GitHub Actions |

## Tables

| Table | One row is | Key |
|---|---|---|
| `sectors` | A NEPSE sector | `id` |
| `indices` | NEPSE Index, the three other main indices, 13 sector sub-indices | NEPSE's index id |
| `companies` | A listed security | `id`, unique `symbol` |
| `daily_prices` | One company on one trading day (OHLC, volume, turnover) | `company_id, date` |
| `intraday_snapshots` | One company's price at one moment today | `company_id, ts` |
| `index_daily` | One index on one trading day | `index_id, date` |
| `index_intraday` | One index value at one moment | `index_id, ts` |
| `market_daily` | Whole-market totals for a day | `date` |
| `floorsheet_daily` | A company's floorsheet for a day, summarised | `company_id, date` |
| `corporate_actions` | A bonus, cash dividend, right share or similar event | `id` |
| `issues` | An IPO, FPO or right-share issue | `id` |
| `fundamentals` | A company's reported figures for one quarter | `company_id, fiscal_year, quarter` |
| `signals` | The day's recommendation card for a company | `company_id, date` |
| `forecasts` | One model's price range for one horizon | `company_id, made_on, horizon, model` |
| `backtest_results` | Measured performance of a strategy or model | `id` |

## Design choices worth knowing

- **Latest quote is today's row in `daily_prices`.** The live job keeps it current during the session with `is_final = false`; the end-of-day job marks it final. No separate "live quotes" table.
- **Prices are stored as traded.** `adj_factor` on each row converts to the price adjusted for later bonus, right and dividend events, so raw and adjusted charts come from one table.
- **`open` can be empty.** NEPSE's own history has no opening price (Phase 0 finding).
- **Raw floorsheets are not stored.** At about 40,000 trades a day they would fill the 500 MB free limit within months. Only the per-company daily summary is kept.
- **Each time-series table has two indexes**: by entity then time (charts) and by time alone (dashboard, screener, heat map).
- **Search needs no database index.** The company list is about 650 rows, so the website loads it once and filters in the browser.
- **Forecasts keep `actual_close`**, filled in when the target date passes. That is what lets the site show a measured track record instead of a claim.

## Security model

- Row level security is on for every table, with one policy: anyone may `SELECT`.
- There are no write policies, and write privileges are revoked from the public roles. TRUNCATE is not covered by row level security, so the revoke matters.
- The only writer is the `service_role` key, held in GitHub Actions secrets. It never reaches Vercel or the browser.

## Sized for the free tier

Rough estimates, to be measured in Phase 2 once real data is in:

| Table | Rows | Size |
|---|---|---|
| `daily_prices`, full history from 2011 | about 1 million | 150 to 200 MB with indexes |
| `intraday_snapshots`, three weeks | about 250,000 | about 30 MB |
| `floorsheet_daily` | about 87,000 a year | about 25 MB a year |
| everything else | small | under 30 MB |

`daily_prices` is the one to watch. If it runs larger than estimated, the options are a shorter backfill or dropping the date index on rows older than a few years.

## Still open

The columns in `corporate_actions`, `issues` and `fundamentals` are designed from what the website needs. No free source for them has been verified yet, so they may change in Phase 2.

## Applied and verified

Applied to the live project on 21 Nov 2026 through the Supabase SQL editor, from the files on this branch (checksums matched before running).

| Check | Result |
|---|---|
| Tables in `public` | 15 |
| Tables with row level security on | 15 |
| Read policies | 15, and no write policies |
| Sectors, indices | 13, 17 |
| `supabase/tests/security_checks.sql` | 10 of 10 passed on the live database |
| Database version | PostgreSQL 17.12 |

## How to verify it yourself

1. Supabase dashboard, **Table Editor**: the 15 tables are listed, each marked as RLS enabled.
2. **SQL Editor**: paste `supabase/tests/security_checks.sql` and run it. Supabase shows a "Potential issues detected" dialog because the script creates a temporary results table; choose **Run without RLS**. Every row should say `true`.
3. Company seed: repository **Actions**, **Sync companies from NEPSE**. The run summary shows how many companies NEPSE returned and how many are in the database.

## Company seed needs two repository secrets

The seed job reads `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` from **Settings > Secrets and variables > Actions**. Until both exist it stops with a clear message and writes nothing.
