import { createClient } from "@/lib/supabase/server";
import { TransferAnalysisView } from "@/components/reports/transfer-analysis-view";
import type { TransferAnalysisReport } from "@/lib/types";

export default async function TransferAnalysisPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cached } = await supabase
    .from("reports_cache")
    .select("payload, generated_at")
    .eq("user_id", user!.id)
    .eq("report_type", "transfer_analysis")
    .maybeSingle();

  return (
    <TransferAnalysisView
      initialData={(cached?.payload as TransferAnalysisReport) ?? null}
      generatedAt={cached?.generated_at ?? null}
    />
  );
}
