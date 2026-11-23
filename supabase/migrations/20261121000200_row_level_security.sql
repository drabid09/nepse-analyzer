-- Phase 1, migration 2: who may read and who may write.
--
-- Rule: everything here is public market data, so anyone may read it. Nobody
-- may write through the public (anon) key. The only writer is the service_role
-- key held in GitHub Actions secrets; that role bypasses row level security.
--
-- Two independent locks are applied on purpose:
--   1. Row level security with a single SELECT policy and no write policies.
--   2. Table privileges: write rights revoked from the public roles. TRUNCATE
--      in particular is not covered by row level security, so it needs this.

do $$
declare
  t text;
begin
  foreach t in array array[
    'sectors', 'indices', 'companies',
    'daily_prices', 'intraday_snapshots',
    'index_daily', 'index_intraday', 'market_daily', 'floorsheet_daily',
    'corporate_actions', 'issues', 'fundamentals',
    'signals', 'forecasts', 'backtest_results'
  ]
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

-- Identity columns draw from sequences; the writer needs them, the public does not.
grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;
