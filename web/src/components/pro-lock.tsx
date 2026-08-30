import { Lock } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/** Shown in place of a gated page/section for a non-pro user. */
export function ProLock({ feature }: { feature: string }) {
  return (
    <Card className="border-dashed">
      <CardContent className="flex flex-col items-center gap-3 py-16 text-center">
        <Lock className="size-6 text-muted-foreground" />
        <div>
          <p className="font-heading text-lg font-semibold">{feature} is a Pro feature</p>
          <p className="text-sm text-muted-foreground">Ask whoever invited you for access.</p>
        </div>
      </CardContent>
    </Card>
  );
}
