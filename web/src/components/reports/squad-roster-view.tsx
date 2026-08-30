"use client";

import { useMemo, useState } from "react";
import { ArrowUpDown, RefreshCw, Table2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact, signed } from "@/lib/format";
import type { SquadValueReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { PlayerCell } from "@/components/kickbase/stat-table";
import { toast } from "sonner";

type SortKey = "name" | "value" | "d1" | "d7" | "points" | "rating";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "name", label: "Player" },
  { key: "value", label: "Value", align: "right" },
  { key: "d1", label: "24h", align: "right" },
  { key: "d7", label: "7d", align: "right" },
  { key: "points", label: "Points", align: "right" },
  { key: "rating", label: "Rating", align: "right" },
];

function RatingBadge({ rating }: { rating: number }) {
  const tone =
    rating >= 70
      ? "bg-green-600 text-white"
      : rating >= 40
        ? "bg-amber-500 text-white"
        : "bg-destructive text-destructive-foreground";
  return <Badge className={tone}>{rating}</Badge>;
}

function deltaClass(n: number | null | undefined): string {
  if (n == null) return "text-muted-foreground";
  return n > 0 ? "text-green-600 dark:text-green-400" : n < 0 ? "text-destructive" : "text-muted-foreground";
}

export function SquadRosterView({
  initialData,
  generatedAt,
}: {
  initialData: SquadValueReport | null;
  generatedAt: string | null;
}) {
  const supabase = createClient();
  const [data, setData] = useState(initialData);
  const [lastGenerated, setLastGenerated] = useState(generatedAt);
  const [loading, setLoading] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; direction: "asc" | "desc" }>({
    key: "rating",
    direction: "desc",
  });

  async function refresh() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("run-report", {
      body: { report_type: "squad_value" },
    });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't refresh.");
      return;
    }
    setData(result);
    setLastGenerated(new Date().toISOString());
  }

  function toggleSort(key: SortKey) {
    setSort((prev) =>
      prev.key === key ? { key, direction: prev.direction === "asc" ? "desc" : "asc" } : { key, direction: "desc" }
    );
  }

  const rows = useMemo(() => {
    if (!data) return [];
    const list = [...data.players];
    const { key, direction } = sort;
    list.sort((a, b) => {
      const cmp =
        key === "name" ? a.name.localeCompare(b.name) : (a[key] ?? -Infinity) - (b[key] ?? -Infinity);
      return direction === "asc" ? cmp : -cmp;
    });
    return list;
  }, [data, sort]);

  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center gap-4 py-12 text-center">
          <p className="text-muted-foreground">No squad data yet.</p>
          <Button onClick={refresh} disabled={loading}>
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {loading ? "Loading..." : "Fetch squad"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className={`flex flex-col gap-6 transition-opacity ${loading ? "pointer-events-none opacity-60" : ""}`}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="flex items-center gap-2 font-heading text-2xl font-semibold tracking-tight">
            <Table2 className="size-5" /> Squad
          </h1>
          <p className="text-sm text-muted-foreground">
            Rating is relative to your own roster, weighted toward performance and upcoming fixture difficulty
            {lastGenerated && ` · Updated ${new Date(lastGenerated).toLocaleString()}`}
          </p>
        </div>
        <Button variant="outline" onClick={refresh} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
          Refresh
        </Button>
      </div>

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.name}>
                  <PlayerCell name={p.name} photo={p.photo} pos={p.pos} />
                  <TableCell className="text-right font-mono tabular-nums">{compact(p.value ?? 0)}</TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${deltaClass(p.d1)}`}>
                    {signed(p.d1)}
                  </TableCell>
                  <TableCell className={`text-right font-mono tabular-nums ${deltaClass(p.d7)}`}>
                    {p.d7 != null ? signed(p.d7) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums">{p.points ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    <RatingBadge rating={p.rating ?? 0} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
