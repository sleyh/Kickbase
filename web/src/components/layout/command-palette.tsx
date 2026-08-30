"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LayoutDashboard,
  TrendingUp,
  Repeat,
  Radio,
  Bell,
  ShieldCheck,
  LogOut,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { useTheme } from "next-themes";
import { createClient } from "@/lib/supabase/client";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";

const REPORT_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/squad-value", label: "Squad Value", icon: TrendingUp },
  { href: "/dashboard/transfer-analysis", label: "Transfer Analysis", icon: Repeat },
  { href: "/dashboard/live", label: "Live Matchday", icon: Radio },
  { href: "/dashboard/alerts", label: "Market Alerts", icon: Bell },
] as const;

export function CommandPalette({ isAdmin }: { isAdmin: boolean }) {
  const router = useRouter();
  const supabase = createClient();
  const { setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
    }
    // Topbar's visible trigger button has no direct handle on this
    // component's state, so it opens the palette via this event instead
    // of lifting state up through a context just for one button.
    function onOpenRequest() {
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("open-command-palette", onOpenRequest);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("open-command-palette", onOpenRequest);
    };
  }, []);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  async function signOut() {
    setOpen(false);
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a report, switch theme, or sign out..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Reports">
          {REPORT_ITEMS.map((item) => (
            <CommandItem key={item.href} onSelect={() => go(item.href)}>
              <item.icon />
              {item.label}
            </CommandItem>
          ))}
          {isAdmin && (
            <CommandItem onSelect={() => go("/admin")}>
              <ShieldCheck />
              Admin
            </CommandItem>
          )}
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={() => setTheme("light")}>
            <Sun /> Light
          </CommandItem>
          <CommandItem onSelect={() => setTheme("dark")}>
            <Moon /> Dark
          </CommandItem>
          <CommandItem onSelect={() => setTheme("system")}>
            <Monitor /> System
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem onSelect={signOut}>
            <LogOut />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
