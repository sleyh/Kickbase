-- Kickbase Assistant - scout list.
--
-- App-local watchlist: there's no Kickbase API equivalent (confirmed by
-- grepping kickbase-client.ts), so this is new state, not a synced
-- mirror of anything Kickbase holds. Nothing secret here, so - like
-- scheduled_jobs - the owning user manages their own rows directly.
create table public.scouted_players (
  user_id uuid not null references public.profiles (id) on delete cascade,
  player_id text not null,
  added_at timestamptz not null default now(),
  primary key (user_id, player_id)
);

alter table public.scouted_players enable row level security;

create policy "scouted_players: manage own" on public.scouted_players
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "scouted_players: admin selects all" on public.scouted_players
  for select using (public.is_admin());
