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
    'select public.prune_analytics(120, 14)',
    -- Feedback: the public may send a message, but not read, change or delete any.
    'select count(*) from public.feedback',
    'update public.feedback set status = ''done''',
    'delete from public.feedback',
    'truncate public.feedback',
    'insert into public.feedback (kind, message, status) values (''other'', ''security test'', ''done'')',
    'select public.feedback_limit()',
    -- The Supabase timer lives in its own schema, out of the public's reach.
    'select count(*) from timer.plan',
    'select count(*) from timer.dispatches',
    'select timer.start(''watchdog.yml'')',
    'select timer.check()'
  ];
begin
  -- 1. Structure: 19 tables (15 from Phase 1, job_runs and price_adjustments
  --    from Phase 2, quality_issues from Phase 3, feedback after launch), each
  --    with row level security on.
  select count(*) into n from pg_tables where schemaname = 'public';
  insert into check_results values ('19 tables exist', n = 19, n || ' found');
  select count(*) into n from pg_tables where schemaname = 'public' and not rowsecurity;
  insert into check_results values ('row level security is on everywhere', n = 0, n || ' tables without it');
  select count(*) into n from pg_policies
  where schemaname = 'public' and cmd <> 'SELECT' and not (tablename = 'feedback' and cmd = 'INSERT');
  insert into check_results values ('no write policies except sending feedback', n = 0, n || ' other write policies');

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

  -- 4. The public can send a feedback message. The deliberate error right after
  --    the insert rolls it back, so running this leaves no test message behind.
  begin
    set local role anon;
    insert into public.feedback (kind, message) values ('other', 'security check, rolled back');
    raise exception 'sent' using errcode = 'P0002';
  exception
    when sqlstate 'P0002' then
      reset role;
      insert into check_results values ('public can send feedback', true, 'insert of the message columns allowed');
    when insufficient_privilege then
      reset role;
      insert into check_results values ('public can send feedback', false, 'REFUSED: the feedback form would not work');
  end;

  -- 5. Same for a signed-in (authenticated) visitor.
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

  -- 6. The timer's schema and the GitHub token in Vault are closed to visitors.
  insert into check_results values ('public cannot see the timer schema',
    not has_schema_privilege('anon', 'timer', 'USAGE') and not has_schema_privilege('authenticated', 'timer', 'USAGE'),
    'usage on schema timer');
  if to_regclass('vault.decrypted_secrets') is not null then
    insert into check_results values ('public cannot read Vault',
      not has_table_privilege('anon', 'vault.decrypted_secrets', 'SELECT')
      and not has_table_privilege('authenticated', 'vault.decrypted_secrets', 'SELECT'),
      'select on vault.decrypted_secrets');
  end if;
end
$$;

select * from check_results order by passed, check_name;
