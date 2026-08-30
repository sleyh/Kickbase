-- Vault wrappers + telegram_links self-insert.
--
-- Vault's own functions live in the `vault` schema, which PostgREST never
-- exposes directly - there's no way to call vault.create_secret straight
-- from an Edge Function's supabase-js client. These two security-definer
-- wrappers in `public` are the only door in, and both are locked down to
-- service_role only (revoked from anon/authenticated) so a client can
-- never read or mint a Kickbase password secret directly - only an Edge
-- Function running with the service role key can.

create extension if not exists supabase_vault;

create function public.store_kickbase_secret(p_secret text, p_name text)
returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_id uuid;
begin
  select id into v_id from vault.secrets where name = p_name;
  if v_id is not null then
    perform vault.update_secret(v_id, p_secret);
    return v_id;
  end if;
  return vault.create_secret(p_secret, p_name);
end;
$$;

revoke all on function public.store_kickbase_secret(text, text) from public, anon, authenticated;
grant execute on function public.store_kickbase_secret(text, text) to service_role;

create function public.read_kickbase_secret(p_secret_id uuid)
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_secret_id;
$$;

revoke all on function public.read_kickbase_secret(uuid) from public, anon, authenticated;
grant execute on function public.read_kickbase_secret(uuid) to service_role;

-- telegram_links: creating the row that carries a fresh link_token isn't
-- sensitive (it's a one-time, single-use token, not a credential), so the
-- owning user is allowed to create their own row directly - only
-- confirming it (chat_id + linked_at, proof of a real Telegram /start)
-- stays Edge-Function-only, per the "select own" policy already in
-- 0001_init.sql with no matching client UPDATE policy.
create policy "telegram_links: insert own" on public.telegram_links
  for insert with check (user_id = auth.uid());
