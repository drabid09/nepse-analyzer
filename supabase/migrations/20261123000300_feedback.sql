-- After launch: a private feedback box for the dashboard's reader.
--
-- This is the one table the public key may write to, and only narrowly:
--   * it may INSERT the four message columns (kind, page, message, name), nothing else;
--   * it may not read, change or delete anything, its own messages included;
--   * a trigger refuses more than 20 messages an hour and 100 a day in total, so a
--     shared link cannot be used to flood the database;
--   * lengths are limited by check constraints.
-- The feedback workflow (service key) reads new rows and opens a GitHub issue that
-- tags the owner without quoting the message, because the repository is public.
-- For the same reason feedback is left out of the weekly backup artifact.

create table if not exists public.feedback (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('request', 'idea', 'problem', 'other')),
  page         text check (char_length(page) <= 200),
  message      text not null check (char_length(btrim(message)) between 3 and 4000),
  name         text not null default 'Sanjeev' check (char_length(name) between 1 and 80),
  status       text not null default 'new' check (status in ('new', 'seen', 'planned', 'done', 'declined')),
  issue_number integer,
  notified_at  timestamptz
);

create index if not exists feedback_unnotified on public.feedback (id) where notified_at is null;
create index if not exists feedback_created on public.feedback (created_at);

alter table public.feedback enable row level security;
drop policy if exists "Public can send" on public.feedback;
create policy "Public can send" on public.feedback for insert to anon, authenticated
  with check (status = 'new' and issue_number is null and notified_at is null);

revoke all on public.feedback from anon, authenticated;
grant insert (kind, page, message, name) on public.feedback to anon, authenticated;
grant all on public.feedback to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke all on all sequences in schema public from anon, authenticated;

-- Flood limit. Runs as its owner so it can count rows the public cannot see.
create or replace function public.feedback_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.feedback where created_at > now() - interval '1 hour') >= 20
     or (select count(*) from public.feedback where created_at > now() - interval '1 day') >= 100 then
    raise exception 'Too many messages right now. Please try again later.' using errcode = 'P0001';
  end if;
  return new;
end
$$;

revoke all on function public.feedback_limit() from public, anon, authenticated;

drop trigger if exists feedback_limit on public.feedback;
create trigger feedback_limit before insert on public.feedback
  for each row execute function public.feedback_limit();
