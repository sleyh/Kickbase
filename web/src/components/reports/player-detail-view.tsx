"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ArrowLeft, TrendingUp, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact } from "@/lib/format";
import type { PlayerDetailReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlayerAvatar } from "@/components/kickbase/player-avatar";
import { TeamBadge } from "@/components/kickbase/team-badge";
import { ValueTrendChart } from "@/components/reports/value-trend-chart";
import { AnimatedNumber } from "@/components/motion/animated-number";
import { positionLabel } from "@/lib/positions";
import { fixtureDifficultyLabel } from "@/lib/fixture-difficulty";
import { toast } from "sonner";

export function PlayerDetailView({ id }: { id: string }) {
  const supabase = createClient();
  const [data, setData] = useState<PlayerDetailReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("player-detail", { body: { id } });
    setLoading(false);
    if (error || result?.error) {
      setNotFound(true);
      toast.error(result?.error ?? error?.message ?? "Couldn't load this player.");
      return;
    }
    setData(result);
  }

  useEffect(() => {
    // Fetch-on-mount, same reasoning/justification as live-matchday-view.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground">
        <RefreshCw className="mr-2 size-4 animate-spin" /> Loading player...
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center text-muted-foreground">
          Couldn&apos;t load this player.
          <Link href="/dashboard/squad">
            <Button variant="outline" size="sm">
              <ArrowLeft className="size-3.5" /> Back to Squad
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  const trendData = data.history.map((h) => ({ day: h.day, totalValue: h.value }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/squad" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <PlayerAvatar name={data.name} photo={data.photo} pos={data.pos} size="lg" />
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.name}</h1>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{positionLabel(data.pos)}</Badge>
            {data.team && <TeamBadge teamId={data.team.id} teamName={data.team.name} size="sm" />}
            {data.team && <span>{data.team.name}</span>}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Market value</p>
            <AnimatedNumber value={data.value ?? 0} format="compact" className="text-lg font-semibold" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-xs text-muted-foreground">Season points</p>
            <p className="font-mono text-lg font-semibold tabular-nums">{data.points ?? "—"}</p>
          </CardContent>
        </Card>
        {data.ownership && (
          <>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">Bought for</p>
                <p className="font-mono text-lg font-semibold tabular-nums">{compact(data.ownership.boughtPrice)}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4">
                <p className="text-xs text-muted-foreground">Bought on</p>
                <p className="text-lg font-semibold">{new Date(data.ownership.boughtDate).toLocaleDateString()}</p>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      {data.history.length >= 2 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="size-4" /> Value history ({data.history.length} days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ValueTrendChart data={trendData} className="h-56 w-full" />
          </CardContent>
        </Card>
      )}

      {data.upcomingFixtures.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="size-4" /> Upcoming fixtures
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.upcomingFixtures.map((f) => {
              const difficulty = fixtureDifficultyLabel(f.opponentStrength);
              return (
                <div key={`${f.opponentId}-${f.date}`} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <TeamBadge teamId={f.opponentId} teamName={f.opponentName} size="sm" />
                    <span className="font-medium">{f.opponentName}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm text-muted-foreground">{new Date(f.date).toLocaleDateString()}</span>
                    <Badge className={difficulty.tone}>{difficulty.label}</Badge>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
