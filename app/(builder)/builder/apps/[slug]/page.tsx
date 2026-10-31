import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { BuilderJourney } from "@/src/components/layout/builder-journey";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { ProjectForm } from "@/src/features/projects/project-form";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { deleteProjectAction } from "@/src/features/projects/actions";
import { requireBuilderSession } from "@/src/lib/session";
import { formatBytes } from "@/src/lib/utils";

export default async function BuilderProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams?: Promise<{ deleteError?: string }>;
}) {
  const { slug } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const session = await requireBuilderSession();
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
      identityLabel={session.user.email}
    >
      <BuilderJourney
        projectSlug={project.slug}
        current="release"
        releaseCount={project.releases.length}
        inviteCount={project.inviteLinks.length}
        downloadCount={project.releases.reduce((total, release) => total + release.downloadEvents.length, 0)}
      />
      <div className="flex flex-col gap-6">
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
            {project.androidPackageName ? <div className="sm:col-span-2 rounded-[1.2rem] border border-border bg-muted/50 p-4 text-sm"><span className="font-semibold">Bound Android package:</span> <span className="break-all font-mono">{project.androidPackageName}</span></div> : null}
            <Link href={`/builder/apps/${project.slug}/groups`} className="rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60">
              <div className="font-semibold">Tester groups</div>
              <div className="mt-2 text-sm text-muted-foreground">{project.testerGroups.length} groups configured</div>
            </Link>
            <Link href={`/builder/apps/${project.slug}/invites`} className="rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60">
              <div className="font-semibold">Invite links</div>
              <div className="mt-2 text-sm text-muted-foreground">{project.inviteLinks.length} shareable private links</div>
            </Link>
            <div className="sm:col-span-2 text-sm text-muted-foreground">{project.releases.reduce((total, release) => total + release.feedbackReports.length, 0)} feedback reports across releases</div>
          </CardContent>
        </Card>
      <Card id="releases" className="rounded-[1.75rem]">
        <CardHeader>
          <CardTitle>Releases</CardTitle>
          <CardDescription>Latest APK builds, access policies, and the release analytics that matter in the beta loop.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {project.releases.length ? (
            [...project.releases].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).map((release) => (
              <Link
                key={release.id}
                href={`/builder/apps/${project.slug}/releases/${release.id}`}
                className="block rounded-[1.4rem] border border-border bg-card p-5 transition hover:bg-muted/60 hover:shadow-md"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <h3 className="min-w-0 max-w-full break-words text-lg font-semibold">
                        {release.versionName} ({release.versionCode})
                      </h3>
                      <Badge variant="brand">{release.status}</Badge>
                    </div>
                    <p className="break-words text-sm leading-7 text-muted-foreground line-clamp-2">{release.changelog}</p>
                  </div>
                  <div className="grid gap-2 text-sm text-muted-foreground lg:text-right">
                    {release.status === "DRAFT" ? <div className="font-semibold text-foreground">Resume draft</div> : <><div>{release.downloadEvents.length} download links</div><div>{release.feedbackReports.length} feedback reports</div></>}
                    <div>{release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "No asset"}</div>
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
        <section id="settings" className="scroll-mt-4 rounded-[1.75rem] border border-border bg-card p-4">
          <h2 className="font-semibold">Project settings and danger zone</h2>
          <div className="mt-4 grid gap-6 xl:grid-cols-2">
          <Card className="rounded-[1.75rem]">
            <CardHeader>
              <CardTitle>Project settings</CardTitle>
              <CardDescription>Update the core project details that anchor releases, invite links, and tester groups.</CardDescription>
            </CardHeader>
            <CardContent>
              <ProjectForm project={{ id: project.id, name: project.name, description: project.description }} />
            </CardContent>
          </Card>

          <Card className="rounded-[1.75rem] border-danger/30">
            <CardHeader>
              <CardTitle>Danger zone</CardTitle>
              <CardDescription>
                Move this project and its releases to the seven-day trash. Tester access stops immediately.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form action={deleteProjectAction} className="grid gap-5">
                <input type="hidden" name="projectId" value={project.id} />
                <div className="rounded-[1.25rem] border border-danger/20 bg-danger/5 px-4 py-3 text-sm text-muted-foreground">
                  Type <span className="break-all font-semibold text-foreground">{project.name}</span> to confirm. Storage still counts against quota until purge.
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
                  idleLabel="Move project to trash"
                  pendingLabel="Moving to trash..."
                />
              </form>
            </CardContent>
          </Card>
          </div>
        </section>

      </div>
    </DashboardFrame>
  );
}
