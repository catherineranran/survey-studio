-- Survey Studio: database schema for Supabase
--
-- Run this once in your Supabase project:
--   SQL Editor -> New query -> paste this whole file -> Run
-- It is safe to run again after an update; it only creates what is missing
-- and replaces the functions and policies.
--
-- Security model
--   * Survey owners sign in (Supabase Auth) and can only see their own surveys
--     and the responses to them (row-level security). Who may create an account
--     is decided by the admins (public.owners) in the app: nobody, people with
--     the invite link, or anyone. The database enforces it on every new account.
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

-- Accounts and sign-up --------------------------------------------------------
--
-- public.owners lists the admins of this Survey Studio; the first account
-- becomes one automatically. Admins choose in the app (Invite people) who may
-- create their own account: nobody, people with the invite link, or anyone.
-- Every account only ever sees its own surveys and responses.
-- To make someone else an admin, run (with their email):
--   insert into public.owners (email) values ('colleague@example.org');

create table if not exists public.owners (
  email      text primary key,
  created_at timestamptz not null default now()
);
alter table public.owners enable row level security;  -- no policies: never readable through the API
revoke all on public.owners from anon, authenticated;

create table if not exists public.app_settings (
  id          boolean primary key default true check (id),  -- exactly one row
  signup_mode text not null default 'closed' check (signup_mode in ('closed', 'invite', 'open')),
  invite_code text,
  updated_at  timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;
alter table public.app_settings enable row level security;  -- read and changed only through the functions below
revoke all on public.app_settings from anon, authenticated;

create or replace function public.guard_new_account()
returns trigger
language plpgsql security definer
set search_path = public
as $$
declare
  addr text := lower(trim(coalesce(new.email, '')));
  code text := nullif(trim(coalesce(new.raw_user_meta_data ->> 'invite_code', '')), '');
  cfg  public.app_settings%rowtype;
begin
  if addr = '' then
    raise exception 'Survey Studio accounts need an email address.';
  end if;
  -- The invite code is only a key; it is never kept on the account.
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'invite_code';
  if not exists (select 1 from public.owners) then
    insert into public.owners (email) values (addr);  -- the first account becomes an admin
    return new;
  end if;
  if exists (select 1 from public.owners where email = addr) then
    return new;
  end if;
  select * into cfg from public.app_settings where id;
  if cfg.signup_mode = 'open' then
    return new;
  end if;
  if cfg.signup_mode = 'invite' and cfg.invite_code is not null and code = cfg.invite_code then
    return new;
  end if;
  raise exception 'Sign-ups are closed, or the invite link is no longer valid.';
end;
$$;

revoke all on function public.guard_new_account() from public, anon, authenticated;

do $$
begin
  -- Accounts created before this script ran (e.g. in the dashboard) are admins too.
  insert into public.owners (email)
    select lower(trim(email)) from auth.users where coalesce(trim(email), '') <> ''
    on conflict do nothing;
  drop trigger if exists guard_new_account on auth.users;
  create trigger guard_new_account
    before insert on auth.users
    for each row execute function public.guard_new_account();
exception when others then
  raise warning 'Survey Studio could not add its sign-up guard (%). Keep "Allow new users to sign up" turned off under Authentication.', sqlerrm;
end;
$$;

-- What the sign-in page may know: the mode, never the code.
create or replace function public.signup_mode()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select signup_mode from public.app_settings where id), 'closed');
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.owners o
    where o.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create or replace function public.get_signup_settings()
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  return (select jsonb_build_object('mode', signup_mode, 'code', invite_code) from public.app_settings where id);
end;
$$;

-- p_new_code: replace the invite code, so links shared before stop working.
create or replace function public.set_signup_settings(p_mode text, p_new_code boolean default false)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'not_allowed';
  end if;
  if p_mode not in ('closed', 'invite', 'open') then
    raise exception 'invalid_mode';
  end if;
  update public.app_settings
     set signup_mode = p_mode,
         invite_code = case when p_new_code or invite_code is null
                            then substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)
                            else invite_code end,
         updated_at  = now()
   where id;
  return public.get_signup_settings();
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
revoke all on function public.signup_mode() from public;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.get_signup_settings() from public, anon;
revoke all on function public.set_signup_settings(text, boolean) from public, anon;

grant execute on function public.get_public_survey(uuid) to anon, authenticated;
grant execute on function public.submit_response(uuid, jsonb) to anon, authenticated;
grant execute on function public.assignment_counts(uuid, text) to anon, authenticated;
grant execute on function public.my_response_counts() to authenticated;
grant execute on function public.signup_mode() to anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_signup_settings() to authenticated;
grant execute on function public.set_signup_settings(text, boolean) to authenticated;
