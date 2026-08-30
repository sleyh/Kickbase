import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Overview</h1>
        <p className="text-muted-foreground">
          Connect your Kickbase account to see live squad value, competitors, and alerts here.
        </p>
      </div>
      <Card className="border-dashed">
        <CardHeader>
          <CardTitle>Squad value, competitors, and market alerts land here next</CardTitle>
          <CardDescription>
            This scaffold proves sign-up, sign-in, and session handling end-to-end. Report
            widgets are wired up in the next milestone.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}
