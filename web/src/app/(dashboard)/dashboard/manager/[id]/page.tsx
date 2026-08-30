import { ManagerDetailView } from "@/components/reports/manager-detail-view";

export default async function ManagerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ManagerDetailView id={id} />;
}
