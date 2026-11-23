-- Phase 2, migration 4: what the fetch jobs need besides the market tables.
--
--   * job_runs           one row per job run: the website's "last updated" stamp
--                        and health badge, and the trading-day calendar's record
--                        of holidays.
--   * price_adjustments  bonus and right-share events, detected from the data
--                        itself (NEPSE's adjusted previous close against the last
--                        traded close). daily_prices.adj_factor is computed from it.
--   * helper functions   called only by the fetch jobs through the service key.
--
-- Same security rule as Phase 1: anyone may read the tables, only the service
-- key may write, and the helper functions are not callable with the public key.

-- ---------------------------------------------------------------- job_runs

create table public.job_runs (
  id            bigint generated always as identity primary key,
  job           text not null check (job in ('live', 'eod', 'backfill', 'details', 'companies')),
  trade_date    date,            -- NEPSE business date the run covers, when there is one
  status        text not null check (status in ('running', 'ok', 'partial', 'failed', 'skipped', 'holiday')),
  started_at    timestamptz not null default now(),
  heartbeat_at  timestamptz not null default now(),  -- last time the run reported in
  finished_at   timestamptz,
  runner        text not null,   -- 'github-actions', or the name of a fallback machine
  run_url       text,
  source        text,            -- 'nepse', 'csv', 'sharesansar'
  requests      integer not null default 0,
  rows_written  integer not null default 0,
  message       text,
  details       jsonb not null default '{}'
);

create index job_runs_job_started_idx on public.job_runs (job, started_at desc);
-- "Was this weekday a holiday?" for the adjustment detector's continuity check.
create index job_runs_holiday_idx on public.job_runs (trade_date) where status = 'holiday';

-- ---------------------------------------------------------------- price_adjustments

-- On the first trading day after a bonus or right-share book closure, NEPSE
-- reports a previous close that is lower than the last price actually traded.
-- The ratio of the two is the adjustment factor. Example from the history data:
-- NABIL on 2019-02-26 (12% bonus) gives 708.91 / 794.00 = 0.8928 = 1 / 1.12.
create table public.price_adjustments (
  company_id           integer not null references public.companies (id) on delete cascade,
  ex_date              date not null,            -- first trading day priced after the event
  factor               real not null check (factor > 0),  -- multiply earlier prices by this
  prev_close_reported  numeric(12, 2) not null,  -- NEPSE's (adjusted) previous close on ex_date
  prev_close_actual    numeric(12, 2) not null,  -- last traded close before ex_date
  prev_date            date not null,            -- date of that last traded close
  -- confirmed: used for adj_factor. unconfirmed: a possible gap in our data or an
  -- unusual factor, kept for review and not applied. rejected: reviewed, ignored.
  status               text not null check (status in ('confirmed', 'unconfirmed', 'rejected')),
  source               text not null,            -- 'csv' (history import) or 'nepse' (daily job)
  note                 text,
  detected_at          timestamptz not null default now(),
  primary key (company_id, ex_date)
);

create index price_adjustments_ex_date_idx on public.price_adjustments (ex_date);

-- ---------------------------------------------------------------- companies

-- The details job refreshes ISIN, listing date, shares and market cap a few
-- companies at a time; this records when each one was last refreshed.
alter table public.companies add column details_checked_at timestamptz;

-- ---------------------------------------------------------------- security

do $$
declare
  t text;
begin
  foreach t in array array['job_runs', 'price_adjustments']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Public read" on public.%I', t);
    execute format('create policy "Public read" on public.%I for select to anon, authenticated using (true)', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
    execute format('grant select on public.%I to anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end
$$;

grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;

-- ---------------------------------------------------------------- helper functions

-- Size of every table and of the whole database (the free plan's limit is 500 MB).
create or replace function public.storage_report()
returns table (name text, total_bytes bigint, approx_rows bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select c.relname::text, pg_catalog.pg_total_relation_size(c.oid), greatest(c.reltuples, 0)::bigint
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind = 'r'
  union all
  select '(database)', pg_catalog.pg_database_size(pg_catalog.current_database()), null
  order by 2 desc;
$$;

-- Each company's last final close before a date, looking back no further than p_since.
create or replace function public.latest_closes_before(p_date date, p_since date)
returns table (company_id integer, date date, close numeric)
language sql
stable
set search_path = ''
as $$
  select distinct on (d.company_id) d.company_id, d.date, d.close
  from public.daily_prices d
  where d.date < p_date and d.date >= p_since and d.is_final
  order by d.company_id, d.date desc;
$$;

-- Dates on which at least one final price is stored: the trading days we hold.
create or replace function public.trading_days(p_since date)
returns table (date date)
language sql
stable
set search_path = ''
as $$
  select distinct d.date from public.daily_prices d
  where d.date >= p_since and d.is_final
  order by 1;
$$;

-- Recompute adj_factor for one company from its confirmed adjustments.
-- A row's factor is the product of the factors of all events after its date.
create or replace function public.apply_price_adjustments(p_company_id integer)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  changed integer;
begin
  with events as (
    select a.ex_date,
           exp(sum(ln(a.factor::double precision)) over (order by a.ex_date desc)) as cum
    from public.price_adjustments a
    where a.company_id = p_company_id and a.status = 'confirmed'
  ),
  target as (
    select d.date,
           coalesce((select e.cum from events e where e.ex_date > d.date order by e.ex_date limit 1), 1)::real as f
    from public.daily_prices d
    where d.company_id = p_company_id
  )
  update public.daily_prices d
  set adj_factor = t.f
  from target t
  where d.company_id = p_company_id and d.date = t.date and d.adj_factor is distinct from t.f;
  get diagnostics changed = row_count;
  return changed;
end
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'storage_report()',
    'latest_closes_before(date, date)',
    'trading_days(date)',
    'apply_price_adjustments(integer)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end
$$;
