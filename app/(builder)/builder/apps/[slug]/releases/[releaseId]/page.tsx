import Link from "next/link";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { AccessPolicyFields } from "@/src/features/releases/access-policy-fields";
import { AccessPolicySummary } from "@/src/features/releases/access-policy-summary";
import { getReleaseForOwner } from "@/src/features/projects/queries";
import { requireBuilderSession } from "@/src/lib/session";
import { cn, formatBytes } from "@/src/lib/utils";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { setReleaseArchivedAction, trashReleaseAction, updateReleasePolicyAction } from "@/src/features/releases/actions";

export default async function BuilderReleaseDetailPage({
  params,
}: {
  params: Promise<{ slug: string; releaseId: string }>;
}) {
  const { slug, releaseId } = await params;
  const session = await requireBuilderSession();
  const release = await getReleaseForOwner(slug, releaseId, session.user.id);

  if (!release) {
    notFound();
  }
  const claims = release.inviteLinks.flatMap((invite) => invite.inviteClaims);
  const uniqueTesterIds = new Set(claims.filter((claim) => claim.grantedAt && !claim.revokedAt).map((claim) => claim.userId));
  const uniqueViewerIds = new Set(release.releaseViewEvents.map((event) => event.userId).filter(Boolean));

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={`${release.project.name} ${release.versionName}`}
      subtitle="Release metadata, access policy, and the first analytics loop in one view."
      identityLabel={session.user.email}
    >
      <Card className="mb-6 rounded-[1.75rem] border-brand/25 bg-brand/5">
        <CardContent className="grid gap-4 p-5 sm:grid-cols-3">
          <Link href={`/builder/apps/${release.project.slug}`} className={cn(buttonVariants({ variant: "secondary" }), "justify-center")}>Back to app</Link>
          <Link href={`/builder/apps/${release.project.slug}/invites`} className={cn(buttonVariants(), "justify-center")}>Create or copy invite</Link>
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

      <Card className="mt-6 rounded-[1.75rem]">
        <CardHeader><CardTitle>Edit access policy</CardTitle><CardDescription>Allowlist entries automatically require a linked wallet. Device capability remains advisory; only a current SGT proof is a Seeker gate.</CardDescription></CardHeader>
        <CardContent>
          <form action={updateReleasePolicyAction} className="grid gap-5">
            <input type="hidden" name="releaseId" value={release.id} />
            <input type="hidden" name="projectSlug" value={release.project.slug} />
            <AccessPolicyFields
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
            <PendingSubmitButton idleLabel="Save access policy" pendingLabel="Saving policy..." />
          </form>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>MVP analytics</CardTitle>
            <CardDescription>Simple but structured funnel counts for the beta lifecycle.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-foreground">
            <div>Invite links: {release.inviteLinks.length}</div>
            <div>Claims: {claims.length}</div>
            <div>Granted places: {claims.filter((claim) => Boolean(claim.grantedAt)).length}</div>
            <div>Unique testers: {uniqueTesterIds.size}</div>
            <div>Unique viewers: {uniqueViewerIds.size}</div>
            <div>Download links issued: {release.downloadEvents.length}</div>
            <div>Feedback reports: {release.feedbackReports.length}</div>
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
