import { createClient } from "@/lib/supabase/server";
import { MarketAlertsView } from "@/components/reports/market-alerts-view";
import type { MarketSnapshot } from "@/lib/types";

export default async function MarketAlertsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cached } = await supabase
    .from("reports_cache")
    .select("payload, generated_at")
    .eq("user_id", user!.id)
    .eq("report_type", "market_alert")
    .maybeSingle();

  return (
    <MarketAlertsView
      initialData={(cached?.payload as MarketSnapshot) ?? null}
      generatedAt={cached?.generated_at ?? null}
    />
  );
}
