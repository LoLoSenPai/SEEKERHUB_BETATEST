import Link from "next/link";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { EmptyState } from "@/src/components/ui/empty-state";
import { StatCard } from "@/src/components/ui/stat-card";
import { getBuilderDashboard } from "@/src/features/projects/queries";
import { requireSession } from "@/src/lib/session";
import { cn, formatRelativeCount } from "@/src/lib/utils";

export default async function BuilderDashboardPage() {
  const session = await requireSession();
  const { projects, stats } = await getBuilderDashboard(session.user.id);

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title="Release operations"
      subtitle="Manage Android projects, upload private APK releases, invite testers, and watch the beta funnel move."
    >
      <div className="space-y-6">
        <div className="grid gap-4 xl:grid-cols-4 md:grid-cols-2">
          <StatCard label="Projects" value={stats.projectCount} hint="Builder-owned apps" />
          <StatCard label="Releases" value={stats.releaseCount} hint="Published beta builds" />
          <StatCard label="Invite accepts" value={stats.invitesAccepted} hint="Tester claims recorded" />
          <StatCard label="Downloads" value={stats.downloads} hint="Private APK deliveries" />
        </div>

        <Card className="rounded-[1.75rem]">
          <CardHeader className="flex items-start justify-between gap-4 sm:flex-row">
            <div>
              <CardTitle>Projects</CardTitle>
              <CardDescription>
                Each project owns releases, tester groups, invite links, access policies, and release analytics.
              </CardDescription>
            </div>
            <Link href="/builder/apps/new" className={buttonVariants()}>
              New app project
            </Link>
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
                title="No app projects yet"
                description="Create the first Android project so you can upload a signed APK, define tester access, and start the private beta loop."
                action={
                  <Link href="/builder/apps/new" className={cn(buttonVariants())}>
                    Create first project
                  </Link>
                }
              />
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardFrame>
  );
}
