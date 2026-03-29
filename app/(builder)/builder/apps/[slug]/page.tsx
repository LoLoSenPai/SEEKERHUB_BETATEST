import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { Textarea } from "@/src/components/ui/textarea";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { deleteProjectAction, updateProjectAction } from "@/src/features/projects/actions";
import { requireSession } from "@/src/lib/session";
import { compactChecksum, formatBytes } from "@/src/lib/utils";

export default async function BuilderProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ deleteError?: string }>;
}) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const session = await requireSession();
  const project = await getProjectForOwner(slug, session.user.id);

  if (!project) {
    notFound();
  }

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={project.name}
      subtitle={project.description || "No project description yet."}
    >
      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="grid gap-6">
          <Card className="rounded-[1.75rem]">
            <CardHeader>
              <CardTitle>Project settings</CardTitle>
              <CardDescription>Update the core project details that anchor releases, invite links, and tester groups.</CardDescription>
            </CardHeader>
            <CardContent>
              <form action={updateProjectAction} className="grid gap-5">
                <input type="hidden" name="projectId" value={project.id} />
                <div className="grid gap-2">
                  <Label htmlFor="name">App name</Label>
                  <Input id="name" name="name" defaultValue={project.name} required />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea id="description" name="description" defaultValue={project.description ?? ""} />
                </div>
                <PendingSubmitButton idleLabel="Save project" pendingLabel="Saving project..." />
              </form>
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-danger/30">
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>
                Delete this project and all related releases, invite links, tester memberships, and feedback records.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={deleteProjectAction} className="grid gap-5">
                <input type="hidden" name="projectId" value={project.id} />
                <div className="rounded-[1.25rem] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-muted-foreground">
                  This action is irreversible. Type <span className="font-semibold text-foreground">{project.name}</span> to confirm.
                </div>
                {resolvedSearchParams?.deleteError === "confirmation" ? (
                  <div className="rounded-[1.25rem] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-danger">
                    The confirmation text did not match the project name.
                  </div>
                ) : null}
                <div className="grid gap-2">
                  <Label htmlFor="confirmation">Project name confirmation</Label>
                  <Input id="confirmation" name="confirmation" placeholder={project.name} required />
                </div>
                <PendingSubmitButton
                  variant="danger"
                  idleLabel="Delete project"
                  pendingLabel="Deleting project..."
                />
              </form>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-[1.75rem]">
          <CardHeader className="flex items-start justify-between gap-4 sm:flex-row">
            <div>
              <CardTitle>Project operations</CardTitle>
              <CardDescription>Jump into the release upload flow or manage tester routing.</CardDescription>
            </div>
            <Link href={`/builder/apps/${project.slug}/releases/new`} className={buttonVariants()}>
              Upload release
            </Link>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Link href={`/builder/apps/${project.slug}/groups`} className="rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60">
              <div className="font-semibold">Tester groups</div>
              <div className="mt-2 text-sm text-muted-foreground">{project.testerGroups.length} groups configured</div>
            </Link>
            <Link href={`/builder/apps/${project.slug}/invites`} className="rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60">
              <div className="font-semibold">Invite links</div>
              <div className="mt-2 text-sm text-muted-foreground">{project.inviteLinks.length} shareable private links</div>
            </Link>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 rounded-[1.75rem]">
        <CardHeader>
          <CardTitle>Releases</CardTitle>
          <CardDescription>Latest APK builds, access policies, and the release analytics that matter in the beta loop.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {project.releases.length ? (
            project.releases.map((release) => (
              <Link
                key={release.id}
                href={`/builder/apps/${project.slug}/releases/${release.id}`}
                className="block rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60 hover:shadow-md"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <h3 className="text-lg font-semibold">
                        {release.versionName} ({release.versionCode})
                      </h3>
                      <Badge variant="brand">{release.status}</Badge>
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground line-clamp-2">{release.changelog}</p>
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground lg:text-right">
                    <div>{release.downloadEvents.length} downloads</div>
                    <div>{release.feedbackReports.length} feedback reports</div>
                    <div>{release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "No asset"}</div>
                    <div>{release.buildAsset ? compactChecksum(release.buildAsset.sha256Checksum) : "Checksum pending"}</div>
                  </div>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-[1.4rem] border border-dashed border-border bg-card px-6 py-10 text-center text-muted-foreground">
              No releases yet. Upload the first APK to start the private beta workflow.
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardFrame>
  );
}
