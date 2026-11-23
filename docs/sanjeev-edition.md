# Personal edition: Sanjeev's dashboard

Added after launch, on Monday 23 Nov 2026: the dashboard is now made for one reader, Sanjeev, with a step-by-step guide, his own watchlist and a private feedback box that notifies Drabid. First names only appear in the code and on the site, because the repository is public.

## What changed

| Area | What | Where |
|---|---|---|
| Personal | Header reads "Sanjeev's NEPSE Dashboard" ("Sanjeev's NEPSE" on phones); the Market page opens with "Namaste, Sanjeev" and one line saying whether the market is open, closed, or waiting for live prices; footer "Made for Sanjeev by Drabid"; home-screen name | `web/lib/viewer.ts` (names in one place), `web/app/layout.tsx`, `web/app/page.tsx` |
| Your stocks | A star on every company page and next to each company in Signals. Starred companies appear at the top of the Market page with price, today's change, call, score and 1-month range, and Signals has a "Your stocks" filter. Saved in the browser (no account, nothing sent anywhere); each browser keeps its own | `web/components/watchlist.tsx`, `web/lib/watchlist.ts` |
| Guide | Rewritten as a walkthrough: the top of every page, Market, Signals, a company page from top to bottom, a worked example of reading one company, Track record, Data health, a daily routine, and asking for more; then a reference of every term. Uses the exact on-screen words and the real badges, bars and level lines | `web/app/guide/page.tsx` |
| Feedback | "Tell Drabid" page: choose a kind (show me something new, my view or an idea, something looks wrong, something else), write, optionally name a company or page. Linked at the bottom of every page and on each company page (prefilled with that company) | `web/app/feedback/` |
| Notification | Every 30 minutes a workflow opens a GitHub issue for each new message, tagging @drabid09, so GitHub emails Drabid. The issue gives only the number, kind and time: the text stays private in Supabase | `scripts/analytics/feedback_notify.py`, `.github/workflows/feedback-notify.yml` |

## How the feedback stays private and safe

- Messages are stored in a new `feedback` table (`supabase/migrations/20261123000300_feedback.sql`). It is the only table the website's public key may write to, and only the message columns (`kind`, `page`, `message`, `name`): it cannot read, change or delete anything, its own messages included, and cannot set a status.
- At most 20 messages an hour and 100 a day are accepted in total, so the shared link cannot be used to flood the database. Lengths are limited (3 to 4,000 characters).
- The form has a hidden field that automated form fillers complete; such submissions are accepted on screen and discarded.
- Nothing from a message is written to GitHub: not in the issue, not in the workflow log (both are public). Feedback is also left out of the weekly backup artifact for the same reason.
- `supabase/tests/security_checks.sql` now checks all of this; the database tests run it on every pull request.

## Reading and answering feedback (Drabid)

1. GitHub emails you: "Dashboard feedback #N: a request to see something new" (or an idea, a problem, a message).
2. Open Supabase, Table Editor, table `feedback`, row N, and read it.
3. Set `status` to `seen`, `planned`, `done` or `declined`, and close the GitHub issue. The issue list doubles as your to-build list.

If GitHub ever refuses to create the issue, the Feedback workflow fails, and GitHub emails you about the failed run instead; the next run tries again. A message is marked as notified only once its issue exists.

## Tests added

- Database: the public key can send a message but not read it, cannot set its own status, empty or unknown kinds are refused, and the 21st message in an hour is refused (`tests/test_database.py`).
- Notifier: one issue per new message, tagging the owner; the message text never reaches GitHub; already-notified messages are skipped; a refused issue leaves the message for the next run (`tests/test_feedback_notify.py`).
- Site monitor: also checks the Guide and Feedback pages load and the form is there (`tests/test_site_monitor.py`).
- Website: the form's checks, including the hidden field, and the watchlist's storage handling (`web/lib/feedback.test.ts`, `web/lib/watchlist.test.ts`).

## Verification

Done on Monday 23 Nov 2026.

| Check | Result |
|---|---|
| Migration on the live database | Applied in the Supabase SQL editor (text checked by checksum against the file) |
| Security checks on the live database | All 29 passed: 19 tables, row level security everywhere, the only write policy is sending feedback, the public key can send a message and is refused reading, changing, deleting, truncating, setting a status and calling the flood-limit function. The check rolls back its own test message |
| Feedback form, end to end (local copy) | On a phone-sized browser: "Want to see more about NABIL?" opened the form with NABIL filled in; the message was saved as an idea about NABIL from Sanjeev with status new; "Send another" gave a fresh form |
| Your stocks (local copy) | Starring NABIL on its page and NTC in Signals put both at the top of the Market page; the Signals "Your stocks" filter showed exactly those two |
| Tests | All 66 Python tests (6 of them on a real Postgres) and 24 website tests pass; type check and build pass on a clean copy |
| Accessibility (axe, every page including Guide and Feedback, light and dark) | No WCAG A or AA issues |
| Phone and tablet width | No sideways scrolling on any page |
