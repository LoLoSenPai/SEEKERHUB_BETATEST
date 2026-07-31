import { notFound } from "next/navigation";
import { format } from "date-fns";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { AccessPolicySummary } from "@/src/features/releases/access-policy-summary";
import { getReleaseForOwner } from "@/src/features/projects/queries";
import { requireBuilderSession } from "@/src/lib/session";
import { compactChecksum, formatBytes } from "@/src/lib/utils";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
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
    >
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Release metadata</CardTitle>
              <Badge variant="brand">{release.status}</Badge>
            </div>
            <CardDescription>Server-side finalized after the APK reached private storage.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 text-sm text-foreground">
            <div>Version name: {release.versionName}</div>
            <div>Version code: {release.versionCode}</div>
            <div>Android package: {release.project.androidPackageName ?? "Unknown"}</div>
            <div>SDK range: min {release.minSdk ?? "?"} / target {release.targetSdk ?? "?"}</div>
            <div>APK signature marker: {release.buildAsset?.hasApkSignature ? "Detected" : "Not detected"}</div>
            <div>Published: {format(release.publishedAt, "PPP p")}</div>
            <div>File size: {release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "Unknown"}</div>
            <div>Checksum: {release.buildAsset ? release.buildAsset.sha256Checksum : "Pending"}</div>
            <div>Compact checksum: {release.buildAsset ? compactChecksum(release.buildAsset.sha256Checksum) : "Pending"}</div>
            <div className="rounded-[1.3rem] bg-muted/70 p-4 whitespace-pre-wrap leading-7 text-muted-foreground">{release.changelog}</div>
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
            <div className="grid gap-2"><Label htmlFor="testerGroupId">Tester group</Label><Select id="testerGroupId" name="testerGroupId" defaultValue={release.accessPolicy?.testerGroupId ?? ""}><option value="">No group restriction</option>{release.project.testerGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</Select></div>
            <div className="grid gap-2"><Label htmlFor="walletAllowlist">Wallet allowlist</Label><Textarea id="walletAllowlist" name="walletAllowlist" defaultValue={release.accessPolicy?.walletEntries.map((entry) => entry.address).join("\n") ?? ""} placeholder="One Solana address per line" /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex items-center gap-3 text-sm"><Input type="checkbox" name="requireInviteAcceptance" className="size-4" defaultChecked={release.accessPolicy?.requireInviteAcceptance} />Require invite acceptance</label>
              <label className="flex items-center gap-3 text-sm"><Input type="checkbox" name="requireLinkedWallet" className="size-4" defaultChecked={release.accessPolicy?.requireLinkedWallet} />Require linked wallet</label>
              <label className="flex items-center gap-3 text-sm"><Input type="checkbox" name="requireVerifiedSeeker" className="size-4" defaultChecked={release.accessPolicy?.requireVerifiedSeeker} />Require current SGT proof</label>
              <label className="flex items-center gap-3 text-sm"><Input type="checkbox" name="requireSolanaMobile" className="size-4" defaultChecked={release.accessPolicy?.requireSolanaMobile} />Recommend Solana Mobile</label>
              <label className="flex items-center gap-3 text-sm"><Input type="checkbox" name="allowPreviousReleases" className="size-4" defaultChecked={release.accessPolicy?.allowPreviousReleases} />Allow previous builds</label>
            </div>
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
