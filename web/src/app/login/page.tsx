import Link from "next/link";
import { AuthForm } from "@/components/auth/auth-form";

export default function LoginPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-b from-background to-muted/40 p-6">
      <AuthForm mode="login" />
      <p className="text-sm text-muted-foreground">
        No account yet?{" "}
        <Link href="/signup" className="font-medium text-foreground underline underline-offset-4">
          Sign up
        </Link>
      </p>
      <Link href="/legal" className="text-xs text-muted-foreground underline underline-offset-4">
        Legal &amp; Disclaimer
      </Link>
    </div>
  );
}
