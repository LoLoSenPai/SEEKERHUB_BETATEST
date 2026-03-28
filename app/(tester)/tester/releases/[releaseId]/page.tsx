import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { FeedbackForm } from "@/src/features/feedback/feedback-form";
import { AccessPolicySummary } from "@/src/features/releases/access-policy-summary";
import { SeekerStatusCard } from "@/src/features/seeker/seeker-status-card";
import { WalletLinkCard } from "@/src/features/wallet/wallet-link-card";
import { getAccessibleReleasesForUser, getTesterRelease } from "@/src/features/projects/queries";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";
import { compactChecksum, formatBytes } from "@/src/lib/utils";

export default async function TesterReleaseDetailPage({
  params,
}: {
  params: Promise<{ releaseId: string }>;
}) {
  const { releaseId } = await params;
  const session = await requireSession();
  const testerRelease = await getTesterRelease(releaseId, session.user.id);

  if (!testerRelease) {
    notFound();
  }

  const { release, decision, user } = testerRelease;
  const previousReleases = release.accessPolicy?.allowPreviousReleases
    ? (await getAccessibleReleasesForUser(session.user.id)).filter(
        (candidate) => candidate.projectId === release.projectId && candidate.id !== release.id,
      )
    : [];
  const verifiedSeeker = user.wallets.some((wallet) => Boolean(wallet.seekerGenesisVerifiedAt));

  if (decision.canView) {
    await prisma.releaseViewEvent.create({
      data: {
        releaseId,
        userId: session.user.id,
        deviceProfileId: user.deviceProfiles[0]?.id,
      },
    });
  }

  return (
    <DashboardFrame
      kind="tester"
      currentPath="/tester"
      title={`${release.project.name} ${release.versionName}`}
      subtitle="Download the private build, verify metadata, and report release-specific issues back to the builder."
    >
      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <Card className="rounded-[1.75rem]">
            <CardHeader>
              <div className="flex items-center gap-3">
                <CardTitle>Release details</CardTitle>
                <Badge variant="brand">{release.versionCode}</Badge>
              </div>
              <CardDescription>Server-side release metadata computed when the APK was finalized.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-foreground">
              <div>Version name: {release.versionName}</div>
              <div>Version code: {release.versionCode}</div>
              <div>Uploaded: {format(release.publishedAt, "PPP p")}</div>
              <div>File size: {release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "Unknown"}</div>
              <div>Checksum: {release.buildAsset ? release.buildAsset.sha256Checksum : "Unavailable"}</div>
              <div>Compact checksum: {release.buildAsset ? compactChecksum(release.buildAsset.sha256Checksum) : "Unavailable"}</div>
              <div className="rounded-[1.3rem] bg-muted/70 p-4 whitespace-pre-wrap leading-7 text-muted-foreground">{release.changelog}</div>
            </CardContent>
          </Card>

          {decision.canView ? (
            <Card className="rounded-[1.75rem]">
              <CardHeader>
                <CardTitle>Download build</CardTitle>
                <CardDescription>APK access is revalidated server-side before each private download.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Link href={`/api/downloads/${release.id}`} className={buttonVariants({ size: "lg" })}>
                  Download APK
                </Link>
                <div className="text-sm text-muted-foreground">If installation is blocked, make sure unknown-source installs are enabled on the device.</div>
              </CardContent>
            </Card>
          ) : (
            <Card className="rounded-[1.75rem] border-rose-100 bg-rose-50">
              <CardHeader>
                <CardTitle>Access not complete</CardTitle>
                <CardDescription>One or more policy checks still block this release.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2 text-sm text-rose-700">
                {decision.reasons.map((reason) => (
                  <div key={reason}>{reason}</div>
                ))}
              </CardContent>
            </Card>
          )}

          {decision.canSubmitFeedback ? (
            <Card className="rounded-[1.75rem]">
              <CardHeader>
                <CardTitle>Submit feedback</CardTitle>
                <CardDescription>Feedback is tied to this release and can optionally attach the current device context.</CardDescription>
              </CardHeader>
              <CardContent>
                <FeedbackForm releaseId={release.id} />
              </CardContent>
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

        <div className="space-y-6">
          <AccessPolicySummary
            title="Access requirements"
            description="These requirements are evaluated on every page view and private download."
            policy={release.accessPolicy}
            reasons={decision.reasons}
          />
          <SeekerStatusCard verifiedSeeker={verifiedSeeker} />
          <WalletLinkCard linkedWallets={user.wallets} />
        </div>
      </div>
    </DashboardFrame>
  );
}
