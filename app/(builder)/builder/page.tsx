import Link from "next/link";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { EmptyState } from "@/src/components/ui/empty-state";
import { StatCard } from "@/src/components/ui/stat-card";
import { getBuilderDashboard } from "@/src/features/projects/queries";
import { requireBuilderSession } from "@/src/lib/session";
import { cn, formatBytes, formatRelativeCount } from "@/src/lib/utils";

export default async function BuilderDashboardPage() {
  const session = await requireBuilderSession();
  const { projects, stats } = await getBuilderDashboard(session.user.id);
  const atProjectQuota = stats.retainedProjectCount >= session.builderProfile.maxProjects;

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title="Release operations"
      subtitle="Manage Android projects, upload private APK releases, invite testers, and watch the beta funnel move."
      identityLabel={session.user.email}
    >
      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-3 md:grid-cols-2">
          <StatCard label="Projects" value={stats.projectCount} hint="Builder-owned apps" />
          <StatCard label="Releases" value={stats.releaseCount} hint="Published beta builds" />
          <StatCard label="Claims" value={stats.claims} hint="Invite links accepted" />
          <StatCard label="Granted places" value={stats.grantedPlaces} hint={`${stats.uniqueTesters} unique testers`} />
          <StatCard label="Unique views" value={stats.uniqueViews} hint="Release pages opened" />
          <StatCard label="Download links" value={stats.downloads} hint={`${stats.feedback} feedback reports`} />
        </div>

        <Card className="rounded-[1.75rem]">
          <CardHeader className="flex items-start justify-between gap-4 sm:flex-row">
            <div>
              <CardTitle>Projects</CardTitle>
              <CardDescription>
                Each project owns releases, tester groups, invite links, access policies, and release analytics.
              </CardDescription>
            </div>
            {atProjectQuota ? <span className="rounded-full bg-muted px-4 py-2 text-sm font-semibold text-muted-foreground">Project quota reached</span> : <Link href="/builder/apps/new" className={buttonVariants()}>New app project</Link>}
          </CardHeader>
          <CardContent className="space-y-4">
            {projects.length ? (
              projects.map((project) => (
                <Link
                  key={project.id}
                  href={`/builder/apps/${project.slug}`}
                  className="block rounded-[1.4rem] border border-border bg-card p-5 transition hover:-translate-y-0.5 hover:bg-muted/60 hover:shadow-md"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-2">
                      <div className="flex items-center gap-3">
                        <h3 className="text-xl font-semibold">{project.name}</h3>
                        <Badge variant="brand">{formatRelativeCount(project.releases.length, "release")}</Badge>
                      </div>
                      <p className="max-w-2xl text-sm leading-7 text-muted-foreground">
                        {project.description || "No project description yet."}
                      </p>
                    </div>
                    <div className="grid gap-2 text-right text-sm text-muted-foreground">
                      <div>{project.releases.reduce((sum, release) => sum + release.downloadEvents.length, 0)} downloads</div>
                      <div>{project.releases.reduce((sum, release) => sum + release.feedbackReports.length, 0)} feedback reports</div>
                      <div>{project.releases.reduce((sum, release) => sum + release.inviteLinks.length, 0)} invite links</div>
                    </div>
                  </div>
                </Link>
              ))
            ) : (
              <EmptyState
                title={atProjectQuota ? "No active projects" : "No app projects yet"}
                description={
                  atProjectQuota
                    ? "Your retained project is in the seven-day trash window. Restore it or purge its storage before creating another project."
                    : "Create the first Android project so you can upload a signed APK, define tester access, and start the private beta loop."
                }
                action={
                  <Link href={atProjectQuota ? "/builder/trash" : "/builder/apps/new"} className={cn(buttonVariants())}>
                    {atProjectQuota ? "Review trash" : "Create first project"}
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>
        <Card className="rounded-[1.75rem]"><CardHeader><CardTitle>Builder quota</CardTitle><CardDescription>Trash continues counting until the storage deletion job completes.</CardDescription></CardHeader><CardContent className="grid gap-2 text-sm text-muted-foreground sm:grid-cols-3"><div>{stats.retainedProjectCount} / {session.builderProfile.maxProjects} projects</div><div>{stats.retainedReleaseCount} / {session.builderProfile.maxStoredReleases} retained releases</div><div>{formatBytes(session.builderProfile.usedStorageBytes + session.builderProfile.reservedStorageBytes)} / {formatBytes(session.builderProfile.maxStorageBytes)} storage</div></CardContent></Card>
      </div>
    </DashboardFrame>
  );
}
