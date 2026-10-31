import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/src/components/ui/button";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { cn } from "@/src/lib/utils";

export default function Home() {
  return <main className="relative min-h-screen overflow-hidden">
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(93,135,255,0.18),transparent_35%),radial-gradient(circle_at_80%_10%,rgba(77,187,148,0.12),transparent_28%)]" />
    <div className="relative mx-auto max-w-5xl px-5 pb-12 pt-5 sm:px-8">
      <header className="flex items-center justify-between gap-3 py-3"><span className="font-mono text-xs uppercase tracking-[0.26em] text-muted-foreground">SeekerHub</span><div className="flex items-center gap-2"><ThemeToggle /><Link href="/sign-in?intent=builder" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>Sign in</Link></div></header>
      <section className="grid gap-8 py-7 sm:py-14 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-5"><div className="section-eyebrow">Private Android betas</div><h1 className="max-w-2xl text-4xl font-semibold tracking-tight sm:text-6xl">Build together, before the store.</h1><p className="max-w-xl text-base leading-7 text-muted-foreground sm:text-lg">Share Android builds privately, invite testers, and collect useful feedback.</p>
          <div className="grid gap-3 sm:grid-cols-2"><Link href="/sign-up?intent=builder&returnTo=/builder/onboarding" className="rounded-2xl border border-primary bg-primary p-4 text-primary-foreground shadow-lg"><span className="flex items-center justify-between gap-3 font-semibold">Publish an app <ArrowRight className="size-5" aria-hidden="true" /></span><span className="mt-1 block text-sm opacity-80">Create a builder workspace.</span></Link><Link href="/sign-in?intent=tester&returnTo=%2Ftester" className="rounded-2xl border border-border bg-surface p-4 shadow-sm hover:bg-card"><span className="flex items-center justify-between gap-3 font-semibold">I&apos;m a tester <ArrowRight className="size-5" aria-hidden="true" /></span><span className="mt-1 block text-sm text-muted-foreground">Use an invite or recover access.</span></Link></div>
        </div>
        <div className="rounded-[1.75rem] border border-border bg-surface/90 p-6 shadow-lg"><h2 className="text-xl font-semibold">How testing works</h2><ol className="mt-4 space-y-3 text-sm leading-6 text-muted-foreground"><li><strong className="text-foreground">1. Get an invite.</strong> Open the private link from the builder.</li><li><strong className="text-foreground">2. Install the build.</strong> Follow any access steps, then download the APK.</li><li><strong className="text-foreground">3. Share feedback.</strong> Tell the builder what worked or went wrong.</li></ol></div>
      </section>
      <footer className="flex flex-wrap justify-between gap-4 border-t border-border py-6 text-xs text-muted-foreground"><span>SeekerHub public beta</span><div className="flex gap-4"><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/abuse">Report abuse</Link></div></footer>
    </div>
  </main>;
}
