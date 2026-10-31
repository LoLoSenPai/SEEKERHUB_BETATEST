import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { BuilderJourney } from "@/src/components/layout/builder-journey";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { ReleasePolicyEditor } from "@/src/features/releases/access-policy-fields";
import { AccessPolicySummary } from "@/src/features/releases/access-policy-summary";
import { getReleaseForOwner } from "@/src/features/projects/queries";
import { requireBuilderSession } from "@/src/lib/session";
import { cn, formatBytes } from "@/src/lib/utils";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { setReleaseArchivedAction, trashReleaseAction } from "@/src/features/releases/actions";
import { ReleasePublishForm } from "@/src/features/releases/release-publish-form";
import { InviteLinkCopyButton } from "@/src/features/invites/invite-link-copy-button";
import { prisma } from "@/src/lib/db";
import { buildInviteShareUrl, decryptInviteToken } from "@/src/lib/invite";
import { getClientEnv } from "@/src/lib/env";

export default async function BuilderReleaseDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; releaseId: string }>;
  searchParams: Promise<{ published?: string; invite?: string }>;
}) {
  const { slug, releaseId } = await params;
  const session = await requireBuilderSession();
  const release = await getReleaseForOwner(slug, releaseId, session.user.id);

  if (!release) {
    notFound();
  }
  const query = await searchParams;
  const defaults = {
    requireInviteAcceptance: release.accessPolicy?.requireInviteAcceptance,
    testerGroupId: release.accessPolicy?.testerGroupId,
    requireLinkedWallet: release.accessPolicy?.requireLinkedWallet,
    requireSolanaMobile: release.accessPolicy?.requireSolanaMobile,
    requireVerifiedSeeker: release.accessPolicy?.requireVerifiedSeeker,
    allowPreviousReleases: release.accessPolicy?.allowPreviousReleases,
    walletAllowlist: release.accessPolicy?.walletEntries.map((entry) => entry.address).join("\n"),
  };
  if (release.status === "DRAFT") {
    return <DashboardFrame kind="builder" currentPath="/builder" title={`${release.project.name}: prepare v${release.versionName}`} subtitle="Your APK is checked and saved. Finish the release details before sharing it." identityLabel={session.user.email}>
      <Link href={`/builder/apps/${slug}`} className="mb-4 inline-flex text-sm font-semibold text-brand">Back to {release.project.name}</Link>
      <Card className="rounded-[1.75rem]">
        <CardHeader><div className="flex flex-wrap items-center gap-3"><CardTitle>Prepare your release</CardTitle><Badge>Draft</Badge></div><CardDescription>v{release.versionName} ({release.versionCode}) · {release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "No APK"}</CardDescription></CardHeader>
        <CardContent><ReleasePublishForm releaseId={release.id} version={release.versionName} packageName={release.project.androidPackageName ?? "Unknown package"} groups={release.project.testerGroups} initialNotes={release.changelog} defaults={defaults} /></CardContent>
      </Card>
      <form action={trashReleaseAction} className="mt-5"><input type="hidden" name="releaseId" value={release.id} /><input type="hidden" name="projectSlug" value={slug} /><PendingSubmitButton variant="ghost" idleLabel="Move draft to trash" pendingLabel="Moving draft..." /></form>
    </DashboardFrame>;
  }
  const shareInvite = await prisma.inviteLink.findFirst({
    where: { projectId: release.projectId, revokedAt: null, tokenCiphertext: { not: null },
      AND: [
        query.invite ? { id: query.invite, OR: [{ releaseId: release.id }, { releaseId: null }] } : { releaseId: release.id },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ],
    }, orderBy: { createdAt: "desc" },
  });
  let token: string | null = null;
  try { token = shareInvite?.tokenCiphertext ? decryptInviteToken(shareInvite.tokenCiphertext) : null; }
  catch { /* A retired encryption key must not make the release page unavailable. */ }
  const shareUrl = token ? buildInviteShareUrl(token, getClientEnv().NEXT_PUBLIC_APP_URL) : null;
  const testerUrl = `${getClientEnv().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/tester`;
  const { analytics } = release;

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={`${release.project.name} ${release.versionName}`}
      subtitle="Share this version, follow tester activity, and review feedback."
      identityLabel={session.user.email}
    >
      <BuilderJourney
        projectSlug={release.project.slug}
        current="review"
        releaseCount={release.project.releases.length}
        inviteCount={release.project.inviteLinks.length}
        downloadCount={release.downloadEvents.length}
      />
      {release.status === "PUBLISHED" ? <Card className="mb-6 rounded-[1.75rem] border-brand/30 bg-brand/5">
        <CardHeader><CardTitle>{query.published ? "Your release is published" : "Share this release"}</CardTitle><CardDescription>{release.accessPolicy?.requireInviteAcceptance ? "Send the invite to your testers. They can download after meeting the audience requirements." : "Allowed wallets can find this release from the tester dashboard."}</CardDescription></CardHeader>
        <CardContent className="space-y-4">
          {shareUrl && release.accessPolicy?.requireInviteAcceptance ? <><div className="flex min-w-0 flex-wrap items-center gap-3"><code className="min-w-0 flex-1 break-all rounded-xl border border-border bg-card p-3 text-xs">{shareUrl}</code><InviteLinkCopyButton url={shareUrl} /></div><p className="text-xs text-muted-foreground">{shareInvite?.releaseId ? "This version only" : "App-wide access, including future eligible releases"} · {shareInvite?.maxUses ? `${shareInvite.maxUses} tester places` : "Unlimited places"}</p></> : <Link href={release.accessPolicy?.requireInviteAcceptance ? `/builder/apps/${slug}/invites?releaseId=${release.id}` : "/tester"} className={buttonVariants()}>{release.accessPolicy?.requireInviteAcceptance ? "Create an invite for this version" : "Open tester dashboard"}</Link>}
          <p className="text-sm text-muted-foreground">Next: ask testers to install the build, try the release notes, and leave feedback below their download.</p>
          {!release.accessPolicy?.requireInviteAcceptance ? <div className="flex min-w-0 flex-wrap items-center gap-3"><code className="min-w-0 flex-1 break-all rounded-xl border border-border bg-card p-3 text-xs">{testerUrl}</code><InviteLinkCopyButton url={testerUrl} label="Copy tester dashboard link" /></div> : null}
        </CardContent>
      </Card> : <p role="status" className="mb-6 rounded-xl border border-border p-4 text-sm">This release is archived and cannot be downloaded. Restore it below when you are ready to share it again.</p>}
      <Card className="mb-6 rounded-[1.75rem] border-brand/25 bg-brand/5">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <Link href={`/builder/apps/${release.project.slug}`} className={cn(buttonVariants({ variant: "secondary" }), "justify-center")}>Back to app</Link>
          <Link href={`/builder/apps/${release.project.slug}/invites?releaseId=${release.id}`} className={cn(buttonVariants({ variant: "secondary" }), "justify-center")}>Manage invite links</Link>
          <Link href={`/builder/apps/${release.project.slug}/groups`} className={cn(buttonVariants({ variant: "secondary" }), "justify-center")}>Manage tester groups</Link>
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Release metadata</CardTitle>
              <Badge variant="brand">{release.status}</Badge>
            </div>
            <CardDescription>Server-side finalized after the APK reached private storage.</CardDescription>
          </CardHeader>
          <CardContent className="grid min-w-0 gap-4 text-sm text-foreground">
            <div className="grid gap-3 sm:grid-cols-2">
              <div><span className="text-muted-foreground">Version</span><div className="mt-1 font-semibold">{release.versionName} ({release.versionCode})</div></div>
              <div><span className="text-muted-foreground">Published</span><div className="mt-1 font-semibold">{format(release.publishedAt, "PPP p")}</div></div>
              <div><span className="text-muted-foreground">APK size</span><div className="mt-1 font-semibold">{release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "Unknown"}</div></div>
              <div><span className="text-muted-foreground">Signature marker</span><div className="mt-1 font-semibold">{release.buildAsset?.hasApkSignature ? "Detected" : "Not detected"}</div></div>
            </div>
            <div className="rounded-[1.3rem] bg-muted/70 p-4 whitespace-pre-wrap leading-7 text-muted-foreground">{release.changelog}</div>
            <details className="min-w-0 rounded-[1.3rem] border border-border bg-card p-4">
              <summary className="cursor-pointer font-semibold">Technical APK details</summary>
              <div className="mt-4 grid min-w-0 gap-3 text-muted-foreground">
                <div>Android package: <span className="break-all font-mono text-foreground">{release.project.androidPackageName ?? "Unknown"}</span></div>
                <div>SDK range: min {release.minSdk ?? "?"} / target {release.targetSdk ?? "?"}</div>
                <div>SHA-256: <span className="break-all font-mono text-foreground">{release.buildAsset?.sha256Checksum ?? "Pending"}</span></div>
              </div>
            </details>
          </CardContent>
        </Card>

        <AccessPolicySummary
          description="Policy-driven rules evaluated server-side before view, download, and feedback access."
          policy={release.accessPolicy}
        />
      </div>

      <details className="mt-6 rounded-[1.75rem] border border-border bg-card p-5">
        <summary className="cursor-pointer font-semibold">Change who can access this release</summary>
        <Card className="mt-4 border-0 shadow-none">
        <CardHeader><CardTitle>Edit access policy</CardTitle><CardDescription>Allowlist entries require a linked wallet. SGT verification checks that wallet, not the phone currently being used.</CardDescription></CardHeader>
        <CardContent>
            <ReleasePolicyEditor
              releaseId={release.id}
              projectSlug={release.project.slug}
              groups={release.project.testerGroups.map((group) => ({ id: group.id, name: group.name }))}
              defaults={{
                requireInviteAcceptance: release.accessPolicy?.requireInviteAcceptance,
                testerGroupId: release.accessPolicy?.testerGroupId,
                requireLinkedWallet: release.accessPolicy?.requireLinkedWallet,
                requireSolanaMobile: release.accessPolicy?.requireSolanaMobile,
                requireVerifiedSeeker: release.accessPolicy?.requireVerifiedSeeker,
                allowPreviousReleases: release.accessPolicy?.allowPreviousReleases,
                walletAllowlist: release.accessPolicy?.walletEntries.map((entry) => entry.address).join("\n"),
              }}
            />
        </CardContent>
        </Card>
      </details>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Beta analytics</CardTitle>
            <CardDescription>Who opened this version, requested a download, and shared feedback.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-foreground">
            <div>Links for this version: {release.inviteLinks.length}</div>
            <div>Invite claims: {analytics.claims}</div>
            <div>Waiting for access: {analytics.pendingClaims}</div>
            <div>Places granted (not revoked): {analytics.grantedPlaces}</div>
            <div>Revoked claims: {analytics.revokedClaims}</div>
            <div>Places used: {analytics.occupiedPlaces}</div>
            <div>Testers with a place: {analytics.uniqueTesters}</div>
            <div>Account viewers: {analytics.viewers.accounts}</div>
            <div>Guest viewers: {analytics.viewers.guests}</div>
            <div>Download links issued: {release.downloadEvents.length}</div>
            <div>Unique downloaders: {analytics.downloaders.total} ({analytics.downloaders.accounts} email / wallet; {analytics.downloaders.guests} guest)</div>
            <div>Feedback reports: {release.feedbackReports.length}</div>
            <details className="text-xs leading-6 text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">How these numbers work</summary>
              <p className="mt-2">The same email or wallet account counts once for this version, including recovered guest activity. Guests are browser identities, not unique people. Events without an account are excluded from unique counts. Download links issued include repeat requests, not confirmed downloads or installs.</p>
              <p className="mt-2">Claims include this version, app-wide invitations and granted invitations allowing access to earlier builds. App-wide places are shared across versions. Revoked places still consume capacity; closing a link does not revoke an existing place. Wallet, group and SGT requirements are checked again before downloading.</p>
            </details>
          </CardContent>
        </Card>
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Feedback reports</CardTitle>
            <CardDescription>Reports attached to this release, ordered from newest to oldest.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {release.feedbackReports.length ? (
              release.feedbackReports.map((report) => (
                <div key={report.id} className="rounded-[1.3rem] border border-border bg-card p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-semibold">{report.title}</div>
                    <Badge variant={report.severity === "CRITICAL" ? "danger" : report.severity === "HIGH" ? "brand" : "neutral"}>
                      {report.severity}
                    </Badge>
                  </div>
                  <div className="mt-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">{report.user.name}</div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{report.description}</p>
                </div>
              ))
            ) : (
              <div className="rounded-[1.3rem] border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No feedback yet for this release.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 rounded-[1.75rem] border-danger/30">
        <CardHeader><CardTitle>Release lifecycle</CardTitle><CardDescription>Archived releases stop appearing to testers. Trashed releases become inaccessible immediately and are purged from R2 after seven days.</CardDescription></CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <form action={setReleaseArchivedAction}><input type="hidden" name="releaseId" value={release.id} /><input type="hidden" name="projectSlug" value={release.project.slug} /><input type="hidden" name="archive" value={String(release.status !== "ARCHIVED")} /><PendingSubmitButton variant="secondary" idleLabel={release.status === "ARCHIVED" ? "Republish release" : "Archive release"} pendingLabel="Updating..." /></form>
          <form action={trashReleaseAction}><input type="hidden" name="releaseId" value={release.id} /><input type="hidden" name="projectSlug" value={release.project.slug} /><PendingSubmitButton variant="danger" idleLabel="Move release to trash" pendingLabel="Moving to trash..." /></form>
        </CardContent>
      </Card>
    </DashboardFrame>
  );
}
