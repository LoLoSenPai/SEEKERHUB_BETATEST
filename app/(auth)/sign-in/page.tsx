import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailAuthForm } from "@/src/components/auth/email-auth-form";
import { getSession } from "@/src/lib/session";

export default async function SignInPage() {
  const session = await getSession();

  if (session) {
    redirect("/builder");
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(93,135,255,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(77,187,148,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/70" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-8">
        <Link href="/" className="font-mono text-xs uppercase tracking-[0.26em] text-muted-foreground">
          Back to SeekerHub
        </Link>
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="space-y-5">
            <div className="section-eyebrow">Builder authentication</div>
            <h1 className="text-5xl font-semibold tracking-tight text-foreground">
              Manage APK releases, testers, invites, and Seeker-aware policies.
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              The builder workspace stays conventional on purpose: email/password auth, production-friendly release controls,
              and Solana wallet linking only when the product needs it.
            </p>
          </div>
          <EmailAuthForm mode="sign-in" />
        </div>
      </div>
    </main>
  );
}
