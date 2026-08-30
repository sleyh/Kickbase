import { createClient } from "@/lib/supabase/server";

/** Server-side only - checks the current user's profiles.is_pro flag, granted by hand (no public signup/payment flow yet). */
export async function getIsPro(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  const { data: profile } = await supabase.from("profiles").select("is_pro").eq("id", user.id).single();
  return profile?.is_pro ?? false;
}
