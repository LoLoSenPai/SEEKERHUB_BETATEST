import { notFound } from "next/navigation";
import { format } from "date-fns";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { AccessPolicySummary } from "@/src/features/releases/access-policy-summary";
import { getReleaseForOwner } from "@/src/features/projects/queries";
import { requireSession } from "@/src/lib/session";
import { compactChecksum, formatBytes } from "@/src/lib/utils";

export default async function BuilderReleaseDetailPage({
  params,
}: {
  params: Promise<{ slug: string; releaseId: string }>;
}) {
  const { slug, releaseId } = await params;
  const session = await requireSession();
  const release = await getReleaseForOwner(slug, releaseId, session.user.id);

  if (!release) {
    notFound();
  }

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

      <div className="mt-6 grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>MVP analytics</CardTitle>
            <CardDescription>Simple but structured funnel counts for the beta lifecycle.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm text-foreground">
            <div>Invite links: {release.inviteLinks.length}</div>
            <div>Invite acceptances: {release.inviteLinks.reduce((sum, invite) => sum + invite.inviteClaims.length, 0)}</div>
            <div>Release views: {release.releaseViewEvents.length}</div>
            <div>Downloads: {release.downloadEvents.length}</div>
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
    </DashboardFrame>
  );
}
