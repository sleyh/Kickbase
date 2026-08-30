import { createClient } from "@/lib/supabase/server";
import { CompetitorsView } from "@/components/reports/competitors-view";
import { normalizeSquadValueReport } from "@/lib/types";

/**
 * Fixes a dead sidebar link - sidebar-nav.tsx has pointed at
 * /dashboard/competitors since the redesign pass, but this route never
 * existed. Competitors data already lives inside the squad_value cache
 * (fetchCompetitors() in _shared/squad-value.ts), same source
 * squad-value-view.tsx's own short teaser reads from.
 */
export default async function CompetitorsPage() {
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
    <CompetitorsView
      initialData={normalizeSquadValueReport(cached?.payload)}
      generatedAt={cached?.generated_at ?? null}
    />
  );
}
