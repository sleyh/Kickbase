import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client - uses the public anon key only, so RLS is
 * the only thing standing between one user's session and another's data.
 * Never import the service-role key into anything that ships to the
 * client; that key lives exclusively in Edge Function env vars.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
