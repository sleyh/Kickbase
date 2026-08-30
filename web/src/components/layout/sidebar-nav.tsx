"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  TrendingUp,
  Table2,
  Users,
  Repeat,
  Radio,
  Bell,
  ShoppingCart,
  ShieldCheck,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/squad-value", label: "Squad Value", icon: TrendingUp },
  { href: "/dashboard/squad", label: "Squad", icon: Table2 },
  { href: "/dashboard/competitors", label: "Competitors", icon: Users },
  { href: "/dashboard/transfer-analysis", label: "Transfer Analysis", icon: Repeat },
  { href: "/dashboard/live", label: "Live Matchday", icon: Radio },
  { href: "/dashboard/alerts", label: "Market Alerts", icon: Bell },
  { href: "/dashboard/market", label: "Market", icon: ShoppingCart },
  { href: "/dashboard/settings", label: "Settings", icon: Settings },
] as const;

export function SidebarNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  const items = isAdmin
    ? [...NAV_ITEMS, { href: "/admin", label: "Admin", icon: ShieldCheck } as const]
    : NAV_ITEMS;

  return (
    <nav className="flex flex-col gap-1 p-3">
      {items.map((item) => {
        const active = pathname === item.href;
        return (
          <Link key={item.href} href={item.href} className="relative">
            {active && (
              <motion.div
                layoutId="sidebar-active"
                className="absolute inset-0 rounded-lg bg-primary/10"
                transition={{ type: "spring", stiffness: 400, damping: 32 }}
              />
            )}
            <span
              className={cn(
                "relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <item.icon className="size-4" />
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
