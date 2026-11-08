import Link from "next/link";
import { ArrowUpRight, Plus, Upload, Link2, MessageSquare } from "lucide-react";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/src/components/ui/card";
import { EmptyState } from "@/src/components/ui/empty-state";
import { StatCard } from "@/src/components/ui/stat-card";
import { getBuilderDashboard } from "@/src/features/projects/queries";
import { getProjectMedia } from "@/src/features/project-media/queries";
import { AppIcon } from "@/src/features/project-media/app-media";
import { requireBuilderSession } from "@/src/lib/session";
import { formatBytes } from "@/src/lib/utils";

export default async function BuilderDashboardPage() {
  const session = await requireBuilderSession();
  const { projects, stats } = await getBuilderDashboard(session.user.id);
  const media = new Map(await Promise.all(projects.map(async project => [project.id, await getProjectMedia(project.id)] as const)));
  const atProjectQuota = stats.retainedProjectCount >= session.builderProfile.maxProjects;
  return <DashboardFrame kind="builder" currentPath="/builder" title="My apps"
    subtitle="Ship a build. Invite your testers. Make the next version better."
    identityLabel={session.user.email} projectLinks={projects}>
    <div className="workspace-enter space-y-7">
      <section className="app-atmosphere flex flex-col justify-between gap-5 rounded-2xl border border-border p-6 sm:flex-row sm:items-center sm:p-8">
        <div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-600">Your publishing workspace</p><h2 className="mt-2 text-xl font-bold sm:text-2xl">{projects.length ? "Good apps start with real feedback." : "Your next app starts here."}</h2><p className="mt-2 max-w-md text-sm leading-6 text-slate-600">Keep your private builds, testers and feedback in one place.</p></div>
        <Link href={atProjectQuota ? "/builder/trash" : "/builder/apps/new"} className={buttonVariants({ className: "shrink-0 !bg-[#111214] !text-white" })}>{atProjectQuota ? "Review project quota" : <><Plus className="size-4" aria-hidden="true" />New app project</>}</Link>
      </section>
      <section aria-labelledby="projects-heading">
        <div className="mb-4 flex items-center justify-between gap-3"><h2 id="projects-heading" className="text-lg font-bold">Your apps <span className="ml-2 text-sm font-medium text-muted-foreground">{projects.length}</span></h2><span className="text-xs text-muted-foreground">{stats.retainedProjectCount} / {session.builderProfile.maxProjects} projects</span></div>
        {projects.length ? <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">{projects.map(project => {
          const published = project.releases.filter(release => release.status === "PUBLISHED");
          return <Link key={project.id} href={`/builder/apps/${project.slug}`} className="group min-w-0 rounded-2xl border border-border bg-card p-5 transition hover:border-brand/50 focus-visible:outline-2 focus-visible:outline-brand">
            <div className="flex items-start gap-4"><AppIcon media={media.get(project.id) ?? []} name={project.name} /><div className="min-w-0 flex-1"><h3 className="break-words text-lg font-bold">{project.name}</h3><p className="mt-1 line-clamp-2 text-sm leading-6 text-muted-foreground">{project.description || "Add a description to introduce your app."}</p></div><ArrowUpRight className="size-4 shrink-0 text-muted-foreground group-hover:text-brand" aria-hidden="true" /></div>
            <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-4"><Badge variant={published.length ? "success" : "neutral"}>{published.length ? `${published.length} published` : "First build next"}</Badge><span className="text-xs text-muted-foreground">{project.releases.reduce((sum, release) => sum + release.feedbackReports.length, 0)} feedback reports</span></div>
          </Link>;
        })}</div> : <EmptyState title={atProjectQuota ? "No active projects" : "No apps yet"} description={atProjectQuota ? "A project in trash still uses a place until it is purged. Restore it or review your quota." : "Create your app profile, upload a signed APK, then share a private invite."} action={<Link href={atProjectQuota ? "/builder/trash" : "/builder/apps/new"} className={buttonVariants()}>{atProjectQuota ? "Review trash" : "Create first project"}</Link>} />}
      </section>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Testers with access" value={stats.uniqueTesters} hint="Non-revoked invitation places" />
        <StatCard label="Download links issued" value={stats.downloads} hint="Requests, not confirmed installs" />
        <StatCard label="Feedback reports" value={stats.feedback} hint="Across your releases" />
      </div>
      {!projects.length ? <div className="grid gap-5 sm:grid-cols-3">{[{ icon: Upload, title: "1. Upload your APK", text: "We read the version and check the file." }, { icon: Link2, title: "2. Invite testers", text: "Choose the audience, then share your link." }, { icon: MessageSquare, title: "3. Learn and iterate", text: "Read feedback and publish the next build." }].map(({ icon: Icon, title, text }) => <div key={title} className="p-2"><Icon className="mb-3 size-5 text-brand" aria-hidden="true" /><h3 className="text-sm font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{text}</p></div>)}</div> : null}
      <details className="rounded-2xl border border-border bg-card p-5">
        <summary className="cursor-pointer text-sm font-semibold">Detailed activity & counting</summary>
        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <StatCard label="Invite claims" value={stats.claims} hint={`${stats.pendingClaims} waiting / ${stats.grantedPlaces} granted / ${stats.revokedClaims} revoked`} />
          <StatCard label="Places used" value={stats.occupiedPlaces} hint="Revoked places are not released" />
          <StatCard label="Account viewers" value={stats.viewers.accounts} hint="Email or wallet accounts" />
          <StatCard label="Guest viewers" value={stats.viewers.guests} hint="Browser identities, not people" />
          <StatCard label="Unique downloaders" value={stats.uniqueDownloaders} hint={`${stats.downloaders.accounts} accounts; ${stats.downloaders.guests} guests`} />
          <StatCard label="Releases" value={stats.releaseCount} hint="Includes drafts, excludes trash" />
        </div><p className="mt-4 text-xs leading-6 text-muted-foreground">Using the same email or wallet account counts once, including recovered guest activity. Guests are browser identities, not phones or people. Download links count requests, not completed installs. Activity from trash is included; events without an account are excluded from unique counts.</p>
      </details>
      <Card><CardHeader><CardTitle>Storage & limits</CardTitle></CardHeader><CardContent className="mt-3 grid gap-3 sm:grid-cols-3"><p>{stats.retainedReleaseCount} / {session.builderProfile.maxStoredReleases} retained releases</p><p>{formatBytes(session.builderProfile.maxApkBytes)} per APK</p><p>{formatBytes(session.builderProfile.usedStorageBytes + session.builderProfile.reservedStorageBytes)} / {formatBytes(session.builderProfile.maxStorageBytes)} storage</p><p className="text-xs sm:col-span-3">Files in trash still count until their storage is purged. App images share this storage allowance.</p></CardContent></Card>
    </div>
  </DashboardFrame>;
}
