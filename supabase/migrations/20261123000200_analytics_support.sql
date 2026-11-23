-- Phase 3, migration 5: what the analytics, backtest and watchdog jobs need.
--
--   * job_runs accepts the three new jobs.
--   * signals record the price they were computed on and whether the data
--     behind them passed every check; a failed check means no call is shown.
--   * quality_issues lists every failed data check, so the website can say
--     what is wrong instead of showing a doubtful number.
--   * latest_job_runs is the health panel: the newest run of each job.
--   * helper functions for the jobs only: load adjusted price series, score
--     forecasts whose date has passed, and prune old daily rows.

-- ---------------------------------------------------------------- job_runs

alter table public.job_runs drop constraint job_runs_job_check;
alter table public.job_runs add constraint job_runs_job_check
  check (job in ('live', 'eod', 'backfill', 'details', 'companies', 'analytics', 'backtest', 'watchdog'));

-- ---------------------------------------------------------------- signals

alter table public.signals
  add column close         numeric(12, 2),                  -- price the signal was computed on
  add column last_traded   date,                            -- the company's last trading day at that point
  add column data_ok       boolean not null default true,   -- false: a data check failed, no call shown
  add column data_note     text,                            -- what failed, in plain words
  add column model_version text;                            -- rules version, for the track record

-- ---------------------------------------------------------------- quality_issues

create table public.quality_issues (
  id           bigint generated always as identity primary key,
  trade_date   date not null,
  company_id   integer references public.companies (id) on delete cascade,  -- null: market-wide
  check_name   text not null,     -- 'circuit_limit', 'ohlc_order', 'cross_source', 'row_count', 'stale', ...
  severity     text not null check (severity in ('info', 'warning', 'error')),
  detail       text not null,
  detected_at  timestamptz not null default now(),
  constraint quality_issues_key unique nulls not distinct (trade_date, company_id, check_name)
);

create index quality_issues_date_idx on public.quality_issues (trade_date desc, severity);

alter table public.quality_issues enable row level security;
drop policy if exists "Public read" on public.quality_issues;
create policy "Public read" on public.quality_issues for select to anon, authenticated using (true);
revoke all on public.quality_issues from anon, authenticated;
grant select on public.quality_issues to anon, authenticated;
grant all on public.quality_issues to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------- health view

-- Newest run of each job. security_invoker: readers see it through job_runs'
-- own row level security, so the view grants nothing extra.
create or replace view public.latest_job_runs
with (security_invoker = true)
as
select distinct on (job) id, job, trade_date, status, started_at, heartbeat_at, finished_at,
       runner, run_url, requests, rows_written, message
from public.job_runs
order by job, started_at desc;

revoke all on public.latest_job_runs from anon, authenticated;
grant select on public.latest_job_runs to anon, authenticated, service_role;

-- ---------------------------------------------------------------- helper functions

-- Adjusted daily series for a set of companies: one row per company with
-- arrays of dates, adjusted open/high/low/close and raw volume.
create or replace function public.analytics_series(p_since date, p_company_ids integer[])
returns table (company_id integer, series jsonb)
language sql
stable
set search_path = ''
as $$
  select d.company_id,
         jsonb_build_object(
           'date',   jsonb_agg(d.date order by d.date),
           'open',   jsonb_agg(round(d.open  * d.adj_factor::numeric, 4) order by d.date),
           'high',   jsonb_agg(round(d.high  * d.adj_factor::numeric, 4) order by d.date),
           'low',    jsonb_agg(round(d.low   * d.adj_factor::numeric, 4) order by d.date),
           'close',  jsonb_agg(round(d.close * d.adj_factor::numeric, 4) order by d.date),
           'volume', jsonb_agg(d.volume order by d.date)
         )
  from public.daily_prices d
  where d.company_id = any (p_company_ids) and d.date >= p_since and d.is_final
  group by d.company_id;
$$;

-- Fill actual_close for forecasts whose target date has passed, on the same
-- price basis as the forecast (corrected for bonus or right shares in between).
create or replace function public.score_forecasts(p_date date)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  changed integer;
begin
  with due as (
    select f.company_id, f.made_on, f.horizon, f.model, f.target_date
    from public.forecasts f
    where f.actual_close is null and f.target_date <= p_date
  ),
  hit as (
    select due.*, t.close, t.adj_factor as target_adj,
           (select m.adj_factor from public.daily_prices m
             where m.company_id = due.company_id and m.date <= due.made_on
             order by m.date desc limit 1) as made_adj
    from due
    cross join lateral (
      select d.close, d.adj_factor from public.daily_prices d
      where d.company_id = due.company_id and d.date >= due.target_date and d.date <= p_date and d.is_final
      order by d.date limit 1
    ) t
  )
  update public.forecasts f
  set actual_close = round((hit.close * hit.target_adj::numeric / nullif(hit.made_adj, 0)::numeric), 2)
  from hit
  where f.company_id = hit.company_id and f.made_on = hit.made_on and f.horizon = hit.horizon
    and f.model = hit.model and hit.made_adj is not null;
  get diagnostics changed = row_count;
  return changed;
end
$$;

-- Keep daily signals for p_signal_days and daily forecasts for p_forecast_days;
-- after that keep only the last trading day of each week, which is enough for
-- the track record and keeps the free database small.
create or replace function public.prune_analytics(p_signal_days integer default 120, p_forecast_days integer default 14)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  removed integer := 0;
  n integer;
begin
  with week_last as (
    select max(m.date) as d from public.market_daily m where m.is_final group by date_trunc('week', m.date)
  )
  delete from public.signals s
  where s.date < current_date - p_signal_days and s.date not in (select d from week_last);
  get diagnostics n = row_count;
  removed := removed + n;

  with week_last as (
    select max(m.date) as d from public.market_daily m where m.is_final group by date_trunc('week', m.date)
  )
  delete from public.forecasts f
  where f.made_on < current_date - p_forecast_days and f.made_on not in (select d from week_last);
  get diagnostics n = row_count;
  removed := removed + n;
  return removed;
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'analytics_series(date, integer[])',
    'score_forecasts(date)',
    'prune_analytics(integer, integer)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
