import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Defense in depth on top of RLS (the real boundary - every admin query
 * this section runs is only visible to an admin's JWT thanks to the
 * "admin selects/manages all" policies in 0001_init.sql). A non-admin
 * who lands here gets bounced back to their own dashboard rather than
 * seeing a broken or empty admin shell.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase.from("profiles").select("is_admin").eq("id", user.id).single();
  if (!profile?.is_admin) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
