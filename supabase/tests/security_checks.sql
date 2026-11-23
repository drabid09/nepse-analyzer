-- Run this in the Supabase SQL editor at any time. It changes nothing.
-- Every row in the result should say passed = true.
--
-- It tries, as the public (anon) role, to read and then to write, and records
-- what the database allowed.

drop table if exists check_results;
create temp table check_results (check_name text, passed boolean, detail text);

do $$
declare
  t text;
  n bigint;
  attempt text;
  attempts text[] := array[
    'insert into public.companies (symbol, name) values (''ZZ_SECURITY_TEST'', ''should never exist'')',
    'update public.sectors set name = name',
    'delete from public.indices',
    'truncate public.signals',
    'insert into public.daily_prices (company_id, date, close, source) select id, current_date, 1, ''test'' from public.companies limit 1',
    'insert into public.job_runs (job, status, runner) values (''live'', ''ok'', ''security-test'')',
    'delete from public.price_adjustments',
    -- Phase 2 helper functions are for the fetch jobs only.
    'select public.apply_price_adjustments(1)',
    'select * from public.storage_report()',
    'select * from public.latest_closes_before(current_date, current_date - 30)',
    'select * from public.trading_days(current_date - 30)',
    -- Phase 3 additions.
    'insert into public.quality_issues (trade_date, check_name, severity, detail) values (current_date, ''test'', ''info'', ''test'')',
    'select * from public.analytics_series(current_date - 30, array[1])',
    'select public.score_forecasts(current_date)',
    'select public.prune_analytics(120, 14)'
  ];
begin
  -- 1. Structure: 18 tables (15 from Phase 1, job_runs and price_adjustments
  --    from Phase 2, quality_issues from Phase 3), each with row level security
  --    on and one read policy.
  select count(*) into n from pg_tables where schemaname = 'public';
  insert into check_results values ('18 tables exist', n = 18, n || ' found');
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  insert into check_results values ('row level security is on everywhere', n = 0, n || ' tables without it');
  select count(*) into n from pg_policies where schemaname = 'public' and cmd <> 'SELECT';
  insert into check_results values ('no write policies exist', n = 0, n || ' write policies');

  -- 2. The public role can read.
  set local role anon;
  select count(*) into n from public.sectors;
  reset role;
  insert into check_results values ('public can read sectors', n = 13, n || ' sectors visible');
  set local role anon;
  select count(*) into n from public.job_runs;
  reset role;
  insert into check_results values ('public can read job_runs', true, n || ' job runs visible');
  set local role anon;
  select count(*) into n from public.latest_job_runs;
  reset role;
  insert into check_results values ('public can read the health view', true, n || ' jobs visible');

  -- 3. The public role cannot write, or call the jobs' helper functions. Each
  --    attempt must be refused. If one is ever allowed, the deliberate error
  --    right after it rolls the write back, so this script can never change or
  --    delete real data.
  foreach attempt in array attempts loop
    begin
      set local role anon;
      execute attempt;
      raise exception 'write was allowed' using errcode = 'P0001';
    exception
      when insufficient_privilege then
        reset role;
        insert into check_results values ('public write refused', true, attempt);
      when raise_exception then
        reset role;
        insert into check_results values ('public write refused', false, 'ALLOWED: ' || attempt);
    end;
  end loop;

  -- 4. Same for a signed-in (authenticated) visitor.
  begin
    set local role authenticated;
    delete from public.companies;
    raise exception 'write was allowed' using errcode = 'P0001';
  exception
    when insufficient_privilege then
      reset role;
      insert into check_results values ('signed-in write refused', true, 'delete from public.companies');
    when raise_exception then
      reset role;
      insert into check_results values ('signed-in write refused', false, 'ALLOWED: delete from public.companies');
  end;
end
$$;

select * from check_results order by passed, check_name;
