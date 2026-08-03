-- ============================================================================
-- Closer Copilot — admin platform schema  (v2: roles, credits, orgs, logs, backups)
--
-- RUN THIS YOURSELF: Supabase dashboard -> SQL Editor -> paste -> Run.
-- It is idempotent — safe to re-run after edits.
--
-- READ THIS FIRST. Section 3 is a real privacy decision: it lets accounts in
-- public.admin_users read (and write) EVERY user's rows — call transcripts,
-- client records, notes. There are 9 real accounts on this project. Only run
-- section 3 if you intend that. Everything else is self-contained.
--
-- To undo section 3 later:
--   drop policy "admin full access" on public.calls;   -- (repeat per table)
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Admin roles
--    owner   — everything, incl. granting/revoking admins and destructive ops
--    admin   — everything except changing other admins
--    support — read everything, adjust credits, no destructive ops
--    viewer  — read-only
-- ---------------------------------------------------------------------------
create table if not exists public.admin_users (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  role       text not null default 'admin' check (role in ('owner','admin','support','viewer')),
  note       text not null default '',
  created_at timestamptz not null default now()
);
alter table public.admin_users enable row level security;

-- migrate from the v1 table name if it exists
do $$
begin
  if to_regclass('public.admins') is not null then
    insert into public.admin_users (user_id, role)
    select user_id, 'owner' from public.admins
    on conflict (user_id) do nothing;
  end if;
end $$;

create or replace function public.admin_role(uid uuid)
returns text language sql security definer stable set search_path = public as $$
  select role from public.admin_users where user_id = uid;
$$;

create or replace function public.is_admin(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from public.admin_users where user_id = uid);
$$;

-- can this admin perform write/destructive actions?
create or replace function public.admin_can_write(uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select coalesce(public.admin_role(uid) in ('owner','admin'), false);
$$;

drop policy if exists "admin_users readable" on public.admin_users;
create policy "admin_users readable" on public.admin_users
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));

drop policy if exists "owners manage admins" on public.admin_users;
create policy "owners manage admins" on public.admin_users
  for all using (public.admin_role(auth.uid()) = 'owner')
  with check (public.admin_role(auth.uid()) = 'owner');

-- Seed the first owner. CHANGE THIS EMAIL to whichever account you sign in with.
insert into public.admin_users (user_id, role)
select id, 'owner' from auth.users where email = 'vextriaai@gmail.com'
on conflict (user_id) do update set role = 'owner';


-- ---------------------------------------------------------------------------
-- 2. Organizations, credits, feature flags, announcements
-- ---------------------------------------------------------------------------
create table if not exists public.organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default '',
  plan       text not null default 'free' check (plan in ('free','pro','enterprise','trial')),
  status     text not null default 'active' check (status in ('active','suspended','cancelled')),
  seats      int  not null default 5,
  notes      text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.org_members (
  org_id     uuid not null references public.organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  org_role   text not null default 'member' check (org_role in ('owner','admin','member')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
alter table public.organizations enable row level security;
alter table public.org_members  enable row level security;

drop policy if exists "orgs visible to members and admins" on public.organizations;
create policy "orgs visible to members and admins" on public.organizations
  for select using (
    public.is_admin(auth.uid())
    or exists (select 1 from public.org_members m where m.org_id = organizations.id and m.user_id = auth.uid())
  );
drop policy if exists "admins manage orgs" on public.organizations;
create policy "admins manage orgs" on public.organizations
  for all using (public.admin_can_write(auth.uid())) with check (public.admin_can_write(auth.uid()));

drop policy if exists "members visible" on public.org_members;
create policy "members visible" on public.org_members
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));
drop policy if exists "admins manage members" on public.org_members;
create policy "admins manage members" on public.org_members
  for all using (public.admin_can_write(auth.uid())) with check (public.admin_can_write(auth.uid()));

-- per-user credit balance. Enforcement is OFF unless enforced = true, so turning
-- this on is a deliberate act and can never accidentally lock existing users out.
create table if not exists public.user_credits (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  org_id       uuid references public.organizations(id) on delete set null,
  plan         text not null default 'free',
  credits      numeric not null default 0,      -- remaining (USD-equivalent)
  granted      numeric not null default 0,      -- lifetime granted
  used         numeric not null default 0,      -- lifetime consumed
  enforced     boolean not null default false,  -- block AI when credits <= 0
  renews_at    timestamptz,
  updated_at   timestamptz not null default now()
);
alter table public.user_credits enable row level security;
drop policy if exists "see own credits" on public.user_credits;
create policy "see own credits" on public.user_credits
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));
drop policy if exists "admins manage credits" on public.user_credits;
create policy "admins manage credits" on public.user_credits
  for all using (public.admin_can_write(auth.uid()) or public.admin_role(auth.uid()) = 'support')
  with check (public.admin_can_write(auth.uid()) or public.admin_role(auth.uid()) = 'support');

create table if not exists public.credit_ledger (
  id         bigserial primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  delta      numeric not null,
  reason     text not null default '',
  actor_id   uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.credit_ledger enable row level security;
drop policy if exists "ledger visible" on public.credit_ledger;
create policy "ledger visible" on public.credit_ledger
  for select using (user_id = auth.uid() or public.is_admin(auth.uid()));
drop policy if exists "admins write ledger" on public.credit_ledger;
create policy "admins write ledger" on public.credit_ledger
  for insert with check (public.is_admin(auth.uid()));
create index if not exists credit_ledger_user_idx on public.credit_ledger (user_id, created_at desc);

create table if not exists public.feature_flags (
  key         text primary key,
  enabled     boolean not null default false,
  description text not null default '',
  rollout     int not null default 100,   -- 0-100 % of users
  updated_at  timestamptz not null default now()
);
alter table public.feature_flags enable row level security;
drop policy if exists "flags readable" on public.feature_flags;
create policy "flags readable" on public.feature_flags for select using (auth.uid() is not null);
drop policy if exists "admins manage flags" on public.feature_flags;
create policy "admins manage flags" on public.feature_flags
  for all using (public.admin_can_write(auth.uid())) with check (public.admin_can_write(auth.uid()));

create table if not exists public.announcements (
  id         uuid primary key default gen_random_uuid(),
  title      text not null default '',
  body       text not null default '',
  level      text not null default 'info' check (level in ('info','warn','critical')),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.announcements enable row level security;
drop policy if exists "announcements readable" on public.announcements;
create policy "announcements readable" on public.announcements for select using (auth.uid() is not null);
drop policy if exists "admins manage announcements" on public.announcements;
create policy "admins manage announcements" on public.announcements
  for all using (public.admin_can_write(auth.uid())) with check (public.admin_can_write(auth.uid()));


-- ---------------------------------------------------------------------------
-- 3. CROSS-TENANT ACCESS  <-- the sensitive part; read the header note
--    Adds an admin policy alongside each table's existing owner-only one.
--    Normal users are unaffected: they still only ever see their own rows.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['profiles','products','deals','calls','documents','reminders','usage_events'] loop
    execute format('drop policy if exists "admin full access" on public.%I', t);
    execute format(
      'create policy "admin full access" on public.%I for all '
      'using (public.is_admin(auth.uid())) with check (public.admin_can_write(auth.uid()))', t);
  end loop;
end $$;

-- Account list (auth.users is not exposed through the REST API). Admins only.
create or replace function public.admin_list_users()
returns table (id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz,
               confirmed boolean, banned boolean)
language plpgsql security definer set search_path = public, auth as $$
begin
  if not public.is_admin(auth.uid()) then raise exception 'not authorized'; end if;
  return query
    select u.id, u.email::text, u.created_at, u.last_sign_in_at,
           (u.email_confirmed_at is not null),
           (u.banned_until is not null and u.banned_until > now())
    from auth.users u order by u.created_at desc;
end $$;
revoke all on function public.admin_list_users() from public;
grant execute on function public.admin_list_users() to authenticated;

-- Promote an account to admin by email (owner only) — handy from the SQL editor too.
create or replace function public.admin_grant_by_email(target_email text, new_role text default 'admin')
returns text language plpgsql security definer set search_path = public, auth as $$
declare uid uuid;
begin
  if public.admin_role(auth.uid()) <> 'owner' then raise exception 'owner only'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(target_email));
  if uid is null then raise exception 'no account with that email'; end if;
  insert into public.admin_users (user_id, role) values (uid, new_role)
    on conflict (user_id) do update set role = excluded.role;
  return 'granted ' || new_role || ' to ' || target_email;
end $$;
revoke all on function public.admin_grant_by_email(text, text) from public;
grant execute on function public.admin_grant_by_email(text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 4. Telemetry (page views, clicks -> heatmap) and the full activity log
-- ---------------------------------------------------------------------------
create table if not exists public.telemetry_events (
  id bigserial primary key,
  user_id uuid references auth.users(id) on delete set null,
  session_id text not null default '',
  kind text not null default 'event',
  path text not null default '',
  element text not null default '',
  x real, y real, vw int, vh int,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.telemetry_events enable row level security;
drop policy if exists "insert own telemetry" on public.telemetry_events;
create policy "insert own telemetry" on public.telemetry_events
  for insert with check (auth.uid() = user_id);
drop policy if exists "read telemetry" on public.telemetry_events;
create policy "read telemetry" on public.telemetry_events
  for select using (auth.uid() = user_id or public.is_admin(auth.uid()));
drop policy if exists "admins purge telemetry" on public.telemetry_events;
create policy "admins purge telemetry" on public.telemetry_events
  for delete using (public.admin_can_write(auth.uid()));
create index if not exists telemetry_created_idx on public.telemetry_events (created_at desc);
create index if not exists telemetry_path_idx    on public.telemetry_events (path);
create index if not exists telemetry_user_idx    on public.telemetry_events (user_id);

-- EVERYTHING gets tracked here: auth, api calls, calls started/ended, admin actions,
-- errors, credit changes. Written server-side so a client can't forge entries.
create table if not exists public.activity_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  level      text not null default 'info' check (level in ('debug','info','warn','error')),
  category   text not null default 'app',   -- auth | api | call | admin | ai | billing | system | security
  action     text not null default '',
  user_id    uuid references auth.users(id) on delete set null,
  actor_id   uuid references auth.users(id) on delete set null,
  target     text not null default '',
  ip         text not null default '',
  detail     jsonb not null default '{}'::jsonb,
  ms         int
);
alter table public.activity_log enable row level security;
drop policy if exists "admins read activity" on public.activity_log;
create policy "admins read activity" on public.activity_log
  for select using (public.is_admin(auth.uid()));
drop policy if exists "authenticated append activity" on public.activity_log;
create policy "authenticated append activity" on public.activity_log
  for insert with check (auth.uid() is not null);
drop policy if exists "admins purge activity" on public.activity_log;
create policy "admins purge activity" on public.activity_log
  for delete using (public.admin_can_write(auth.uid()));
create index if not exists activity_at_idx       on public.activity_log (at desc);
create index if not exists activity_category_idx on public.activity_log (category, at desc);
create index if not exists activity_user_idx     on public.activity_log (user_id, at desc);
create index if not exists activity_level_idx    on public.activity_log (level, at desc);

-- append-only record of privileged actions (kept separate from the firehose)
create table if not exists public.admin_audit (
  id bigserial primary key,
  admin_id uuid references auth.users(id) on delete set null,
  action text not null default '',
  target text not null default '',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit enable row level security;
drop policy if exists "admins use audit" on public.admin_audit;
create policy "admins use audit" on public.admin_audit
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));
create index if not exists admin_audit_created_idx on public.admin_audit (created_at desc);

-- backup run history (files live on the server's disk under ./backups)
create table if not exists public.backup_runs (
  id         uuid primary key default gen_random_uuid(),
  file       text not null default '',
  bytes      bigint not null default 0,
  counts     jsonb not null default '{}'::jsonb,
  kind       text not null default 'daily' check (kind in ('daily','manual')),
  ok         boolean not null default true,
  error      text not null default '',
  created_at timestamptz not null default now()
);
alter table public.backup_runs enable row level security;
drop policy if exists "admins see backups" on public.backup_runs;
create policy "admins see backups" on public.backup_runs
  for all using (public.is_admin(auth.uid())) with check (public.is_admin(auth.uid()));


-- ---------------------------------------------------------------------------
-- 5. Read-only SQL console (admins only; rejects anything but a single SELECT)
-- ---------------------------------------------------------------------------
create or replace function public.admin_query_sql(q text)
returns json language plpgsql security definer set search_path = public as $$
declare result json; clean text;
begin
  if not public.is_admin(auth.uid()) then raise exception 'not authorized'; end if;
  clean := btrim(regexp_replace(q, ';\s*$', ''));
  if clean ~* ';' then raise exception 'only one statement allowed'; end if;
  if clean !~* '^\s*(select|with)\s' then raise exception 'read-only: SELECT or WITH only'; end if;
  execute format('select coalesce(json_agg(t), ''[]''::json) from (%s) t', clean) into result;
  return result;
end $$;
revoke all on function public.admin_query_sql(text) from public;
grant execute on function public.admin_query_sql(text) to authenticated;

-- Adjust a user's credits atomically and write the ledger entry in one shot.
create or replace function public.admin_adjust_credits(target uuid, delta numeric, why text default '')
returns numeric language plpgsql security definer set search_path = public as $$
declare newbal numeric;
begin
  if not public.is_admin(auth.uid()) then raise exception 'not authorized'; end if;
  if public.admin_role(auth.uid()) = 'viewer' then raise exception 'viewers cannot change credits'; end if;
  insert into public.user_credits (user_id, credits, granted)
    values (target, greatest(delta, 0), greatest(delta, 0))
  on conflict (user_id) do update
    set credits = public.user_credits.credits + delta,
        granted = public.user_credits.granted + greatest(delta, 0),
        updated_at = now()
  returning credits into newbal;
  insert into public.credit_ledger (user_id, delta, reason, actor_id)
    values (target, delta, coalesce(why, ''), auth.uid());
  return newbal;
end $$;
revoke all on function public.admin_adjust_credits(uuid, numeric, text) from public;
grant execute on function public.admin_adjust_credits(uuid, numeric, text) to authenticated;
