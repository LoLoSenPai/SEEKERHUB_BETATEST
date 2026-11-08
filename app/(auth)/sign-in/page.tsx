import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailAuthForm } from "@/src/components/auth/email-auth-form";
import { SignInWallet } from "@/src/components/auth/sign-in-wallet";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { getAuthReturnTo, getEmailAuthMethod } from "@/src/lib/auth-navigation";
import { getSession } from "@/src/lib/session";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; returnTo?: string; method?: string }>;
}) {
  const params = await searchParams;
  const returnTo = getAuthReturnTo(params);
  const session = await getSession();
  if (session && !session.user.isAnonymous) redirect(returnTo);

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-6 sm:py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(93,135,255,0.18),transparent_40%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/70" />
      <div className="relative mx-auto flex max-w-5xl flex-col gap-8">
        <header className="flex items-center justify-between gap-4">
          <Link href="/" className="font-mono text-xs uppercase tracking-[0.26em] text-muted-foreground">SeekerHub</Link>
          <ThemeToggle />
        </header>
        <div className="grid items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="order-2 space-y-5 lg:order-1">
            <div className="section-eyebrow">One account, all your access</div>
            <h2 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Your apps. Your feedback. Your next release.</h2>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">
              Use the same account to test shared apps and manage your own releases. Private apps still require an invitation; signing in does not grant access to them.
            </p>
          </div>
          <div className="order-1 w-full max-w-lg justify-self-center lg:order-2">
            <h1 className="mb-5 text-3xl font-semibold tracking-tight sm:text-4xl">Sign in to SeekerHub</h1>
            <EmailAuthForm mode="sign-in" returnTo={returnTo} defaultMethod={getEmailAuthMethod("sign-in", params.method)} />
            <SignInWallet returnTo={returnTo} />
          </div>
        </div>
      </div>
    </main>
  );
}
