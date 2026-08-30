import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Server Component / Route Handler Supabase client. Reads/writes the auth
 * cookies via next/headers so the session survives across requests. Like
 * the browser client, this only ever holds the anon key - RLS enforces
 * per-user isolation, not this file.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component that can't set cookies (no
            // response object available) - the middleware below is what
            // actually refreshes the session in that case, so this is
            // safe to swallow.
          }
        },
      },
    }
  );
}
