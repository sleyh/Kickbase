import { createClient } from "@/lib/supabase/server";
import { SquadRosterView } from "@/components/reports/squad-roster-view";
import { normalizeSquadValueReport } from "@/lib/types";

/** Same cached squad_value report every other squad-related page reads - see normalizeSquadValueReport() for why the cast goes through that helper. */
export default async function SquadPage() {
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
    <SquadRosterView
      initialData={normalizeSquadValueReport(cached?.payload)}
      generatedAt={cached?.generated_at ?? null}
    />
  );
}
