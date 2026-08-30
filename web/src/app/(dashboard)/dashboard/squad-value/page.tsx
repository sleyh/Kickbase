import { createClient } from "@/lib/supabase/server";
import { SquadValueView } from "@/components/reports/squad-value-view";
import type { SquadValueReport } from "@/lib/types";

export default async function SquadValuePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: cached } = await supabase
    .from("reports_cache")
    .select("payload, generated_at")
    .eq("user_id", user!.id)
    .eq("report_type", "squad_value")
    .maybeSingle();

  return (
    <SquadValueView
      initialData={(cached?.payload as SquadValueReport) ?? null}
      generatedAt={cached?.generated_at ?? null}
    />
  );
}
