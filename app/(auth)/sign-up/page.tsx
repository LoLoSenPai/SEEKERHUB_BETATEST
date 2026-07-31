import Link from "next/link";
import { redirect } from "next/navigation";
import { EmailAuthForm } from "@/src/components/auth/email-auth-form";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { safeReturnTo } from "@/src/lib/redirect";
import { getSession } from "@/src/lib/session";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const params = await searchParams;
  const returnTo = safeReturnTo(params.returnTo, "/builder/onboarding");
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
            <div className="section-eyebrow">Builder registration</div>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">Create a small, production-ready release workspace.</h1>
            <p className="max-w-xl text-lg leading-8 text-muted-foreground">Public beta accounts start with one project, five stored releases, 250 MiB per APK, and 500 MiB total storage.</p>
          </div>
          <div className="order-1 lg:order-2">
            <EmailAuthForm mode="sign-up" intent="builder" returnTo={returnTo} />
          </div>
        </div>
      </div>
    </main>
  );
}
