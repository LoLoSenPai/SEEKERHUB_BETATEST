import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Smartphone, Upload } from "lucide-react";
import { getSession } from "@/src/lib/session";
import { prisma } from "@/src/lib/db";
import { dashboardDestination, workspacePreference, WORKSPACE_COOKIE } from "@/src/lib/workspace";
import { switchWorkspaceAction } from "@/src/features/workspace/actions";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { AccountMenu } from "@/src/components/layout/account-menu";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";
import { BrandIcon } from "@/src/components/brand/brand-icon";

export default async function DashboardPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in?returnTo=%2Fdashboard");
  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: {
    builderProfile: { select: { status: true } }, wallets: { select: { address: true, isPrimary: true } },
    _count: { select: { inviteClaims: true, testerAccesses: true, testerMemberships: true } },
  } });
  const destination = dashboardDestination({
    isGuest: Boolean(session.user.isAnonymous), builderStatus: user?.builderProfile?.status ?? null,
    hasTestingActivity: Boolean(user && Object.values(user._count).some(count => count > 0)),
    preference: workspacePreference((await cookies()).get(WORKSPACE_COOKIE)?.value, session.user.id),
  });
  if (destination) redirect(destination);
  const wallet = user?.wallets.find(entry => entry.isPrimary) ?? user?.wallets[0];
  return <main className="mx-auto min-h-screen max-w-5xl px-5 py-6 sm:px-8">
    <header className="flex items-center justify-between gap-4"><Link href="/" className="flex items-center gap-2.5 text-xl font-bold tracking-tight"><BrandIcon size={28} />SeekerHub</Link><AccountMenu kind="tester" isGuest={false} identityLabel={getTesterIdentityLabel({ ...session.user, wallets: user?.wallets })} walletAddress={wallet?.address} /></header>
    <section className="py-12 sm:py-20">
      <p className="section-eyebrow">Your account is ready</p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">One account. Both sides of a beta.</h1>
      <p className="mt-5 max-w-2xl text-base leading-7 text-muted-foreground">Publish your own Android app or test a build shared with you. Switch between the two anytime, without signing in again.</p>
      <div className="mt-9 grid gap-5 sm:grid-cols-2">
        <section className="flex flex-col rounded-3xl border border-border bg-card p-6 sm:p-8">
          <Upload className="size-7 text-brand" aria-hidden="true" /><h2 className="mt-5 text-xl font-bold">Bring your app to testers</h2>
          <p className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">Create an app profile, upload your APK, and share a private beta link. A verified email is required to activate publishing. Beta quotas apply.</p>
          <form action={switchWorkspaceAction} className="mt-auto"><input type="hidden" name="workspace" value="publishing" /><PendingSubmitButton className="w-full" idleLabel="Publish your first app" pendingLabel="Opening publishing..." /></form>
        </section>
        <section className="flex flex-col rounded-3xl border border-border bg-brand-soft p-6 sm:p-8">
          <Smartphone className="size-7 text-brand" aria-hidden="true" /><h2 className="mt-5 text-xl font-bold">Have a beta invitation?</h2>
          <p className="mb-6 mt-3 text-sm leading-6 text-muted-foreground">Open the link sent by the developer. Apps you join will appear in Testing, ready to download and review. There is no public app catalogue.</p>
          <form action={switchWorkspaceAction} className="mt-auto"><input type="hidden" name="workspace" value="testing" /><PendingSubmitButton variant="secondary" className="w-full" idleLabel="Open my testing library" pendingLabel="Opening testing..." /></form>
        </section>
      </div>
    </section>
  </main>;
}
