# Supabase timer

## Why

GitHub's `schedule:` trigger is best-effort. On 23 Nov 2026, the first full
trading day after the workflows reached `main`, GitHub started **none** of the
scheduled workflows between 12:10 and 16:00 Nepal time, although runs started
by hand, by a push and by another workflow all worked and GitHub reported no
incident. The end-of-day update that day had to be started by hand.

So the jobs now have a second, more reliable clock: Supabase's `pg_cron`.
At each scheduled minute it asks GitHub to start the workflow through the
API, the same as pressing "Run workflow". GitHub's own schedule stays in the
workflow files as a backup clock.

## How it works

| Part | Where |
|---|---|
| Timetable: which workflow, when (UTC) | `timer.plan`, filled by `supabase/migrations/20261123000400_timer.sql`. A test checks it matches the `cron:` lines in `.github/workflows`. |
| One `pg_cron` job per timetable row (`timer:<workflow>:<n>`) | Calls `timer.start('<file>.yml')`, which sends `POST /repos/drabid09/nepse-analyzer/actions/workflows/<file>/dispatches` with `{"ref": "main", "inputs": {"timer": "true"}}` through `pg_net`. |
| The GitHub token | Supabase Vault, secret `github_actions_token`. Fine-grained token `nepse-supabase-timer`: this repository only, **Actions: read and write** only. Expires 22 Nov 2027. Never stored in the repository, logs or tables. |
| Hourly check (`timer:check`, minute 3) | `timer.check()` reads GitHub's answers (204 means started) and records the job `timer` in `job_runs`. A row is added only when the state changes, so the run list stays short. Data health shows it as "Timer". |
| Watchdog | Fails, and GitHub emails Drabid, if the timer's latest check failed or is more than 3 hours old. |

A run started by the timer behaves like a scheduled run: the end-of-day and
analytics jobs skip a day that is already done (`RUN_BY_TIMER=1`). A run started
by hand from the Actions tab still redoes it, as before. If GitHub's schedule
also fires, the second run waits in the same concurrency group and then finds
nothing to do.

The schema `timer` and Vault are closed to the website's key; the security
checks (`supabase/tests/security_checks.sql`) confirm it.

## When the token expires (or is replaced)

GitHub emails a reminder about a week before 22 Nov 2027. Data health will
show "Timer: failed, GitHub refused the token (HTTP 401)".

1. GitHub → Settings → Developer settings → Fine-grained tokens → **Regenerate**
   `nepse-supabase-timer` (or make a new one: this repository only, Actions read
   and write).
2. Supabase → Integrations → Vault → Secrets → `github_actions_token` → edit,
   paste the new value, save.

Nothing else changes; the next scheduled start uses the new token.

## Useful queries (Supabase SQL editor)

```sql
-- The schedule
select jobname, schedule, command, active from cron.job where jobname like 'timer:%' order by jobname;
-- The last starts and GitHub's answers
select * from timer.dispatches order by id desc limit 20;
-- Run a check now
select timer.check();
-- Pause or resume the timer
update cron.job set active = false where jobname like 'timer:%';
update cron.job set active = true  where jobname like 'timer:%';
```

## Verification

(Filled in after the timer was switched on.)
