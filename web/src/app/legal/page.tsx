import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "Legal & Disclaimer - Kickbase Assistant",
};

export default function LegalPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col gap-6 p-6">
      <Link href="/" className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-3.5" /> Back
      </Link>

      <div>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Legal &amp; Disclaimer</h1>
        <p className="text-sm text-muted-foreground">Last updated {new Date().toLocaleDateString()}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What this is</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Kickbase Assistant is an independent, fan-made companion tool for Kickbase managers, built and
            maintained by an individual - not a company. It provides squad, market, and league insights on top of
            your own Kickbase data.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Not affiliated with Kickbase</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            This tool is not affiliated with, endorsed by, sponsored by, or otherwise connected to Kickbase GmbH,
            the Deutsche Fußball Liga (DFL), the Bundesliga, or any football club whose name, crest, or player
            likeness may appear in this app. All such trademarks, logos, names, and images are the property of
            their respective owners and are used here solely to identify the players, teams, and competition the
            underlying data refers to - not to claim any association with them.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How this works</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            You provide your own Kickbase account credentials, which this tool uses solely to access your own
            league data on your behalf, the same way you would by logging into Kickbase directly. This is not an
            official Kickbase integration and is not supported or sanctioned by Kickbase - it relies on
            undocumented parts of Kickbase&apos;s own systems, which Kickbase&apos;s own Terms &amp; Conditions
            place restrictions on. By using this tool, you&apos;re accepting that as a risk you&apos;re taking on
            yourself, not something this project can shield you from.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Your data</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            Your Kickbase password is stored encrypted (via Supabase Vault) and is only ever used to authenticate
            to Kickbase on your behalf - it is never stored in plaintext or shared with anyone else. This tool
            does not sell or share your data with third parties.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>No warranty</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 text-sm text-muted-foreground">
          <p>
            This tool is provided &quot;as is&quot;, without warranty of any kind, express or implied. Kickbase can
            change, restrict, or block access to their systems at any time without notice, which may break this
            tool&apos;s functionality entirely. Nothing here is financial, legal, or professional advice - all
            values, ratings, and predictions are best-effort estimates, not guarantees.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
