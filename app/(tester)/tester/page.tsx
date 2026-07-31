import Link from "next/link";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { EmptyState } from "@/src/components/ui/empty-state";
import { WalletLinkCard } from "@/src/features/wallet/wallet-link-card";
import { SeekerStatusCard } from "@/src/features/seeker/seeker-status-card";
import { getAccessibleReleasesForUser, getTesterIdentity } from "@/src/features/projects/queries";
import { requireTesterSession } from "@/src/lib/session";
import { compactChecksum, cn, formatBytes } from "@/src/lib/utils";
import { prisma } from "@/src/lib/db";

export default async function TesterDashboardPage() {
  const session = await requireTesterSession();
  const [releases, tester] = await Promise.all([
    getAccessibleReleasesForUser(session.user.id),
    getTesterIdentity(session.user.id),
  ]);
  const canBuild = Boolean(
    await prisma.builderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
  );
  const verifiedSeeker = tester?.wallets.some(
    (wallet) => wallet.seekerGenesisVerificationExpiresAt && wallet.seekerGenesisVerificationExpiresAt > new Date(),
  ) ?? false;

  return (
    <DashboardFrame
      kind="tester"
      currentPath="/tester"
      title="Accessible releases"
      subtitle="Claim invite links, link a wallet when needed, and keep the release-detail flow mobile first."
      canBuild={canBuild}
    >
      {session.user.isAnonymous ? (
        <Card className="mb-6 rounded-[1.75rem] border-brand/30 bg-brand/5">
          <CardHeader>
            <CardTitle>Protect this guest access</CardTitle>
            <CardDescription>
              Add an email magic link so these invites, downloads, feedback reports, and linked wallets can be recovered on another device.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/tester/upgrade" className={cn(buttonVariants())}>Protect tester access</Link>
          </CardContent>
        </Card>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <Card className="rounded-[1.75rem]">
            <CardHeader>
              <CardTitle>My builds</CardTitle>
              <CardDescription>
                Releases are shown only after server-side access evaluation across invites, tester groups, wallet allowlists, and optional Seeker rules.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {releases.length ? (
                releases.map((release) => (
                  <Link
                    key={release.id}
                    href={`/tester/releases/${release.id}`}
                    className="block rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60 hover:shadow-md"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-lg font-semibold">
                            {release.project.name} {release.versionName}
                          </h3>
                          <Badge variant="brand">{release.versionCode}</Badge>
                        </div>
                        <p className="line-clamp-2 text-sm leading-7 text-muted-foreground">{release.changelog}</p>
                      </div>
                      <div className="grid gap-2 text-sm text-muted-foreground lg:text-right">
                        <div>{release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "No asset"}</div>
                        <div>{release.buildAsset ? compactChecksum(release.buildAsset.sha256Checksum) : "No checksum"}</div>
                      </div>
                    </div>
                  </Link>
                ))
              ) : (
                <EmptyState
                  title="No accessible releases yet"
                  description="Claim an invite link first, or link the wallet that your builder allowlisted for private beta access."
                  action={
                    <Link href="/" className={cn(buttonVariants({ variant: "secondary" }))}>
                      Back to product
                    </Link>
                  }
                />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <WalletLinkCard linkedWallets={tester?.wallets ?? []} />
          <SeekerStatusCard verifiedSeeker={verifiedSeeker} />
        </div>
      </div>
    </DashboardFrame>
  );
}
