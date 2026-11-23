-- Supabase timer: starts the GitHub Actions jobs on time.
--
-- GitHub's own schedule is best-effort: on 23 Nov 2026 it started none of the
-- scheduled workflows for an afternoon. This timer runs inside Supabase
-- (pg_cron), and at each scheduled minute asks GitHub to start the workflow
-- (pg_net, POST .../actions/workflows/<file>/dispatches with timer=true).
-- GitHub's schedule stays in the workflow files as a second timer; the jobs
-- skip work that is already done, so a double start is harmless.
--
-- The GitHub token lives only in Supabase Vault, under the name
-- github_actions_token. It is a fine-grained token for this one repository with
-- "Actions: read and write" and nothing else. Nothing here prints or returns it.
--
-- Everything lives in the schema "timer", which the website's key cannot see.
-- Every hour timer.check() reads GitHub's answers and records the result as
-- the job "timer" in job_runs, which the Data health page shows. A refused
-- start (for example an expired token) shows there as failed.
--
-- On a plain Postgres without pg_cron/pg_net (the test database in CI) the
-- tables and functions are created but nothing is scheduled.

-- ---------------------------------------------------------------- job_runs

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check
  check (job in ('live', 'eod', 'backfill', 'details', 'companies', 'analytics', 'backtest', 'watchdog', 'timer'));

-- ---------------------------------------------------------------- schema

create schema if not exists timer;
revoke all on schema timer from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on schema timer from anon, authenticated';
  end if;
end $$;

-- Which workflow starts when (UTC; Nepal is UTC+05:45). Mirrors the
-- schedule: lines in .github/workflows, and tests/test_timer.py checks that
-- the two lists agree.
create table if not exists timer.plan (
  workflow  text not null,     -- file name in .github/workflows
  cron      text not null,     -- pg_cron schedule, UTC
  note      text,
  primary key (workflow, cron)
);

-- One row per start request sent to GitHub.
create table if not exists timer.dispatches (
  id          bigint generated always as identity primary key,
  workflow    text not null,
  sent_at     timestamptz not null default now(),
  request_id  bigint,          -- pg_net request id; null when nothing was sent
  status_code integer,         -- GitHub's answer: 204 means started
  problem     text,            -- why it was not started, in words
  checked_at  timestamptz      -- when timer.check() read the answer
);
create index if not exists dispatches_unchecked_idx on timer.dispatches (sent_at) where checked_at is null;

truncate timer.plan;
insert into timer.plan (workflow, cron, note) values
  ('market-live.yml',      '52 4 * * 1-5',   '10:37 main run, waits for the open'),
  ('market-live.yml',      '12 6 * * 1-5',   '11:57 backup'),
  ('market-live.yml',      '42 7 * * 1-5',   '13:27 backup'),
  ('market-eod.yml',       '35 9 * * 1-5',   '15:20'),
  ('market-eod.yml',       '55 10 * * 1-5',  '16:40 backup'),
  ('market-eod.yml',       '25 13 * * 1-5',  '19:10 backup'),
  ('analytics-daily.yml',  '5 10 * * 1-5',   '15:50'),
  ('analytics-daily.yml',  '35 11 * * 1-5',  '17:20 backup'),
  ('analytics-daily.yml',  '55 13 * * 1-5',  '19:40 backup'),
  ('company-details.yml',  '33 11 * * 0-5',  '17:18 Sunday to Friday'),
  ('sync-companies.yml',   '17 3 * * 0',     'Sundays 09:02'),
  ('backtest-weekly.yml',  '30 4 * * 6',     'Saturdays 10:15'),
  ('backup-weekly.yml',    '25 14 * * 6',    'Saturdays 20:10'),
  ('feedback-notify.yml',  '7,37 * * * *',   'every 30 minutes'),
  ('site-monitor.yml',     '50 5-13 * * 1-5','hourly 11:35 to 19:35 on weekdays'),
  ('site-monitor.yml',     '20 3 * * *',     '09:05 every day'),
  ('watchdog.yml',         '20 5-12 * * 1-5','hourly 11:05 to 18:05 on weekdays'),
  ('watchdog.yml',         '40 2 * * *',     '08:25 every day'),
  ('keepalive.yml',        '11 2 1 * *',     '07:56 on the 1st of each month');

-- ---------------------------------------------------------------- functions
-- plpgsql, so they can be created before pg_net and Vault exist (CI).

-- Ask GitHub to start one workflow on main, as a timer run.
create or replace function timer.start(p_workflow text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_token text;
  v_request bigint;
begin
  if not exists (select 1 from timer.plan where workflow = p_workflow) then
    raise exception 'timer.start: % is not in timer.plan', p_workflow;
  end if;
  select decrypted_secret into v_token
  from vault.decrypted_secrets where name = 'github_actions_token'
  order by created_at desc limit 1;
  if v_token is null or btrim(v_token) = '' then
    insert into timer.dispatches (workflow, problem)
    values (p_workflow, 'no GitHub token in Supabase Vault (secret github_actions_token)');
    return null;
  end if;
  v_request := net.http_post(
    url := 'https://api.github.com/repos/drabid09/nepse-analyzer/actions/workflows/' || p_workflow || '/dispatches',
    body := jsonb_build_object('ref', 'main', 'inputs', jsonb_build_object('timer', 'true')),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || btrim(v_token),
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'nepse-analyzer-supabase-timer',
      'Content-Type', 'application/json'),
    timeout_milliseconds := 15000);
  insert into timer.dispatches (workflow, request_id) values (p_workflow, v_request);
  return v_request;
end;
$$;

-- Plain words for GitHub's answer.
create or replace function timer.explain(p_status integer, p_error text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status between 200 and 299 then null
    when p_status = 401 then 'GitHub refused the token (HTTP 401): it has probably expired. Make a new one and replace github_actions_token in Supabase Vault.'
    when p_status in (403, 404) then 'GitHub refused the start (HTTP ' || p_status || '): the token needs "Actions: read and write" on drabid09/nepse-analyzer.'
    when p_status = 422 then 'GitHub refused the start (HTTP 422): the workflow on main is missing the timer input.'
    when p_status is not null then 'GitHub answered HTTP ' || p_status || '.'
    when p_error is not null then 'No answer from GitHub: ' || left(p_error, 120)
    else 'No answer from GitHub.'
  end
$$;

-- Read GitHub's answers and record the result as the job "timer".
-- A row is added only when the state changes (working <-> failing); while it
-- stays the same, the latest row's heartbeat and counts are updated, so the
-- run list is not flooded with an hourly "ok".
create or replace function timer.check()
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_total integer;
  v_failed integer;
  v_problem text;
  v_status text;
  v_message text;
  v_latest record;
  v_details jsonb;
begin
  -- Copy answers that have arrived.
  update timer.dispatches d
     set status_code = r.status_code,
         problem = timer.explain(r.status_code, r.error_msg)
    from net._http_response r
   where r.id = d.request_id and d.checked_at is null;
  -- Anything still without an answer after two minutes counts as unanswered.
  update timer.dispatches d
     set problem = coalesce(d.problem, timer.explain(null, null))
   where d.checked_at is null and d.status_code is null and d.sent_at < now() - interval '2 minutes';

  with done as (
    update timer.dispatches d set checked_at = now()
     where d.checked_at is null and (d.status_code is not null or d.problem is not null)
    returning d.workflow, d.status_code, d.problem
  )
  select count(*), count(*) filter (where problem is not null),
         (array_agg(problem order by problem) filter (where problem is not null))[1],
         coalesce(jsonb_object_agg(workflow, coalesce(status_code::text, 'none')), '{}'::jsonb)
    into v_total, v_failed, v_problem, v_details
    from done;

  if v_total = 0 then
    return 'nothing new to report';
  end if;

  v_status := case when v_failed = 0 then 'ok' else 'failed' end;
  v_message := case
    when v_failed = 0 then 'Started ' || v_total || ' GitHub job' || case when v_total > 1 then 's' else '' end || ' on time since the last check.'
    else v_failed || ' of ' || v_total || ' starts failed. ' || v_problem
  end;

  select id, status into v_latest from public.job_runs where job = 'timer' order by started_at desc limit 1;
  if v_latest.id is not null and v_latest.status = v_status then
    update public.job_runs
       set heartbeat_at = now(), finished_at = now(), message = v_message,
           requests = requests + v_total, details = v_details
     where id = v_latest.id;
  else
    insert into public.job_runs (job, status, runner, source, requests, message, details, finished_at, heartbeat_at)
    values ('timer', v_status, 'supabase-cron', 'github', v_total, v_message, v_details, now(), now());
  end if;

  -- Housekeeping: keep a month of start requests and two weeks of pg_cron's log.
  delete from timer.dispatches where sent_at < now() - interval '31 days';
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''14 days''';
  end if;
  return v_message;
end;
$$;

revoke all on all tables in schema timer from public;
revoke all on all functions in schema timer from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema timer from anon, authenticated';
    execute 'revoke all on all functions in schema timer from anon, authenticated';
  end if;
end $$;

-- ---------------------------------------------------------------- schedule
-- Only where pg_cron and pg_net exist (Supabase). Re-running this file
-- replaces the jobs, so the schedule always matches timer.plan.

do $outer$
declare
  p record;
  n integer := 0;
begin
  if not exists (select 1 from pg_available_extensions where name = 'pg_cron')
     or not exists (select 1 from pg_available_extensions where name = 'pg_net') then
    raise notice 'pg_cron or pg_net is not available here: the timer is not scheduled.';
    return;
  end if;
  execute 'create extension if not exists pg_cron with schema pg_catalog';
  execute 'create extension if not exists pg_net with schema extensions';

  -- Remove earlier timer jobs, then add one per plan row.
  perform cron.unschedule(jobname) from cron.job where jobname like 'timer:%';
  for p in select workflow, cron, row_number() over (partition by workflow order by cron) as k from timer.plan loop
    perform cron.schedule(
      'timer:' || replace(p.workflow, '.yml', '') || ':' || p.k,
      p.cron,
      format('select timer.start(%L)', p.workflow));
    n := n + 1;
  end loop;
  perform cron.schedule('timer:check', '3 * * * *', 'select timer.check()');
  raise notice 'timer: % start jobs and the hourly check scheduled.', n;
end $outer$;
