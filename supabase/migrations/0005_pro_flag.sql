-- Kickbase Assistant - invite-only "pro" flag.
--
-- No public signup/payment flow - granted by hand (admin/service role)
-- for now. Same self-protection as is_admin: a user can read their own
-- flag but can't flip it themselves, so "update own" is re-created with
-- is_pro pinned alongside is_admin.
alter table public.profiles add column is_pro boolean not null default false;

drop policy "profiles: update own (not is_admin)" on public.profiles;

create policy "profiles: update own (not is_admin, not is_pro)" on public.profiles
  for update using (id = auth.uid())
  with check (
    id = auth.uid()
    and is_admin = (select p.is_admin from public.profiles p where p.id = auth.uid())
    and is_pro = (select p.is_pro from public.profiles p where p.id = auth.uid())
  );
