"use client";

import { useRouter } from "next/navigation";
import { LogOut, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { MobileNav } from "@/components/layout/mobile-nav";

export function Topbar({ email, isAdmin }: { email: string; isAdmin: boolean }) {
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
      <div className="flex items-center gap-2">
        <MobileNav isAdmin={isAdmin} />
        <span className="text-sm font-semibold tracking-tight">Kickbase Assistant</span>
      </div>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          className="hidden text-sm text-muted-foreground sm:flex"
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
        >
          <Search className="size-4" />
          Search
          <kbd className="ml-2 rounded border bg-muted px-1.5 py-0.5 font-mono text-[10px]">⌘K</kbd>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="sm:hidden"
          onClick={() => window.dispatchEvent(new CustomEvent("open-command-palette"))}
        >
          <Search className="size-4" />
        </Button>
        <ThemeToggle />
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initial}</AvatarFallback>
        </Avatar>
        <span className="hidden text-sm text-muted-foreground lg:inline">{email}</span>
        <Button variant="ghost" size="icon" onClick={handleLogout} title="Sign out">
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
