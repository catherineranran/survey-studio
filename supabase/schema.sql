-- Survey Studio: database schema for Supabase
--
-- Run this once in your Supabase project:
--   SQL Editor -> New query -> paste this whole file -> Run
-- It is safe to run again after an update; it only creates what is missing
-- and replaces the functions and policies.
--
-- Security model
--   * Survey owners sign in (Supabase Auth) and can only see their own surveys
--     and the responses to them (row-level security). New accounts are refused
--     unless their email is in public.owners (the first account is added
--     automatically), so strangers can't sign up.
--   * Respondents are anonymous. They have NO direct access to the tables.
--     They can only call get_public_survey() (returns the published snapshot,
--     never the working draft) and submit_response() (only while the survey is
--     open, before its close date and below its response limit).

create extension if not exists pgcrypto;

-- Tables ---------------------------------------------------------------------

create table if not exists public.surveys (
  id           uuid primary key,
  owner_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null default 'Untitled survey',
  status       text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  definition   jsonb not null,           -- working copy edited in the builder
  published    jsonb,                    -- snapshot respondents see
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.responses (
  id          uuid primary key default gen_random_uuid(),
  survey_id   uuid not null references public.surveys (id) on delete cascade,
  data        jsonb not null,            -- answers, URL parameters, assignments, timing
  is_preview  boolean not null default false,
  created_at  timestamptz not null default now()
);

create index if not exists surveys_owner_idx on public.surveys (owner_id);
create index if not exists responses_survey_created_idx on public.responses (survey_id, created_at);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists surveys_touch_updated_at on public.surveys;
create trigger surveys_touch_updated_at
  before update on public.surveys
  for each row execute function public.touch_updated_at();

-- Owner accounts -------------------------------------------------------------
--
-- Survey Studio has no public sign-up. Only emails listed in public.owners can
-- get an account; the very first account becomes the owner automatically.
-- To add a co-owner later, run (with their email) and then add them under
-- Authentication -> Users:
--   insert into public.owners (email) values ('colleague@example.org');

create table if not exists public.owners (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;  -- no policies: never readable through the API
revoke all on public.owners from anon, authenticated;

create or replace function public.guard_new_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  addr text := lower(trim(coalesce(new.email, '')));
begin
  if addr = '' then
    raise exception 'Survey Studio accounts need an email address.';
  end if;
  if not exists (select 1 from public.owners) then
    insert into public.owners (email) values (addr);  -- the first account becomes the owner
    return new;
  end if;
  if exists (select 1 from public.owners where email = addr) then
    return new;
  end if;
  raise exception 'Sign-ups are closed for this Survey Studio.';
end;
$$;

revoke all on function public.guard_new_account() from public, anon, authenticated;

do $$
begin
  -- Accounts created before this script ran (e.g. in the dashboard) are owners too.
  insert into public.owners (email)
    select lower(trim(email)) from auth.users where coalesce(trim(email), '') <> ''
    on conflict do nothing;
  drop trigger if exists guard_new_account on auth.users;
  create trigger guard_new_account
    before insert on auth.users
    for each row execute function public.guard_new_account();
exception when others then
  raise warning 'Survey Studio could not add its sign-up guard (%). Turn off "Allow new users to sign up" under Authentication instead.', sqlerrm;
end;
$$;

-- Access ---------------------------------------------------------------------

alter table public.surveys enable row level security;
alter table public.responses enable row level security;

revoke all on public.surveys from anon;
revoke all on public.responses from anon;
grant select, insert, update, delete on public.surveys to authenticated;
grant select, insert, delete on public.responses to authenticated;

drop policy if exists "Owners read their surveys" on public.surveys;
create policy "Owners read their surveys" on public.surveys
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "Owners create surveys" on public.surveys;
create policy "Owners create surveys" on public.surveys
  for insert to authenticated with check (owner_id = (select auth.uid()));

drop policy if exists "Owners edit their surveys" on public.surveys;
create policy "Owners edit their surveys" on public.surveys
  for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "Owners delete their surveys" on public.surveys;
create policy "Owners delete their surveys" on public.surveys
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "Owners read responses" on public.responses;
create policy "Owners read responses" on public.responses
  for select to authenticated
  using (exists (select 1 from public.surveys s where s.id = survey_id and s.owner_id = (select auth.uid())));

drop policy if exists "Owners delete responses" on public.responses;
create policy "Owners delete responses" on public.responses
  for delete to authenticated
  using (exists (select 1 from public.surveys s where s.id = survey_id and s.owner_id = (select auth.uid())));

-- Owners can store test responses from the builder's preview (flagged is_preview).
drop policy if exists "Owners add test responses" on public.responses;
create policy "Owners add test responses" on public.responses
  for insert to authenticated
  with check (
    is_preview
    and exists (select 1 from public.surveys s where s.id = survey_id and s.owner_id = (select auth.uid()))
  );

-- Functions respondents may call ---------------------------------------------

create or replace function public.get_public_survey(p_id uuid)
returns jsonb
language sql stable security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', s.id,
    'status', s.status,
    'published', s.published,
    'published_at', s.published_at,
    'response_count', (select count(*) from public.responses r where r.survey_id = s.id and not r.is_preview)
  )
  from public.surveys s
  where s.id = p_id and s.published is not null;
$$;

create or replace function public.submit_response(p_survey uuid, p_data jsonb)
returns uuid
language plpgsql security definer
set search_path = public
as $$
declare
  s        public.surveys%rowtype;
  lim      bigint;
  close_at timestamptz;
  n        bigint;
  new_id   uuid;
begin
  -- Lock the survey row so concurrent submissions can't overshoot the response limit.
  select * into s from public.surveys where id = p_survey for update;
  if not found or s.published is null then
    raise exception 'not_found';
  end if;
  if s.status <> 'open' then
    raise exception 'closed';
  end if;

  begin
    close_at := nullif(s.published -> 'settings' ->> 'closeAt', '')::timestamptz;
  exception when others then
    close_at := null;  -- an unreadable date never blocks submissions
  end;
  if close_at is not null and now() > close_at then
    raise exception 'closed';
  end if;

  if jsonb_typeof(s.published -> 'settings' -> 'responseLimit') = 'number' then
    lim := floor((s.published -> 'settings' ->> 'responseLimit')::numeric)::bigint;
  end if;
  if lim is not null and lim > 0 then
    select count(*) into n from public.responses where survey_id = p_survey and not is_preview;
    if n >= lim then
      raise exception 'limit';
    end if;
  end if;

  -- Shape checks: the app always sends these as objects of the right kinds.
  if jsonb_typeof(p_data) <> 'object'
     or octet_length(p_data::text) > 200000
     or jsonb_typeof(coalesce(p_data -> 'answers', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_data -> 'embedded', '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_data -> 'meta', '{}'::jsonb)) <> 'object'
     or exists (
       select 1 from jsonb_each(coalesce(p_data -> 'embedded', '{}'::jsonb)) e
       where jsonb_typeof(e.value) <> 'string' or length(e.value #>> '{}') > 1000
     ) then
    raise exception 'invalid response';
  end if;

  insert into public.responses (survey_id, data, is_preview)
  values (p_survey, p_data, false)
  returning id into new_id;
  return new_id;
end;
$$;

-- Completed responses per randomizer value, for balanced assignment.
-- Only fields that are randomizers in the published survey can be counted,
-- so this never reveals URL parameters such as participant IDs.
create or replace function public.assignment_counts(p_survey uuid, p_field text)
returns table (value text, n bigint)
language sql stable security definer
set search_path = public
as $$
  select r.data -> 'embedded' ->> p_field as value, count(*) as n
  from public.responses r
  join public.surveys s on s.id = r.survey_id
  where r.survey_id = p_survey
    and not r.is_preview
    and exists (
      select 1 from jsonb_array_elements(coalesce(s.published -> 'randomizers', '[]'::jsonb)) z
      where z ->> 'variable' = p_field
    )
  group by 1;
$$;

-- Response counts for the signed-in owner's dashboard (row-level security applies).
create or replace function public.my_response_counts()
returns table (survey_id uuid, n bigint)
language sql stable security invoker
set search_path = public
as $$
  select r.survey_id, count(*) from public.responses r where not r.is_preview group by r.survey_id;
$$;

revoke all on function public.get_public_survey(uuid) from public;
revoke all on function public.submit_response(uuid, jsonb) from public;
revoke all on function public.assignment_counts(uuid, text) from public;
revoke all on function public.my_response_counts() from public;
revoke all on function public.my_response_counts() from anon;

grant execute on function public.get_public_survey(uuid) to anon, authenticated;
grant execute on function public.submit_response(uuid, jsonb) to anon, authenticated;
grant execute on function public.assignment_counts(uuid, text) to anon, authenticated;
grant execute on function public.my_response_counts() to authenticated;
