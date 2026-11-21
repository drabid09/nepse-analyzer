# Phase 0 findings: which NEPSE data sources work

Status: first probe complete, one item still unverified (live behaviour during trading hours).
Evidence: `reports/phase0/latest.json`, `reports/phase0/latest.md`, `reports/phase0/history.csv`.

## What was tested

One run of `scripts/phase0/probe_sources.py` on a GitHub-hosted runner:

- When: Saturday 21 Nov 2026, 12:01 Nepal time. **The market was closed.**
- From: Microsoft Azure, Boydton, United States (IP 145.132.99.104).
- How: an honest user agent naming this project first, with a browser user agent only as a recorded fallback (it was never needed).

Everything below marked "measured" comes from that run. Everything marked "read" comes from the source's own published pages.

## Result in one table

| Source | Reachable from GitHub | Live prices | History depth | Auth | TLS | Allowed to automate? | Verdict |
|---|---|---|---|---|---|---|---|
| nepalstock.com website API | Yes, 15 of 15 calls | Yes: 352 securities with open, high, low, last price, volume, value, timestamp | About 1 year (229 trading days), no opening price | Short-lived token required (401 without it) | Verifies cleanly | No robots file. NEPSE sells data under a paid policy; this route is unofficial | **Primary** |
| Aabishkar2/nepse-data (GitHub CSVs) | Yes | No (end of day only) | NABIL from 15 May 2011, ACLBSL from listing; includes opening price | None | Fine | MIT licence on the repo; data originally scraped from Sharesansar | **History backfill** |
| sharesansar.com | Yes | Daily table with full OHLC on 1 page; freshness during trading not verified | Not verified | None | Fine | robots.txt allows all; terms do not mention automation | **Fallback and cross-check** |
| merolagani.com | Yes | Yes | Not tested | None | Fine | **No.** Terms ban scripts, scraping and data mining | Rejected |
| nepsealpha.com | Homepage only | Not tested | Not tested | n/a | Fine | **No.** robots.txt disallows `/api/*`, `/rest/v1/*`, `/trading/*` | Rejected |
| yonepse (GitHub Pages JSON) | Partly: 2 of 3 files returned 404 | Stale: last updated 6 Nov 2026 | n/a | None | Fine | No licence stated | Rejected |
| ShareHub Nepal data API | Not tested | Documented | Documented | Paid licence, login and IP allow-list | n/a | Yes, under licence | Not free; the paid option |

## Source by source

### 1. nepalstock.com (primary)

Reached through the open-source [`nepse` library](https://github.com/basic-bgnr/NepseUnofficialApi), pinned to commit `180a550` (7 Jun 2026). Endpoint paths come from that library's `API_ENDPOINTS.json`; none were guessed.

Measured:

- Not blocked from a US cloud IP. Homepage 200 in 1.5 s, no challenge page.
- The data API refuses requests without a token: status 401, body `WARNING: UNAUTHORIZED ACCESS`. The library computes the token the same way the site's own JavaScript does and renews it every 45 seconds.
- TLS certificate verified with a standard client. The incomplete-chain problem described in the library's README did not occur. The certificate expires 10 Dec 2026, so the problem could return at renewal.
- 28 requests, all 200. Ten quick calls in a row all succeeded, slowest 0.25 s. No rate-limit headers seen. The real limit is unknown.
- `robots.txt` is not a rules file; the site returns its app shell for that path.

What it returned:

| Data | Rows | Useful fields |
|---|---|---|
| Market status | 1 | `isOpen`, `asOf` |
| NEPSE and other main indices | 4 | value, change, high, low, 52-week range |
| Sector sub-indices | 13 | value, change |
| Market summary | 6 | turnover, traded shares, transactions |
| Company list | 652 | name, symbol, sector, instrument type, status |
| Security list (active) | 571 | id, symbol, name |
| Live market | 352 | open, high, low, last price, volume, value, previous close, `lastUpdatedDateTime` |
| Index intraday graph | 610 points | timestamp, value |
| Intraday ticks, one stock | 116 | time, rate |
| Daily history, one stock | 229 | date, high, low, close, volume, value, trades. **No open.** |
| Company details | 1 | listing date, ISIN, face value, market cap, paid-up capital, promoter and public shares, 52-week range |
| Floorsheet | 39,966 trades that day | buyer and seller broker, quantity, rate, time |

Limits found:

- **History is capped at about one year** even when asked for everything since 2000, and it has no opening price. It cannot fill a 5-year candlestick chart by itself.
- No EPS, PE, book value or dividend fields appeared in the calls tested.
- No corporate-action or IPO calendar endpoints are in the library's list.

Reliability, plainly: one clean run is not a track record. This is an undocumented API behind a deliberately obscured token. It will break whenever NEPSE changes its site, and has before (the library's changelog records an adjustment for a NEPSE change in February 2023). The library is maintained and runs its own check on GitHub Actions four times a day, which is a good sign, not a guarantee.

### 2. Aabishkar2/nepse-data (history backfill)

One CSV per company at `data/company-wise/<SYMBOL>.csv`, updated by that repo's own scheduled job. Its scraper reads Sharesansar.

Measured:

- Last commit 20 Nov 2026, 20:48 UTC. Last row in both sample files is 20 Nov 2026, the last trading day.
- NABIL: 3,544 daily rows from 15 May 2011. ACLBSL: 1,398 rows from 29 Jul 2020.
- Columns: date, open, high, low, close, percent change, traded quantity, traded amount.
- Not stated, so assume **unadjusted** for bonus and right shares. Phase 2's adjuster handles that.

Cross-check: for 20 Nov 2026 the open, high, low, close, volume and turnover for NABIL and ACLBSL are identical across NEPSE, this dataset and Sharesansar.

Caveat: NABIL listed in 1985 but the file starts in 2011, so "full history" means roughly 15 years at most. A hobby repo can stop updating at any time, which is why it is used once for backfill and not as a daily dependency.

### 3. sharesansar.com (fallback and cross-check)

Measured: `robots.txt` is `User-agent: *` with an empty `Disallow:`. The `today-share-price` page answered 200 in 0.7 s to the honest user agent, dated 20 Nov 2026, with open, high, low, close, VWAP, volume, turnover and transactions for every traded symbol.

Read: the terms say market data comes from a third party and is not guaranteed real-time or accurate. They say nothing about automated access or reuse.

Not verified: fetching a past date, and the per-company history, dividend and IPO pages. The static HTML exposed no form target or ajax URL to test, and guessing one would break the no-fabrication rule.

### 4. Rejected

- **Merolagani**: reachable and current, but its terms prohibit scripts, screen scraping and data mining for any purpose, and license market data for display on its own site only.
- **NepseAlpha**: its `robots.txt` disallows the paths where the data lives.
- **yonepse**: stale by two weeks and missing files on the day tested.
- **ShareHub Nepal**: a real documented API, but it needs a paid licence, a login and an IP allow-list. GitHub runners have no fixed IP, so it does not fit the free architecture.

## Decisions for the next phases

1. **Live, end-of-day, companies, sectors, indices, floorsheet summaries**: nepalstock.com through the pinned library.
2. **History older than one year**: one-time import from the GitHub CSV dataset, then our own daily capture. Because NEPSE history has no opening price, the end-of-day job must store each day's open, high, low and close from the live-market snapshot.
3. **Fallback when NEPSE fails**: Sharesansar `today-share-price`, one request per day, for end-of-day prices. There is no verified free fallback for intraday prices; the site would show the last good snapshot with a "delayed" badge.
4. **Fetch jobs are written in Python**, because the only working token implementation tested is Python. The website stays Next.js and TypeScript. The architecture in the brief is otherwise unchanged.
5. **Use NEPSE's own `isOpen` flag** to decide whether the market is open, with the clock only as a guard. No machine-readable holiday calendar was verified.
6. **TLS**: keep verification on. If the chain breaks again at renewal, add the missing intermediate certificate to the job; do not switch verification off.

## Corrections to the project brief

- **Trading days are Monday to Friday**, 11:00 to 15:00 Nepal time, since April 2026. The brief says Sunday to Thursday. Friday 13 Nov 2026 was reported as a normal trading day and the last of that week.
- GitHub is documented as disabling scheduled workflows in a public repository after 60 days with no repository activity. This was not re-checked in Phase 0; confirm it in Phase 2 and make the fetch jobs account for it.

## Not verified yet

| Gap | Why | How it gets closed |
|---|---|---|
| Behaviour during trading hours: how fresh `live_market` is, whether calls slow down or fail under load | The probe ran on a Saturday | The workflow is scheduled for 11:20 and 13:50 Nepal time, Monday to Friday. Schedules only run from the default branch, so this starts once the branch is merged |
| Reliability over time | One run only | Each run appends a line to `reports/phase0/history.csv` |
| Real rate limits | Only a 10-call burst was tried, on purpose | Planned load is about 5 calls every 5 minutes; stay there |
| Fundamentals (EPS, PE, book value), dividends, bonus and right shares, IPO calendar | No verified free source yet | Needs its own small probe before those tables are filled in Phase 2 |
| Other GitHub runner regions and IPs | One runner | More runs |

## Licensing risk

NEPSE has an official, paid data-usage policy approved by SEBON in 2022. The route used here is the website's internal API, reached by reproducing its access token. That is what every open-source NEPSE project does, and it is not a licence. Reading the data for personal study is one thing; republishing it on a public website is redistribution, which is the use NEPSE charges most for. This is a judgement for the project owner, ideally with advice from someone who knows Nepali securities rules. The low-risk options are to keep the site private, or to ask NEPSE or a licensed vendor about terms.

## If cloud IPs get blocked later

Not needed today, but the design is ready:

- The Phase 2 fetch script takes its settings from environment variables only, so the same file runs anywhere.
- On a PC or Raspberry Pi in Nepal: Python 3.11, the same `requirements.txt`, a local `.env` holding `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` (never committed), and a cron entry or Windows Task Scheduler job on the same 5-minute market-hours schedule.
- Writes are upserts keyed on symbol and timestamp, so the GitHub job and the Nepal machine can both run without creating duplicates.
- Every run records a row in a health table: who ran, when, which source, how many rows, any error. The website reads that table for its "last updated" stamp and health badge, and it shows which runner last succeeded.

## How to verify this yourself

1. Open the repository's **Actions** tab, choose **Phase 0 - data source probe**, and open the latest run. The run summary shows the same tables as `reports/phase0/latest.md`.
2. Compare a figure by hand: NABIL on 20 Nov 2026 should read open 551, high 554, low 548.5, close 550, volume 40,217 on nepalstock.com and on sharesansar.com.
3. After merging, press **Run workflow** on that page during trading hours to produce a fresh report.
