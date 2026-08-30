"use client";

import { useState } from "react";
import { RefreshCw, TrendingUp, Send } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact } from "@/lib/format";
import type { MarketSnapshot } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

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
          <h1 className="text-2xl font-semibold tracking-tight">{data.leagueName}</h1>
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
              <div key={p.name} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <span className="font-medium">{p.name}</span>
                <span>{compact(p.ownBidAmount ?? 0)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Notable listings</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {data.notable.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing rising or scoring right now.</p>
          ) : (
            data.notable.map((p) => (
              <div key={p.name} className="flex items-center justify-between rounded-lg border px-3 py-2">
                <div className="flex items-center gap-2">
                  {p.rising && <TrendingUp className="size-3.5 text-green-600 dark:text-green-400" />}
                  <span className="font-medium">{p.name}</span>
                  {p.hasOwnBid && (
                    <Badge variant="secondary" className="text-xs">
                      you bid
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-muted-foreground">
                  <span>{p.avgPoints} avg pts</span>
                  <span className="font-medium text-foreground">{compact(p.price)}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
