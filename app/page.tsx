import Link from "next/link";
import { ArrowRight, ShieldCheck, Smartphone, UploadCloud } from "lucide-react";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { cn } from "@/src/lib/utils";

export default function Home() {
  return (
    <main className="relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(93,135,255,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(77,187,148,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/70" />
      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-5 pb-16 pt-5 sm:px-8">
        <header className="flex items-center justify-between py-4">
          <div>
            <div className="font-mono text-xs uppercase tracking-[0.32em] text-muted-foreground">SeekerHub</div>
            <div className="mt-2 text-sm text-muted-foreground">
              Private Android beta releases for serious Solana mobile builders.
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/sign-in" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
              Sign in
            </Link>
            <Link href="/sign-up" className={buttonVariants({ size: "sm" })}>
              Start building
            </Link>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-12 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-8">
            <div className="inline-flex items-center rounded-full border border-border bg-surface px-4 py-2 text-xs font-medium tracking-[0.2em] text-muted-foreground shadow-sm backdrop-blur">
              WEB-FIRST MVP FOR SEEKER BUILDERS
            </div>
            <div className="space-y-5">
              <h1 className="max-w-3xl text-5xl font-semibold tracking-tight text-foreground sm:text-6xl">
                Ship private APK betas with Seeker-aware access, minus the store overhead.
              </h1>
              <p className="max-w-2xl text-lg leading-8 text-muted-foreground">
                Upload signed Android builds, share clean invite links, control tester access, collect release feedback,
                and keep the mobile wallet and Seeker layer ready from day one.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Link href="/sign-up" className={buttonVariants({ size: "lg" })}>
                Create builder account
                <ArrowRight className="size-4" />
              </Link>
              <Link href="/tester" className={buttonVariants({ variant: "secondary", size: "lg" })}>
                Open tester dashboard
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <Card>
                <CardHeader>
                  <UploadCloud className="size-5 text-brand" />
                  <CardTitle>Release pipeline</CardTitle>
                </CardHeader>
                <CardContent>
                  Presigned APK uploads, SHA-256 checksums, private download delivery, and changelog-first release records.
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <ShieldCheck className="size-5 text-brand" />
                  <CardTitle>Policy-driven access</CardTitle>
                </CardHeader>
                <CardContent>
                  Invite links, tester groups, wallet allowlists, and optional verified Seeker requirements in one engine.
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Smartphone className="size-5 text-brand" />
                  <CardTitle>Mobile-first testing</CardTitle>
                </CardHeader>
                <CardContent>
                  A fast tester dashboard for Android and Seeker users, without forcing a dedicated companion app in v1.
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="rounded-[2rem] border border-border bg-surface/90 p-4 shadow-[0_32px_120px_rgba(15,23,42,0.12)] backdrop-blur">
            <div className="rounded-[1.6rem] border border-border bg-panel p-4">
              <div className="grid gap-4">
                <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-4 py-3">
                  <div>
                    <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">Release</div>
                    <div className="mt-1 text-lg font-semibold">Seeker Notes v0.8.3</div>
                  </div>
                  <div className="rounded-full bg-accent px-3 py-1 font-mono text-xs text-accent-foreground">PRIVATE</div>
                </div>
                <div className="rounded-2xl border border-border bg-card p-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">APK metadata</div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div>Version name: 0.8.3</div>
                        <div>Version code: 83</div>
                        <div>File size: 46.7 MB</div>
                        <div>Checksum: 932d...a1f0</div>
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Access</div>
                      <div className="mt-3 space-y-2 text-sm">
                        <div>Invite required</div>
                        <div>Wallet allowlist enabled</div>
                        <div>Solana Mobile capable</div>
                        <div>Seeker verification optional</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="rounded-2xl border border-dashed border-border bg-gradient-to-br from-slate-900 to-slate-800 p-4 text-slate-50">
                  <div className="font-mono text-xs uppercase tracking-[0.24em] text-slate-300">Tester view</div>
                  <div className="mt-3 text-2xl font-semibold">Download build</div>
                  <p className="mt-2 text-sm leading-6 text-slate-300">
                    Seeker-ready context, wallet link status, release notes, previous builds, and feedback reporting in one page.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
