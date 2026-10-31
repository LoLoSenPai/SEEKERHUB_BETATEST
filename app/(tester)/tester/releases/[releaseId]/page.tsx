import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { FeedbackForm } from "@/src/features/feedback/feedback-form";
import { WalletLinkCard } from "@/src/features/wallet/wallet-link-card";
import { WalletSignIn } from "@/src/features/wallet/wallet-sign-in";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";
import { getAccessibleReleasesForUser, getTesterRelease } from "@/src/features/projects/queries";
import { prisma } from "@/src/lib/db";
import { requireTesterSession } from "@/src/lib/session";
import { cn, formatBytes } from "@/src/lib/utils";

export default async function TesterReleaseDetailPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  const session = await requireTesterSession(`/tester/releases/${releaseId}`);
  const testerRelease = await getTesterRelease(releaseId, session.user.id);

  if (!testerRelease || !testerRelease.decision.canViewMetadata) {
    notFound();
  }

  const { release, decision, user } = testerRelease;
  const canBuild = Boolean(await prisma.builderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }));
  const previousReleases = release.accessPolicy?.allowPreviousReleases
      ? (await getAccessibleReleasesForUser(session.user.id)).filter(
        (candidate) => candidate.projectId === release.projectId && candidate.publishedAt < release.publishedAt,
      )
    : [];
  const walletBlock = decision.reasons.some((reason) => reason.blocking && ["WALLET_REQUIRED", "WALLET_NOT_ALLOWLISTED", "SGT_VERIFICATION_REQUIRED", "SGT_VERIFICATION_EXPIRED"].includes(reason.code));
  const seekerBlock = decision.reasons.some((reason) => reason.blocking && ["SGT_VERIFICATION_REQUIRED", "SGT_VERIFICATION_EXPIRED"].includes(reason.code));

  if (decision.canViewMetadata) {
    const recentView = await prisma.releaseViewEvent.findFirst({
      where: { releaseId, userId: session.user.id },
    });
    if (!recentView) {
      await prisma.releaseViewEvent.create({
        data: { releaseId, userId: session.user.id, deviceProfileId: user.deviceProfiles[0]?.id },
      });
    }
  }

  return (
    <DashboardFrame
      kind="tester"
      currentPath="/tester"
      title={release.project.name}
      subtitle={`Private Android beta, version ${release.versionName}`}
      canBuild={canBuild}
      isGuest={Boolean(session.user.isAnonymous)}
      identityLabel={getTesterIdentityLabel({ ...session.user, wallets: user.wallets })}
      identityWalletAddress={(user.wallets.find((wallet) => wallet.isPrimary) ?? user.wallets[0])?.address}
    >
      <Link href="/tester" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground transition hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to my beta apps
      </Link>
      <div className="grid min-w-0 gap-6 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="min-w-0 space-y-6">
          <Card className="min-w-0 overflow-hidden rounded-[1.75rem] border-brand/25 bg-gradient-to-br from-card to-brand/5">
            <CardHeader>
              <div className="flex min-w-0 flex-wrap items-center gap-3">
                <CardTitle className="min-w-0 break-words text-2xl">{release.project.name}</CardTitle>
                <Badge variant="brand">v{release.versionName}</Badge>
              </div>
              <CardDescription>
                {release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "Android APK"}
              </CardDescription>
            </CardHeader>
            <CardContent className="min-w-0 space-y-5">
              {decision.canDownload ? (
                <>
                  <a href={`/api/downloads/${release.id}`} className={cn(buttonVariants({ size: "lg" }), "w-full justify-center sm:w-auto")}>
                    <Download className="size-4" aria-hidden="true" />
                    Download APK
                  </a>
                  <p className="text-xs leading-5 text-muted-foreground">Android may ask you to allow installs from this browser before opening the APK.</p>
                </>
              ) : (
                <div className="rounded-[1.3rem] border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
                  <div className="font-semibold">Complete access before downloading</div>
                  <div className="mt-2 grid gap-1">
                    {decision.reasons.filter((reason) => reason.blocking).map((reason) => <div key={reason.code}>{reason.message}</div>)}
                  </div>
                </div>
              )}
              <details className="rounded-[1.3rem] bg-muted/70 p-4 text-sm"><summary className="cursor-pointer font-semibold">Release notes</summary><div className="mt-3 whitespace-pre-wrap break-words leading-7 text-muted-foreground">{release.changelog}</div></details>
            </CardContent>
          </Card>

          {decision.canSubmitFeedback ? (
            <Card className="rounded-[1.75rem]">
              <CardHeader>
                <CardTitle>Send feedback</CardTitle>
                <CardDescription>Tell the builder what happened in this version.</CardDescription>
              </CardHeader>
              <CardContent><FeedbackForm releaseId={release.id} /></CardContent>
            </Card>
          ) : null}

          {previousReleases.length ? (
            <Card className="rounded-[1.75rem]">
              <CardHeader>
                <CardTitle>Previous accessible builds</CardTitle>
                <CardDescription>This release allows browsing earlier builds in the same project.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {previousReleases.map((candidate) => (
                  <Link
                    key={candidate.id}
                    href={`/tester/releases/${candidate.id}`}
                    className="block rounded-[1.3rem] border border-border bg-card p-4 text-sm transition hover:bg-muted/60 hover:shadow-md"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="font-semibold">
                        {candidate.versionName} ({candidate.versionCode})
                      </div>
                      <div className="text-muted-foreground">{candidate.buildAsset ? formatBytes(candidate.buildAsset.fileSizeBytes) : "No asset"}</div>
                    </div>
                  </Link>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {walletBlock ? <><div className="px-1"><div className="section-eyebrow">Required to download</div><h2 className="mt-2 text-xl font-semibold">Complete wallet access</h2></div><WalletLinkCard linkedWallets={user.wallets} requiredSeeker={seekerBlock} showSeeker={seekerBlock} /></> : null}
          {session.user.isAnonymous ? (
            <Card className="rounded-[1.75rem] border-brand/25 bg-brand/5">
              <CardHeader><CardTitle>Keep this access</CardTitle><CardDescription>Add an email or use a wallet to recover this beta and your feedback on another browser.</CardDescription></CardHeader>
              <CardContent><Link href={`/tester/upgrade?returnTo=${encodeURIComponent(`/tester/releases/${release.id}`)}`} className={cn(buttonVariants(), "w-full justify-center sm:w-auto")}>Add recovery email</Link>{!walletBlock ? <WalletSignIn returnTo={`/tester/releases/${release.id}`} /> : null}</CardContent>
            </Card>
          ) : null}
        </div>
      </div>
    </DashboardFrame>
  );
}
