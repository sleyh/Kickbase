"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, ArrowLeft, History, Calendar } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { TeamDetailReport, TeamFixture } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TeamBadge } from "@/components/kickbase/team-badge";
import { fixtureDifficultyLabel } from "@/lib/fixture-difficulty";
import { toast } from "sonner";

function resultTone(f: TeamFixture): string {
  if (f.ownGoals == null || f.opponentGoals == null) return "text-muted-foreground";
  if (f.ownGoals > f.opponentGoals) return "text-green-600 dark:text-green-400";
  if (f.ownGoals < f.opponentGoals) return "text-destructive";
  return "text-muted-foreground";
}

export function TeamDetailView({ id }: { id: string }) {
  const supabase = createClient();
  const [data, setData] = useState<TeamDetailReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  async function load() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("team-detail", { body: { id } });
    setLoading(false);
    if (error || result?.error) {
      setNotFound(true);
      toast.error(result?.error ?? error?.message ?? "Couldn't load this team.");
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
        <RefreshCw className="mr-2 size-4 animate-spin" /> Loading team...
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center text-muted-foreground">
          Couldn&apos;t load this team.
          <Link href="/dashboard/live">
            <Button variant="outline" size="sm">
              <ArrowLeft className="size-3.5" /> Back to Live Matchday
            </Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <Link href="/dashboard/live" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-3.5" /> Back
        </Link>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="flex items-center gap-4">
        <TeamBadge teamId={data.id} teamName={data.name} className="size-14 rounded-xl text-base" />
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.name}</h1>
          {data.rank != null && <p className="text-sm text-muted-foreground">Rank #{data.rank} in the Bundesliga</p>}
        </div>
      </div>

      <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
        No full-squad listing here - there&apos;s no confirmed &quot;all players for a team&quot; endpoint to draw one
        from reliably, so this stays focused on standing and fixtures.
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {data.recentMatches.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="size-4" /> Recent results
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.recentMatches.map((f) => (
                <div key={f.matchId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <div className="flex items-center gap-2">
                    <TeamBadge teamId={f.opponentId} teamName={f.opponentName} size="sm" />
                    <span className="text-sm">
                      {f.home ? "vs" : "@"} {f.opponentName}
                    </span>
                  </div>
                  <span className={`font-mono text-sm font-semibold tabular-nums ${resultTone(f)}`}>
                    {f.ownGoals}-{f.opponentGoals}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {data.upcomingMatches.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="size-4" /> Upcoming fixtures
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.upcomingMatches.map((f) => {
                const difficulty = fixtureDifficultyLabel(f.opponentStrength);
                return (
                  <div key={f.matchId} className="flex items-center justify-between rounded-lg border px-3 py-2">
                    <div className="flex items-center gap-2">
                      <TeamBadge teamId={f.opponentId} teamName={f.opponentName} size="sm" />
                      <span className="text-sm">
                        {f.home ? "vs" : "@"} {f.opponentName}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">{new Date(f.date).toLocaleDateString()}</span>
                      <Badge className={difficulty.tone}>{difficulty.label}</Badge>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
