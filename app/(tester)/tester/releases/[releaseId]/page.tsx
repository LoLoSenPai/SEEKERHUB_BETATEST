import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { buttonVariants } from "@/src/components/ui/button";
import { FeedbackForm } from "@/src/features/feedback/feedback-form";
import { WalletLinkCard } from "@/src/features/wallet/wallet-link-card";
import { getAccessibleReleasesForUser, getTesterRelease } from "@/src/features/projects/queries";
import { prisma } from "@/src/lib/db";
import { requireTesterSession } from "@/src/lib/session";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";
import { cn, formatBytes } from "@/src/lib/utils";
import { AppBanner, AppIcon, AppScreenshots } from "@/src/features/project-media/app-media";
import { getProjectMedia } from "@/src/features/project-media/queries";

export default async function TesterReleaseDetailPage({ params }: { params: Promise<{ releaseId: string }> }) {
  const { releaseId } = await params;
  const session = await requireTesterSession(`/tester/releases/${releaseId}`);
  const result = await getTesterRelease(releaseId, session.user.id);
  if (!result?.decision.canViewMetadata) notFound();
  const { release, decision, user } = result;
  const media = await getProjectMedia(release.projectId);
  const canBuild = Boolean(await prisma.builderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }));
  const previous = release.accessPolicy?.allowPreviousReleases ? (await getAccessibleReleasesForUser(session.user.id)).filter((item) => item.projectId === release.projectId && item.publishedAt < release.publishedAt) : [];
  const walletBlock = decision.reasons.some((reason) => reason.blocking && ["WALLET_REQUIRED", "WALLET_NOT_ALLOWLISTED", "SGT_VERIFICATION_REQUIRED", "SGT_VERIFICATION_EXPIRED"].includes(reason.code));
  const seekerBlock = decision.reasons.some((reason) => reason.blocking && ["SGT_VERIFICATION_REQUIRED", "SGT_VERIFICATION_EXPIRED"].includes(reason.code));
  const recentView = await prisma.releaseViewEvent.findFirst({ where: { releaseId, userId: session.user.id } });
  if (!recentView) await prisma.releaseViewEvent.create({ data: { releaseId, userId: session.user.id, deviceProfileId: user.deviceProfiles[0]?.id } });

  return <DashboardFrame kind="tester" currentPath={`/tester/releases/${release.id}`} title={release.project.name} subtitle="Private Android beta" compactHeader canBuild={canBuild} isGuest={Boolean(session.user.isAnonymous)} identityLabel={getTesterIdentityLabel({ ...session.user, wallets: user.wallets })} identityWalletAddress={(user.wallets.find((wallet) => wallet.isPrimary) ?? user.wallets[0])?.address}>
    <Link href="/tester" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground"><ArrowLeft className="size-4" /> My apps</Link>
    <div className="max-w-3xl space-y-4">
      <AppBanner media={media} className="h-24 sm:h-36" />
      <section className="min-w-0">
        <div className="flex min-w-0 items-center gap-4"><AppIcon media={media} name={release.project.name} /><div className="min-w-0"><h1 className="break-words text-2xl font-bold tracking-tight">{release.project.name}</h1><p className="mt-1 text-sm text-muted-foreground">{release.versionName} &middot; Android{release.buildAsset ? ` · ${formatBytes(release.buildAsset.fileSizeBytes)}` : ""}</p></div></div>
        {release.project.description ? <p className="mt-4 line-clamp-2 break-words text-sm leading-6">{release.project.description}</p> : null}
        {decision.canDownload ? <><a href={`/api/downloads/${release.id}`} className={cn(buttonVariants({ size: "lg" }), "mt-5 w-full justify-center")}><Download className="size-4" /> Download APK</a><p className="mt-3 text-xs leading-5 text-muted-foreground">Open the downloaded APK on Android. You may need to allow installs from this browser. Return to My apps anytime to leave feedback.</p></> : <div className="mt-5 rounded-2xl border border-danger/20 bg-danger/5 p-4 text-sm"><p className="font-semibold">Complete access before downloading</p>{decision.reasons.filter((reason) => reason.blocking).map((reason) => <p key={reason.code} className="mt-2">{reason.message}</p>)}</div>}
      </section>
      {walletBlock ? <section><h2 className="mb-3 text-lg font-semibold">{seekerBlock ? "Verify Seeker access" : "Complete wallet access"}</h2><WalletLinkCard linkedWallets={user.wallets} requiredSeeker={seekerBlock} showSeeker={seekerBlock} sgtContext={seekerBlock ? { releaseId: release.id } : undefined} /></section> : null}
      {media.some((item) => item.kind === "SCREENSHOT") ? <section><h2 className="mb-3 text-lg font-semibold">App screenshots</h2><AppScreenshots media={media} /></section> : null}
      {decision.canSubmitFeedback ? <details className="rounded-2xl bg-warm p-5 text-foreground"><summary className="cursor-pointer font-semibold">After your test: leave feedback</summary><div className="mt-5"><FeedbackForm releaseId={release.id} /></div></details> : null}
      <details className="rounded-2xl border border-border bg-card p-5"><summary className="cursor-pointer font-semibold">Release details</summary><div className="mt-4 space-y-4 text-sm text-muted-foreground"><div><h3 className="font-semibold text-foreground">Release notes</h3><p className="mt-2 whitespace-pre-wrap break-words leading-6">{release.changelog}</p></div><p>Version code: {release.versionCode}{release.minSdk ? ` · Minimum Android SDK: ${release.minSdk}` : ""}{release.targetSdk ? ` · Target SDK: ${release.targetSdk}` : ""}</p>{previous.length ? <div><h3 className="font-semibold text-foreground">Previous accessible builds</h3>{previous.map((item) => <Link key={item.id} href={`/tester/releases/${item.id}`} className="mt-2 block underline">Version {item.versionName}</Link>)}</div> : null}</div></details>
      {session.user.isAnonymous ? <p className="text-sm text-muted-foreground">Keep this access on another browser. <Link href="/tester/account" className="font-semibold underline">Set up account recovery</Link>.</p> : null}
    </div>
  </DashboardFrame>;
}
