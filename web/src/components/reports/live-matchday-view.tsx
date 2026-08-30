"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Radio, Trophy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { LiveMatchdayReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LiveDot } from "@/components/ui/live-dot";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { toast } from "sonner";

const AUTO_POLL_MS = 30_000;

export function LiveMatchdayView() {
  const supabase = createClient();
  const [data, setData] = useState<LiveMatchdayReport | null>(null);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("live-matchday", { body: {} });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't load live data.");
      return;
    }
    setData(result);
  }

  useEffect(() => {
    // Fetch-on-mount is the correct use of an effect here (synchronizing
    // component state with the live-matchday endpoint); load() is shared
    // with the Refresh button deliberately rather than duplicated, and
    // deliberately not in the dependency array (identity changes every
    // render, which would refetch in a loop).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anyLive = data?.myMatches.some((m) => m.isLive) ?? false;

  useEffect(() => {
    // Only poll while there's something actually live to poll for -
    // otherwise this would keep hitting the endpoint after full time for
    // no reason. Same "not in deps" reasoning as the mount effect above:
    // load()'s identity changes every render.
    if (!anyLive) return;
    const interval = setInterval(load, AUTO_POLL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anyLive]);

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Radio className="size-5 text-amber-500" /> Live Matchday
          </h1>
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            {data?.day != null ? `Matchday ${data.day}` : "Real-time points, straight from the pitch"}
            {anyLive && <LiveDot />}
          </p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {data && data.day == null && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center text-muted-foreground">
            No matchday is currently underway.
          </CardContent>
        </Card>
      )}

      {data && data.standings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="size-4" /> Live standings
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <AnimatePresence initial={false}>
              {data.standings.map((s, i) => (
                <motion.div
                  key={s.name}
                  layout
                  transition={{ type: "spring", stiffness: 350, damping: 30 }}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 ${
                    s.isYou ? "border-primary/50 bg-primary/5" : ""
                  }`}
                >
                  <span className="flex items-center gap-2 font-medium">
                    <span className="w-5 text-sm text-muted-foreground">{i + 1}</span>
                    {s.name}
                    {s.isYou && (
                      <Badge variant="secondary" className="text-xs">
                        you
                      </Badge>
                    )}
                  </span>
                  <AnimatedNumber value={s.points} className="font-semibold" />
                </motion.div>
              ))}
            </AnimatePresence>
          </CardContent>
        </Card>
      )}

      {data?.myMatches.map((match) => (
        <Card
          key={match.matchLabel}
          className={match.isLive ? "shadow-[0_0_28px_var(--glow-live)] ring-1 ring-amber-500/30" : undefined}
        >
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              {match.isLive && <LiveDot />}
              {match.matchLabel}
              <span className="text-sm font-normal text-muted-foreground">min {match.minute}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {match.players
              .sort((a, b) => b.points - a.points)
              .map((p, i) => (
                <motion.div
                  key={p.name}
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className="flex items-center justify-between rounded-lg border px-3 py-2"
                >
                  <span>
                    {p.name} <span className="text-xs text-muted-foreground">({p.team})</span>
                  </span>
                  <AnimatedNumber value={p.points} className="font-semibold" />
                </motion.div>
              ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
