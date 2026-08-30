"use client";

import { useEffect, useState } from "react";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const OPTIONS = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // next-themes only knows the real theme after mount (it reads
  // localStorage/media query client-side) - rendering a fixed icon
  // before that would flash the wrong one on a dark-mode visitor.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Deliberate mount-flag effect (not "syncing state with an external
    // system" in the usual sense) - the whole point is to defer reading
    // the resolved theme until after hydration, avoiding a flash of the
    // wrong icon for a dark-mode visitor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);
  }, []);

  const current = OPTIONS.find((o) => o.value === theme) ?? OPTIONS[2];
  const Icon = mounted ? current.icon : Monitor;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon" title="Change theme">
            <Icon className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        {OPTIONS.map((o) => (
          <DropdownMenuItem key={o.value} onClick={() => setTheme(o.value)}>
            <o.icon className="size-4" />
            {o.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
