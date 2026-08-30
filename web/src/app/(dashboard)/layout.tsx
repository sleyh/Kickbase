import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SidebarNav } from "@/components/layout/sidebar-nav";
import { Topbar } from "@/components/layout/topbar";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Belt and suspenders: middleware already redirects unauthenticated
  // requests, but a Server Component should never assume that ran.
  if (!user) {
    redirect("/login");
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-60 shrink-0 border-r bg-muted/20 md:block">
        <div className="flex h-14 items-center border-b px-4 text-sm font-semibold">
          Menu
        </div>
        <SidebarNav isAdmin={profile?.is_admin ?? false} />
      </aside>
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar email={user.email ?? ""} />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
