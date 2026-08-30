-- Kickbase Assistant - initial schema.
--
-- Every table is user-scoped and RLS-protected. Two access paths exist:
--   1. The authenticated client (anon key + user JWT) - can only ever see
--      its own rows, enforced by "user_id = auth.uid()" policies below.
--   2. Edge Functions using the service role key - bypass RLS entirely,
--      which is the ONLY path allowed to touch anything Kickbase-secret
--      (the vault-stored password) or to read/write across users (the
--      admin surface). The client never gets a service-role key.
--
-- is_admin() is defined before it's used in policies further down.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: select own" on public.profiles
  for select using (id = auth.uid());

create policy "profiles: update own (not is_admin)" on public.profiles
  for update using (id = auth.uid())
  with check (id = auth.uid() and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid()));

-- Auto-create a profile row on signup, mirroring auth.users.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'display_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Used by every cross-user policy below. security definer so it can read
-- profiles regardless of the caller's own RLS visibility into that table.
create function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select p.is_admin from public.profiles p where p.id = auth.uid()), false);
$$;

create policy "profiles: admin selects all" on public.profiles
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- kickbase_accounts
--
-- The Kickbase password itself is NEVER stored in this table - only a
-- reference (vault_secret_id) into Supabase Vault (vault.secrets). Only
-- Edge Functions running with the service role key can create/read that
-- secret (see supabase/functions/_shared/vault.ts). Direct client
-- INSERT/UPDATE is intentionally not granted here - linking an account
-- goes through the test-kickbase-login function, which verifies the
-- credentials actually work before ever writing this row.
-- ---------------------------------------------------------------------
create table public.kickbase_accounts (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  kickbase_email text not null,
  vault_secret_id uuid not null,
  league_id text,
  cached_kb_user_id text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.kickbase_accounts enable row level security;

create policy "kickbase_accounts: select own" on public.kickbase_accounts
  for select using (user_id = auth.uid());

create policy "kickbase_accounts: admin selects all" on public.kickbase_accounts
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- telegram_links
--
-- link_token is a one-time value shown to the user as a /start deep
-- link; telegram-webhook resolves it back to user_id and fills in
-- chat_id + linked_at. Direct client writes aren't granted for the same
-- reason as kickbase_accounts - only the webhook (service role) confirms
-- a real link happened.
-- ---------------------------------------------------------------------
create table public.telegram_links (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  chat_id text,
  link_token text not null unique default encode(gen_random_bytes(16), 'hex'),
  linked_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.telegram_links enable row level security;

create policy "telegram_links: select own" on public.telegram_links
  for select using (user_id = auth.uid());

create policy "telegram_links: admin selects all" on public.telegram_links
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- scheduled_jobs
--
-- Unlike the two tables above, this one holds nothing secret - just a
-- cadence + on/off switch - so the owning user is allowed to manage
-- their own rows directly, no Edge Function required.
-- ---------------------------------------------------------------------
create type public.job_type as enum (
  'squad_value', 'transfer_analysis', 'collect_bonus', 'market_alert', 'teamcenter_live'
);

create table public.scheduled_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_type public.job_type not null,
  cron_expression text not null,
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  created_at timestamptz not null default now(),
  unique (user_id, job_type)
);

alter table public.scheduled_jobs enable row level security;

create policy "scheduled_jobs: select own" on public.scheduled_jobs
  for select using (user_id = auth.uid());

create policy "scheduled_jobs: manage own" on public.scheduled_jobs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "scheduled_jobs: admin selects all" on public.scheduled_jobs
  for select using (public.is_admin());

create policy "scheduled_jobs: admin manages all" on public.scheduled_jobs
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- job_runs
--
-- Append-only history, written exclusively by Edge Functions (service
-- role) - a run's own status/output shouldn't be client-editable.
-- ---------------------------------------------------------------------
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  job_type public.job_type not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'failed')),
  output_summary text,
  error_detail text
);

alter table public.job_runs enable row level security;

create index job_runs_user_id_started_at_idx on public.job_runs (user_id, started_at desc);

create policy "job_runs: select own" on public.job_runs
  for select using (user_id = auth.uid());

create policy "job_runs: admin selects all" on public.job_runs
  for select using (public.is_admin());

-- ---------------------------------------------------------------------
-- reports_cache
--
-- One row per (user, report_type) - upserted by run-report each time it
-- executes, so the dashboard can render instantly from the last known
-- result instead of always waiting on a live Kickbase round trip.
-- ---------------------------------------------------------------------
create table public.reports_cache (
  user_id uuid not null references public.profiles (id) on delete cascade,
  report_type public.job_type not null,
  payload jsonb not null,
  generated_at timestamptz not null default now(),
  primary key (user_id, report_type)
);

alter table public.reports_cache enable row level security;

create policy "reports_cache: select own" on public.reports_cache
  for select using (user_id = auth.uid());

create policy "reports_cache: admin selects all" on public.reports_cache
  for select using (public.is_admin());
