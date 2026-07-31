import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailAuthForm } from "@/src/components/auth/email-auth-form";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { safeReturnTo } from "@/src/lib/redirect";
import { getSession } from "@/src/lib/session";
import { WalletProviders } from "@/src/features/wallet/wallet-providers";
import { WalletSignIn } from "@/src/features/wallet/wallet-sign-in";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; returnTo?: string }>;
}) {
  const params = await searchParams;
  const intent = params.intent === "tester" ? "tester" : "builder";
  const returnTo = safeReturnTo(params.returnTo, intent === "builder" ? "/builder" : "/tester");
  const session = await getSession();
  if (session && !session.user.isAnonymous) redirect(returnTo);

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-6 sm:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(93,135,255,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(77,187,148,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/70" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-mono text-xs uppercase tracking-[0.26em] text-muted-foreground">SeekerHub</Link>
          <ThemeToggle />
        </header>
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="order-2 space-y-5 lg:order-1">
            <div className="section-eyebrow">{intent === "builder" ? "Builder access" : "Tester access"}</div>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              {intent === "builder" ? "Manage releases and private beta access." : "Recover every build shared with you."}
            </h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              {intent === "builder"
                ? "Builders use a verified email and password. Wallets remain optional unless a release policy needs one."
                : "A magic link upgrades this guest session and keeps its invites, downloads, feedback, device profile, and wallets."}
            </p>
          </div>
          <div className="order-1 lg:order-2">
            <EmailAuthForm mode="sign-in" intent={intent} returnTo={returnTo} />
            {intent === "tester" ? <WalletProviders><WalletSignIn returnTo={returnTo} /></WalletProviders> : null}
          </div>
        </div>
      </div>
    </main>
  );
}
