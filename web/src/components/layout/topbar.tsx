"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Topbar({ email }: { email: string }) {
  const router = useRouter();
  const supabase = createClient();

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const initial = email.charAt(0).toUpperCase();

  return (
    <header className="flex h-14 items-center justify-between border-b px-4">
      <span className="text-sm font-semibold tracking-tight">Kickbase Assistant</span>
      <div className="flex items-center gap-3">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
        <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
