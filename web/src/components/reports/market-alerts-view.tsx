"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { MarketSnapshot } from "@/lib/types";
import { compact } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlayerCard } from "@/components/kickbase/player-card";
import { PlayerActionsMenu } from "@/components/kickbase/player-actions-menu";
import { PlayerCell } from "@/components/kickbase/stat-table";
import { ViewToggle } from "@/components/ui/view-toggle";
import { useViewMode } from "@/lib/use-view-mode";
import { toast } from "sonner";

function TrendIcon({ rising, trend }: { rising: boolean; trend?: "up" | "down" | "flat" }) {
  const resolved = trend ?? (rising ? "up" : "flat");
  if (resolved === "up") return <TrendingUp className="size-3.5 text-green-600 dark:text-green-400" />;
  if (resolved === "down") return <TrendingDown className="size-3.5 text-destructive" />;
  return <Minus className="size-3.5 text-muted-foreground" />;
}

export function MarketAlertsView({
  initialData,
  generatedAt,
}: {
  initialData: MarketSnapshot | null;
  generatedAt: string | null;
}) {
  const supabase = createClient();
  const [data, setData] = useState(initialData);
  const [lastGenerated, setLastGenerated] = useState(generatedAt);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useViewMode("market-alerts");

  async function refresh() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("run-report", {
      body: { report_type: "market_alert" },
    });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't refresh.");
      return;
    }
    setData(result);
    setLastGenerated(new Date().toISOString());
  }

  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">No market snapshot yet.</p>
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Check the market"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold tracking-tight">{data.leagueName}</h1>
          <p className="text-sm text-muted-foreground">
            A live snapshot, not a diff since your last check
            {lastGenerated && ` · Updated ${new Date(lastGenerated).toLocaleString()}`}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      {data.ownBids.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="size-4" /> Your active bids
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.ownBids.map((p) => (
              <PlayerCard
                key={p.name}
                variant="compact"
                player={{ name: p.name, photo: p.photo, pos: p.pos, value: p.ownBidAmount }}
                href={p.id ? `/dashboard/player/${p.id}` : undefined}
                menu={
                  p.id && (
                    <PlayerActionsMenu
                      playerId={p.id}
                      playerName={p.name}
                      marketValue={p.marketValue}
                      variant="market"
                      onActionComplete={refresh}
                    />
                  )
                }
              />
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle>Notable listings</CardTitle>
          <ViewToggle mode={viewMode} onChange={setViewMode} />
        </CardHeader>
        <CardContent>
          {data.notable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing rising or scoring right now.</p>
          ) : viewMode === "cards" ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {data.notable.map((p, i) => (
                <motion.div key={p.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
                  <PlayerCard
                    player={{ name: p.name, photo: p.photo, pos: p.pos, value: p.price }}
                    href={p.id ? `/dashboard/player/${p.id}` : undefined}
                    caption={`${p.avgPoints} avg pts`}
                    owner={p.owner}
                    badge={
                      <div className="flex items-center gap-1">
                        {p.rising && <TrendingUp className="size-3.5 text-green-600 dark:text-green-400" />}
                        {p.hasOwnBid && (
                          <Badge variant="secondary" className="text-[10px]">
                            you bid
                          </Badge>
                        )}
                      </div>
                    }
                    menu={
                      p.id && (
                        <PlayerActionsMenu
                          playerId={p.id}
                          playerName={p.name}
                          marketValue={p.marketValue}
                          variant="market"
                          isScouted={false}
                          onActionComplete={refresh}
                        />
                      )
                    }
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Player</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead className="text-right">Avg pts</TableHead>
                  <TableHead className="text-right">Trend</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.notable.map((p) => (
                  <TableRow key={p.name}>
                    <PlayerCell name={p.name} photo={p.photo} pos={p.pos} href={p.id ? `/dashboard/player/${p.id}` : undefined} />
                    <TableCell className="text-right font-mono tabular-nums">{compact(p.price)}</TableCell>
                    <TableCell className="text-right font-mono tabular-nums">{p.avgPoints}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <TrendIcon rising={p.rising} trend={p.trend} />
                        {p.hasOwnBid && (
                          <Badge variant="secondary" className="text-[10px]">
                            you bid
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.id && (
                        <PlayerActionsMenu
                          playerId={p.id}
                          playerName={p.name}
                          marketValue={p.marketValue}
                          variant="market"
                          isScouted={false}
                          onActionComplete={refresh}
                        />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
