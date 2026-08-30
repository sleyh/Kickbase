"use client";

import { useState } from "react";
import { Gift, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { compact } from "@/lib/format";
import type { BonusReport } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

export function BonusCard({ initialData }: { initialData: BonusReport | null }) {
  const supabase = createClient();
  const [data, setData] = useState(initialData);
  const [loading, setLoading] = useState(false);

  async function collect() {
    setLoading(true);
    const { data: result, error } = await supabase.functions.invoke("run-report", {
      body: { report_type: "collect_bonus" },
    });
    setLoading(false);
    if (error || result?.error) {
      toast.error(result?.error ?? error?.message ?? "Couldn't collect the bonus.");
      return;
    }
    setData(result);
    if (result.collected) {
      toast.success(`Collected ${compact(result.amount)}!`);
    } else {
      toast.info("Nothing to collect right now.");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Gift className="size-4" /> Daily bonus
        </CardTitle>
        <CardDescription>
          {data?.collected
            ? `Last collected: ${compact(data.amount ?? 0)} (day ${data.streakDay} streak)`
            : "Collect today's login bonus."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button onClick={collect} disabled={loading} size="sm">
          {loading && <Loader2 className="animate-spin" />}
          Collect now
        </Button>
      </CardContent>
    </Card>
  );
}
