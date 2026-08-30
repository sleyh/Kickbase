import { TeamDetailView } from "@/components/reports/team-detail-view";

export default async function TeamDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <TeamDetailView id={id} />;
}
