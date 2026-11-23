-- How the published price ranges are doing, counted in the database.
--
-- The Track record page used to download every checked range and count them
-- itself. About 780 ranges are published each trading day, so that download
-- would have grown without limit (tens of MB per read within a year, enough to
-- exhaust the free plan's monthly data transfer) and, past 1000 rows, depended
-- on unordered paging. This view returns three rows.
--
-- security_invoker: visitors read it through forecasts' own row level security,
-- so it grants nothing that the table does not already allow.

create or replace view public.forecast_live_record
with (security_invoker = true)
as
select horizon,
       count(*)::integer as checked,
       count(*) filter (where actual_close between low and high)::integer as inside
from public.forecasts
where model = 'ensemble' and actual_close is not null
group by horizon;

revoke all on public.forecast_live_record from anon, authenticated;
grant select on public.forecast_live_record to anon, authenticated, service_role;
