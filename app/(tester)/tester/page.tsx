import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { getAccessibleReleasesForUser, getTesterIdentity, getTesterRelease } from "@/src/features/projects/queries";
import { prisma } from "@/src/lib/db";
import { requireTesterSession } from "@/src/lib/session";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";
import { latestApps } from "@/src/features/tester/latest-apps";
import { AppIcon } from "@/src/features/project-media/app-media";
import { getProjectMedia } from "@/src/features/project-media/queries";

export default async function TesterDashboardPage() {
  const session = await requireTesterSession();
  const [releases, tester, builder] = await Promise.all([
    getAccessibleReleasesForUser(session.user.id),
    getTesterIdentity(session.user.id),
    prisma.builderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
  ]);
  const apps = latestApps(releases);
  const decisions = await Promise.all(apps.map((release) => getTesterRelease(release.id, session.user.id)));
  const media = await Promise.all(apps.map((release, index) =>
    decisions[index]?.decision.canViewMetadata ? getProjectMedia(release.projectId) : [],
  ));

  return <DashboardFrame kind="tester" currentPath="/tester" title="My apps" subtitle="Your private betas, all in one place." canBuild={Boolean(builder)} isGuest={Boolean(session.user.isAnonymous)} identityLabel={getTesterIdentityLabel({ ...session.user, wallets: tester?.wallets })} identityWalletAddress={(tester?.wallets.find((wallet) => wallet.isPrimary) ?? tester?.wallets[0])?.address}>
    {session.user.isAnonymous ? <div className="mb-6 rounded-2xl border border-brand/25 bg-brand/5 p-4 text-sm">Your apps are saved in this browser. <Link href="/tester/account" className="font-semibold underline">Add account recovery</Link> to keep your access.</div> : null}
    {apps.length ? <div className="grid min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {apps.map((release, index) => {
        const decision = decisions[index]?.decision;
        if (!decision?.canViewMetadata) return null;
        const renewal = decision.reasons.some((reason) => reason.blocking && ["SGT_VERIFICATION_REQUIRED", "SGT_VERIFICATION_EXPIRED"].includes(reason.code));
        return <Link key={release.projectId} href={`/tester/releases/${release.id}`} className="group flex min-w-0 flex-col gap-4 rounded-[1.5rem] border border-border bg-card p-5 transition hover:border-brand/50 hover:shadow-md">
          <div className="flex items-start justify-between gap-3"><AppIcon media={media[index]} name={release.project.name} className="size-14" /><ArrowUpRight className="size-5 shrink-0 text-muted-foreground" /></div>
          <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{release.project.name}</h2><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{release.project.description || "Private Android beta"}</p></div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-sm"><span className="text-muted-foreground">Version {release.versionName}</span><span className="font-semibold text-brand">{decision.canDownload ? "Ready to download" : renewal ? "Verify Seeker to download" : "Access action needed"}</span></div>
        </Link>;
      })}
    </div> : <div className="rounded-[1.5rem] border border-border bg-card p-6"><h2 className="text-lg font-semibold">No apps yet</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Open an invitation from a builder, or link the wallet used for your beta access.</p><Link href="/tester/account" className="mt-4 inline-block font-semibold underline">Go to account</Link></div>}
  </DashboardFrame>;
}
