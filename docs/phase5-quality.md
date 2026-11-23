# Phase 5: Quality and launch

Status: built and tested on Monday 23 Nov 2026; merged into `main`. Live address: https://nepse-analyzer-peach.vercel.app

The goal of this phase: the dashboard keeps working without anyone watching it, never shows doubtful numbers as if they were sound, and says so when something goes wrong.

## What was added

| Area | What | Where |
|---|---|---|
| Tests on every change | 58 Python tests (3 of them on a real Postgres) and 16 website tests run on every pull request and every change to `main`, plus a type check and a full build. A red cross on the pull request means do not merge | `.github/workflows/ci.yml`, `tests/`, `web/lib/*.test.ts` |
| Site monitor | Opens the live site and compares what it shows with the database: latest final day, NEPSE index, number of companies, six sample prices, one company page. Also checks every page loads without an error notice, no secret key appears in any page, and the security headers are set. Runs after every change to the website (first waiting until Vercel serves that commit, so a failed deployment is caught too) and hourly on trading days; a failure emails the owner | `scripts/analytics/site_monitor.py`, `.github/workflows/site-monitor.yml` |
| Weekly backup | Saturdays: exports the data that cannot be fetched again (prices captured from NEPSE, floorsheet summaries, published calls and ranges, adjustment decisions, data checks, run log) and keeps it as a downloadable artifact for 90 days. Restore script included and tested | `scripts/analytics/backup.py`, `scripts/analytics/restore_backup.py`, `.github/workflows/backup-weekly.yml` |
| Free-plan budget | Pages read only the columns they show; data that changes once a day is reused for 10 minutes, price history for 15; company pages are cached like the others. See "Staying on the free plans" | `web/lib/data.ts`, `web/app/c/[symbol]/page.tsx` |
| Honest freshness | "Last update … ago" is now counted by the visitor's own clock, so a cached page can never claim to be newer than it is. A page older than 90 seconds when opened (first visit after a quiet spell, back to a phone after a while, moving between pages) fetches a fresh copy straight away | `web/components/client.tsx` |
| Wrong key refused | The website refuses to run with a secret or service_role key (it would bypass row level security) and says so on screen. Database reads time out after 10 seconds instead of hanging | `web/lib/db.ts` |
| Accessibility | Text colours adjusted to meet WCAG AA contrast on every background, in light and dark mode; inline links underlined; menu marks the current page. axe finds no WCAG A or AA problems on any page | `web/app/globals.css` |
| Guide | A plain-language page: a 5-step check before buying or selling, what each call, score, level and range means, how good the rules have been, when things update, costs | `web/app/guide/page.tsx` |
| Home screen | Icon and web app manifest, so the site can be added to a phone's home screen and opens like an app | `web/app/manifest.ts`, `web/app/icon.svg` |

### What the tests cover

- **Signal rules** (`tests/test_engine.py`): no indicator uses a later day's price (otherwise the backtest would be cheating); RSI stays within 0 to 100; a steady riser gets a buy, a steady faller a sell, an illiquid or thinly traded share no call; a buy with a falling short-term trend becomes a hold; trade levels are always in order (stop loss < buy zone ≤ close < target 1 < target 2, target 1 within 4 ATR); price ranges are ordered, inside NEPSE's daily limit and widen with the horizon.
- **Data checks** (`tests/test_checks.py`): a move beyond the 10% limit, open or close outside the day's range, missing rows, a failed end-of-day run, an unreviewed adjustment, and closes that differ from Sharesansar are all caught; many differences stop the day's calls; Sharesansar being down or dated differently does not; a missing end of day is noticed after 16:30 except on holidays and weekends.
- **Adjustments** (`tests/test_adjustments.py`): a 10% bonus is confirmed; a missed trading day, a factor above 1 or a jump that reverses the next day is never applied; a recorded holiday is not a missed day.
- **Database** (`tests/test_database.py`, on a throwaway Postgres in CI): all migrations apply; the 22 security checks pass (the public key can read but not write); every table has row level security; adjustments multiply through earlier prices correctly.
- **Site monitor and backup** (`tests/test_site_monitor.py`, `tests/test_backup.py`): a wrong price, an error page, a stale day, a leaked key, missing headers, a page that is down and a deployment that never arrives are each caught; a backup restores identically, twice is the same as once, and a damaged backup restores nothing.
- **Website** (`web/lib/*.test.ts`): when the market counts as open, pre-open or closed (weekends, holidays); when "delayed", "not started" and "not final" warnings appear; lakh and crore formatting; missing numbers show a dash, never 0; Nepal time; secret keys refused.

Each check was also confirmed to fail when the rule it guards is deliberately broken.

## Staying on the free plans

| Limit (free plan, as published) | Use |
|---|---|
| Supabase egress 5 GB a month | 0.02 GB so far this cycle. A page left open during trading now reads about 45 KB a minute for Market and Signals together (was about 400 KB) and under 1 KB a minute for a company page (was about 170 KB). Even with Market, Signals and five company pages open through every trading day, that is under 1 GB a month |
| Supabase database 500 MB | 144 MB. The end-of-day job warns at 400 MB |
| Supabase pauses after a week without activity | The jobs touch the database every weekday and the watchdog every day |
| Vercel 1,000,000 function calls, 4 CPU-hours, 10 GB origin transfer a month | Every page, including company pages, is now served from Vercel's cache and rebuilt at most once a minute, so open tabs cost cache reads rather than new renders |
| GitHub Actions | Public repository: no minute limit. The keepalive workflow re-enables schedules monthly, now including the site monitor and backup |

Sources: Supabase pricing (supabase.com/pricing), Vercel Hobby plan (vercel.com/docs/plans/hobby), both read on 23 Nov 2026.

## Who tells you what

| Problem | Noticed by | You hear about it |
|---|---|---|
| A job did not run, failed or is stuck; data is stale; a data check failed; the database is nearly full | Watchdog, hourly on trading afternoons and daily | Email from GitHub; banner on every page; Data health page |
| The website shows something different from the database, a page is down or shows an error, or a deployment failed | Site monitor, after each website change and hourly on trading days | Email from GitHub |
| A change breaks a rule, a check or the build | Tests | Red cross on the pull request before merging |
| A company's day looks wrong | Daily data checks | That company shows "No call" with the reason |

Emails go to the GitHub account that owns the repository (drabid09). Keep email on for failed Actions workflows in that account's GitHub notification settings.

## Disaster recovery

**Supabase project paused.** Open the Supabase dashboard and press Restore. Then run "End of day" and "Daily analytics" from the Actions tab.

**Project lost or corrupted.**

1. Create a new Supabase project. In its SQL editor, run each file in `supabase/migrations/` in name order.
2. Update the secrets: GitHub (Settings, Secrets and variables, Actions) `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`; Vercel (project, Settings, Environment Variables) `SUPABASE_URL` and `SUPABASE_ANON_KEY` (the publishable key), then redeploy.
3. Run "Sync companies from NEPSE", then "History backfill (one-time)" from the Actions tab. This re-imports the public price history.
4. Download the newest "nepse-backup" artifact from the latest "Weekly backup" run and unzip it. On a computer with Python and the two secrets set as environment variables:
   ```
   pip install -r scripts/analytics/requirements.txt
   python scripts/analytics/restore_backup.py path/to/backup-folder --yes
   ```
   It restores the captured prices, floorsheet summaries, published calls and ranges, adjustments and data checks, then re-applies every confirmed adjustment.
5. In the SQL editor, move the id counters past the restored rows:
   ```sql
   select setval(pg_get_serial_sequence('public.companies', 'id'), (select max(id) from public.companies));
   select setval(pg_get_serial_sequence('public.sectors', 'id'), (select max(id) from public.sectors));
   ```
6. Run "End of day", "Weekly backtest" and "Daily analytics", then "Site monitor". When the monitor passes, the site is back.

Data lost in the worst case: up to a week of captured data since the last backup (NEPSE's own history covers prices for about a year, so the gap fill in step 3 recovers most of it; floorsheet summaries for that week would be lost).

The backup artifacts are downloadable by anyone signed in to GitHub, as the repository is public. They hold market data and job logs, no keys or personal data.

## Verification

Done on Monday 23 Nov 2026, during trading.

| Check | Result |
|---|---|
| Tests on GitHub (pull request #5) | Both jobs passed: 55 Python tests including the 3 database tests (none skipped), 16 website tests, type check, build. Each check was also seen to fail when its rule was deliberately broken (locally) |
| Production deployment of the merge (`a4c635d`) | Ready; tests passed again on `main` |
| Site monitor against the live site, 14:08 | Passed on the second of three attempts. The first found the NEPSE index and one price one live snapshot behind the database: the page cache (up to a minute) had not caught up with a snapshot written seconds earlier, which is what the retries are for. Second attempt: latest final day 2026-11-20, NEPSE index 2,617.52, 269 companies, and ACLBSL 756.00, DOLTI 324.50, JFL 268.00, MSLB 1,162.00, PURE 718.30, SKHL 646.50 all identical to the database |
| Data read per minute by an open page (measured on a local copy of the database) | Market and Signals together: about 400 KB before, 45 KB after. Company page: about 170 KB before, under 1 KB after |
| Supabase usage | Egress 0.02 of 5 GB this cycle; database 144 of 500 MB |
| Backup round trip (local copy of the database) | Every table restored identical (checksums); a second restore changed nothing; a damaged file restored nothing |
| Stale-page refresh (local) | A fresh page does not refresh itself; an old cached copy refreshes once at the next check, then about once a minute in trading hours. No loop |
| Accessibility (axe, every page, light and dark) | No WCAG A or AA issues |
| Phone width (390 px) | All five menu items fit; no sideways scrolling |

How to check it yourself:

1. On GitHub, Actions: "Tests", "Site monitor" and "Watchdog" should show green ticks. A red cross on any of them has also been emailed to you.
2. Open the site and the Guide page; on a phone, add it to the home screen.
3. Once a month, open the latest "Weekly backup" run and check it has an artifact.

## Known limits

- Prices come from NEPSE's website through an unofficial route; NEPSE could change or block it. The end-of-day job falls back to Sharesansar, and the watchdog emails if both fail.
- GitHub can start scheduled jobs a few minutes late; the jobs have backup times.
- Only the repository owner receives alert emails. Other viewers see the banners.
- On the narrowest phones (320 px), the menu scrolls slightly sideways to show "Guide".
- GitHub warns that the standard actions (checkout, setup-python, setup-node, upload-artifact v4/v5) target Node 20; GitHub already runs them on Node 24 and they work. Moving to their next major versions is a small future tidy-up.
