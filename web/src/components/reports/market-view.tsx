"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowUpDown, RefreshCw, ShoppingCart, TrendingUp, TrendingDown, Minus, Send, Star } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact, signed } from "@/lib/format";
import type { FullMarketReport, MarketListingSummary, PlayerDetailReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlayerCell } from "@/components/kickbase/stat-table";
import { PlayerCard } from "@/components/kickbase/player-card";
import { PlayerActionsMenu } from "@/components/kickbase/player-actions-menu";
import { toast } from "sonner";

type Tab = "all" | "bids" | "scouted";
type SortKey = "name" | "price" | "marketValue" | "d1" | "d7" | "avgPoints" | "expiresInSeconds";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Player" },
  { key: "price", label: "Price", align: "right" },
  { key: "marketValue", label: "Value", align: "right" },
  { key: "d1", label: "24h", align: "right" },
  { key: "d7", label: "7d", align: "right" },
  { key: "avgPoints", label: "Avg pts", align: "right" },
  { key: "expiresInSeconds", label: "Closes in", align: "right" },
];

function deltaClass(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-green-600 dark:text-green-400" : n < 0 ? "text-destructive" : "text-muted-foreground";
}

function TrendIcon({ trend }: { trend?: "up" | "down" | "flat" }) {
  if (trend === "up") return <TrendingUp className="size-3.5 text-green-600 dark:text-green-400" />;
  if (trend === "down") return <TrendingDown className="size-3.5 text-destructive" />;
  return <Minus className="size-3.5 text-muted-foreground" />;
}

function closesIn(seconds: number | null | undefined): string {
  if (seconds == null || seconds <= 0) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function MarketView() {
  const supabase = createClient();
  const [data, setData] = useState<FullMarketReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "expiresInSeconds",
    direction: "asc",
  });
  const [scoutedIds, setScoutedIds] = useState<Set<string>>(new Set());
  const [scoutedPlayers, setScoutedPlayers] = useState<PlayerDetailReport[] | null>(null);
  const [scoutedLoading, setScoutedLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [{ data: marketResult, error: marketError }, { data: scoutResult }] = await Promise.all([
      supabase.functions.invoke("market-full", { body: {} }),
      supabase.functions.invoke("scout-list", { body: { action: "list" } }),
    ]);
    setLoading(false);
    if (marketError || marketResult?.error) {
      toast.error(marketResult?.error ?? marketError?.message ?? "Couldn't load the market.");
      return;
    }
    setData(marketResult);
    if (scoutResult?.players) {
      setScoutedIds(new Set(scoutResult.players.map((p: PlayerDetailReport) => p.id)));
    }
  }

  async function loadScouted() {
    setScoutedLoading(true);
    const { data: result, error } = await supabase.functions.invoke("scout-list", { body: { action: "list" } });
    setScoutedLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't load your scout list.");
      return;
    }
    setScoutedPlayers(result.players ?? []);
    setScoutedIds(new Set((result.players ?? []).map((p: PlayerDetailReport) => p.id)));
  }

  useEffect(() => {
    // Fetch-on-mount, same reasoning/justification as live-matchday-view.tsx.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "asc" }
    );
  }

  function handleScoutChange(playerId: string, scouted: boolean) {
    setScoutedIds((prev) => {
      const next = new Set(prev);
      if (scouted) next.add(playerId);
      else next.delete(playerId);
      return next;
    });
    if (!scouted) {
      setScoutedPlayers((prev) => prev?.filter((p) => p.id !== playerId) ?? prev);
    }
  }

  const rows = useMemo(() => {
    const source = tab === "bids" ? (data?.ownBids ?? []) : (data?.listings ?? []);
    const list = [...source];
    const { key, direction } = sort;
    list.sort((a, b) => {
      const cmp = key === "name" ? a.name.localeCompare(b.name) : (a[key] ?? -Infinity) - (b[key] ?? -Infinity);
      return direction === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, tab, sort]);

  function renderRow(p: MarketListingSummary) {
    return (
      <TableRow key={p.id ?? p.name}>
        <PlayerCell name={p.name} photo={p.photo} pos={p.pos} subtitle={p.teamName} href={p.id ? `/dashboard/player/${p.id}` : undefined} />
        <TableCell className="text-right font-mono tabular-nums">{compact(p.price)}</TableCell>
        <TableCell className="text-right font-mono tabular-nums">{compact(p.marketValue)}</TableCell>
        <TableCell className={`text-right font-mono tabular-nums ${deltaClass(p.d1)}`}>
          {p.d1 != null ? signed(p.d1) : "—"}
        </TableCell>
        <TableCell className={`text-right font-mono tabular-nums ${deltaClass(p.d7)}`}>
          {p.d7 != null ? signed(p.d7) : "—"}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums">{p.avgPoints}</TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1.5">
            <TrendIcon trend={p.trend} />
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{closesIn(p.expiresInSeconds)}</span>
          </div>
        </TableCell>
        <TableCell className="text-right">
          <div className="flex items-center justify-end gap-1.5">
            {p.hasOwnBid && (
              <Badge variant="secondary" className="text-[10px]">
                <Send className="size-3" /> {p.ownBidAmount != null ? compact(p.ownBidAmount) : "bid"}
              </Badge>
            )}
            {p.id && (
              <PlayerActionsMenu
                playerId={p.id}
                playerName={p.name}
                marketValue={p.marketValue}
                variant="market"
                isScouted={scoutedIds.has(p.id)}
                onScoutChange={(scouted) => handleScoutChange(p.id!, scouted)}
                onActionComplete={load}
              />
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
            <ShoppingCart className="size-5" /> Market
          </h1>
          <p className="text-sm text-muted-foreground">{data?.leagueName ?? "Every live listing, not just the notable ones"}</p>
        </div>
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

      <div className="flex gap-1 rounded-lg border p-1 w-fit">
        {(
          [
            { key: "all", label: "All listings" },
            { key: "bids", label: "Your bids" },
            { key: "scouted", label: "Scouted" },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTab(t.key);
              if (t.key === "scouted" && scoutedPlayers == null) loadScouted();
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === t.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab !== "scouted" ? (
        !data ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
              <p className="text-muted-foreground">No market data yet.</p>
              <Button onClick={load} disabled={loading}>
                <RefreshCw className={loading ? "animate-spin" : ""} />
                {loading ? "Loading..." : "Check the market"}
              </Button>
            </CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-12 text-center text-muted-foreground">
              {tab === "bids" ? "You don't have any active bids." : "Nothing on the market right now."}
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((col) => (
                      <TableHead key={col.key} className={col.align === "right" ? "text-right" : undefined}>
                        <button
                          onClick={() => toggleSort(col.key)}
                          className={`inline-flex items-center gap-1 hover:text-foreground ${
                            sort.key === col.key ? "text-foreground" : ""
                          }`}
                        >
                          {col.label}
                          <ArrowUpDown className="size-3" />
                        </button>
                      </TableHead>
                    ))}
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>{rows.map(renderRow)}</TableBody>
              </Table>
            </CardContent>
          </Card>
        )
      ) : scoutedLoading && scoutedPlayers == null ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <RefreshCw className="mr-2 size-4 animate-spin" /> Loading your scout list...
        </div>
      ) : !scoutedPlayers || scoutedPlayers.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-2 py-12 text-center text-muted-foreground">
            <Star className="size-5" />
            Nothing scouted yet - use a player&apos;s action menu to add one.
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {scoutedPlayers.map((p) => (
            <PlayerCard
              key={p.id}
              player={{ name: p.name, photo: p.photo, pos: p.pos, value: p.value, points: p.points }}
              href={`/dashboard/player/${p.id}`}
              menu={
                <PlayerActionsMenu
                  playerId={p.id}
                  playerName={p.name}
                  marketValue={p.value}
                  variant="market"
                  isScouted
                  onScoutChange={(scouted) => handleScoutChange(p.id, scouted)}
                />
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}
