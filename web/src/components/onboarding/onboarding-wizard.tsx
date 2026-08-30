"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, CheckCircle2, ExternalLink } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";

type KickbaseLeague = { id: string; name?: string };

type Step = "kickbase" | "league" | "telegram" | "done";

export function OnboardingWizard() {
  const router = useRouter();
  const supabase = createClient();

  const [step, setStep] = useState<Step>("kickbase");
  const [loading, setLoading] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [leagues, setLeagues] = useState<KickbaseLeague[]>([]);

  const [deepLink, setDeepLink] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);

  async function submitKickbase(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("test-kickbase-login", {
      body: { kickbase_email: email, kickbase_password: password },
    });
    setLoading(false);

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Couldn't verify those credentials.");
      return;
    }

    if (data.autoSelected) {
      await finalizeLeague(data.autoSelected);
      return;
    }
    setLeagues(data.leagues ?? []);
    setStep("league");
  }

  async function finalizeLeague(leagueId: string) {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("test-kickbase-login", {
      body: { kickbase_email: email, kickbase_password: password, league_id: leagueId },
    });
    setLoading(false);

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Couldn't save that league.");
      return;
    }

    toast.success(`Connected to ${data.league?.name ?? "your league"}.`);
    await startTelegramLink();
  }

  async function startTelegramLink() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("telegram-link", { body: {} });
    setLoading(false);

    if (error || data?.error) {
      toast.error(data?.error ?? error?.message ?? "Couldn't set up Telegram linking.");
      return;
    }

    setDeepLink(data.deepLink);
    setLinked(data.linked);
    setStep("telegram");
  }

  // Poll for confirmation once the user has tapped the deep link and
  // pressed Start in Telegram - telegram-webhook flips linked_at on the
  // server, so a light poll here is simpler than wiring up Realtime for
  // a one-time onboarding step.
  useEffect(() => {
    if (step !== "telegram" || linked) return;
    const interval = setInterval(async () => {
      const { data } = await supabase.functions.invoke("telegram-link", { body: {} });
      if (data?.linked) {
        setLinked(true);
        clearInterval(interval);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [step, linked, supabase]);

  function finish() {
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="w-full max-w-md"
    >
      <Card className="border-border/60 shadow-xl shadow-black/5">
        <AnimatePresence mode="wait">
          {step === "kickbase" && (
            <motion.div key="kickbase" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CardHeader>
                <CardTitle>Connect your Kickbase account</CardTitle>
                <CardDescription>
                  Your password is verified once, then stored encrypted - never in plaintext, never
                  sent back to this app after this step.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submitKickbase} className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="kb-email">Kickbase email</Label>
                    <Input id="kb-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="kb-password">Kickbase password</Label>
                    <Input
                      id="kb-password"
                      type="password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                  <Button type="submit" disabled={loading} className="mt-2">
                    {loading && <Loader2 className="animate-spin" />}
                    Verify & continue
                  </Button>
                </form>
              </CardContent>
            </motion.div>
          )}

          {step === "league" && (
            <motion.div key="league" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CardHeader>
                <CardTitle>Pick your league</CardTitle>
                <CardDescription>This account is in more than one Kickbase league.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {leagues.map((league) => (
                  <Button
                    key={league.id}
                    variant="outline"
                    disabled={loading}
                    className="justify-start"
                    onClick={() => finalizeLeague(league.id)}
                  >
                    {loading && <Loader2 className="animate-spin" />}
                    {league.name ?? league.id}
                  </Button>
                ))}
              </CardContent>
            </motion.div>
          )}

          {step === "telegram" && (
            <motion.div key="telegram" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <CardHeader>
                <CardTitle>Connect Telegram</CardTitle>
                <CardDescription>
                  {linked
                    ? "Your Telegram chat is linked."
                    : "Tap the button below, then press Start in Telegram."}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {linked ? (
                  <div className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-600 dark:text-green-400">
                    <CheckCircle2 className="size-4" />
                    Linked successfully
                  </div>
                ) : (
                  deepLink && (
                    <a
                      href={deepLink}
                      target="_blank"
                      rel="noreferrer"
                      className={cn(buttonVariants({ variant: "outline" }))}
                    >
                      Open Telegram <ExternalLink className="size-4" />
                    </a>
                  )
                )}
                {!linked && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> Waiting for confirmation...
                  </p>
                )}
                <Button onClick={finish} disabled={!linked}>
                  Go to dashboard
                </Button>
                {!linked && (
                  <Button variant="ghost" size="sm" onClick={finish}>
                    Skip for now
                  </Button>
                )}
              </CardContent>
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  );
}
