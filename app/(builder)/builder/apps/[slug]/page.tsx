import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, Check, Download, Link2, MessageSquare, Plus, Upload } from "lucide-react";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { BuilderJourney } from "@/src/components/layout/builder-journey";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { ProjectForm } from "@/src/features/projects/project-form";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { deleteProjectAction } from "@/src/features/projects/actions";
import { getProjectMedia } from "@/src/features/project-media/queries";
import { AppIcon, AppBanner, AppScreenshots } from "@/src/features/project-media/app-media";
import { ProjectMediaManager } from "@/src/features/project-media/project-media-manager";
import { requireBuilderSession } from "@/src/lib/session";
import { cn, formatBytes } from "@/src/lib/utils";

export default async function BuilderProjectPage({ params, searchParams }: {
  params: Promise<{ slug: string }>; searchParams?: Promise<{ deleteError?: string }>;
}) {
  const { slug } = await params;
  const query = searchParams ? await searchParams : undefined;
  const session = await requireBuilderSession();
  const project = await getProjectForOwner(slug, session.user.id);
  if (!project) notFound();
  const media = await getProjectMedia(project.id);
  const base = `/builder/apps/${project.slug}`;
  const published = project.releases.filter(release => release.status === "PUBLISHED");
  const hasInvite = project.inviteLinks.some(invite => !invite.revokedAt && (!invite.expiresAt || invite.expiresAt > new Date()) && (!invite.maxUses || invite.inviteClaims.filter(claim => claim.grantedAt).length < invite.maxUses));
  const feedbackCount = project.releases.reduce((sum, release) => sum + release.feedbackReports.length, 0);
  const nextStep = !published.length ? 0 : !hasInvite ? 1 : 2;

  return <DashboardFrame kind="builder" currentPath={base} title={project.name} subtitle="Your app, from first build to useful feedback." compactHeader
    identityLabel={session.user.email} projectLinks={[project]}>
    <div className="workspace-enter">
      <section className="app-atmosphere mb-5 flex min-w-0 items-center gap-4 rounded-2xl border border-border p-5 sm:gap-5 sm:p-7">
        <AppIcon media={media} name={project.name} className="size-16 bg-white sm:size-20" />
        <div className="min-w-0"><h1 className="break-words text-2xl font-bold sm:text-3xl">{project.name}</h1><p className="mt-1 max-w-2xl break-words text-sm leading-6 text-slate-700">{project.description || "Introduce your app to your testers."}</p><Link href="#settings" className="mt-2 inline-block text-xs font-semibold underline underline-offset-4">Edit app profile</Link></div>
      </section>
      <BuilderJourney projectSlug={project.slug} current="release" releaseCount={project.releases.length} inviteCount={project.inviteLinks.length} />
      <div className="grid min-w-0 gap-7 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-6">
          <section className="flex flex-col justify-between gap-4 rounded-xl border border-brand/15 bg-brand-soft p-4 sm:flex-row sm:items-center" aria-label="Next step">
            <div><h2 className="text-sm font-bold">{nextStep === 0 ? "Start with your first build." : nextStep === 1 ? "Build published. Next: invite testers." : "Your beta is ready to share."}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{nextStep === 0 ? "Upload an APK. We will read its version and package." : nextStep === 1 ? "Choose who can join, then share a private link." : "Keep the invitation handy and check back for feedback."}</p></div>
            <Link href={nextStep === 0 ? `${base}/releases/new` : `${base}/invites`} className={buttonVariants({ size: "sm", className: "shrink-0" })}>{nextStep === 0 ? "Upload release" : nextStep === 1 ? "Create invite link" : "Manage invite links"}</Link>
          </section>
          <ol aria-label="Publishing steps" className="grid grid-cols-3 gap-2">{["Upload", "Invite", "Feedback"].map((label, index) => <li key={label} className="flex items-center gap-2 text-xs font-semibold"><span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full", index <= nextStep ? "bg-warm text-warm-foreground" : "bg-muted text-muted-foreground")}>{index < nextStep ? <Check className="size-4" aria-label="Complete" /> : index + 1}</span>{label}</li>)}</ol>
          <section id="releases" className="scroll-mt-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-xl font-bold">Releases</h2>{published.length ? <Link href={`${base}/releases/new`} className={buttonVariants({ variant: "outline", size: "sm" })}><Plus className="size-4" aria-hidden="true" />Upload release</Link> : null}</div>
            {project.releases.length ? <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="hidden grid-cols-[1fr_1fr_80px_32px] gap-3 border-b border-border px-5 py-3 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground sm:grid"><span>Version</span><span>Status</span><span>Size</span><span className="sr-only">Open</span></div>
              {[...project.releases].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).map(release => <Link key={release.id} href={`${base}/releases/${release.id}`} className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-3 border-b border-border px-5 py-4 last:border-b-0 hover:bg-muted/70 sm:grid-cols-[1fr_1fr_80px_32px]">
                <div className="min-w-0"><h3 className="break-words text-sm font-bold">{release.versionName}</h3><span className="text-xs text-muted-foreground">{release.status === "DRAFT" ? "Resume draft" : `${release.feedbackReports.length} feedback reports`}</span></div>
                <div><Badge variant={release.status === "PUBLISHED" ? "success" : "neutral"} className="text-[10px] tracking-normal">{release.status}</Badge></div>
                <span className="text-xs text-muted-foreground">{release.buildAsset ? formatBytes(release.buildAsset.fileSizeBytes) : "No APK yet"}</span><ArrowUpRight className="size-4 justify-self-end text-muted-foreground" aria-hidden="true" />
              </Link>)}
            </div> : <div className="rounded-2xl border border-dashed border-border bg-card px-6 py-9 text-center"><Upload className="mx-auto mb-3 size-6 text-brand" aria-hidden="true" /><h3 className="font-semibold">No builds yet</h3><p className="mt-2 text-sm text-muted-foreground">Your first upload will appear here. It stays a draft until you publish.</p></div>}
          </section>
          <section><h2 className="mb-4 text-lg font-bold">What happens next?</h2><div className="space-y-4">{[
            { icon: Link2, title: "Share your invite", text: "Send a private link with the audience rules you choose.", href: `${base}/invites` },
            { icon: Download, title: "Testers install the APK", text: "They open the link on Android and download the build.", href: `${base}/groups` },
            { icon: MessageSquare, title: "Review their feedback", text: `${feedbackCount} reports so far. Learn what to improve for the next build.`, href: `/builder/feedback?app=${encodeURIComponent(project.slug)}` },
          ].map(({ icon: Icon, title, text, href }) => <Link key={title} href={href} className="group flex items-start gap-3 rounded-xl p-2 hover:bg-muted"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-warm text-warm-foreground"><Icon className="size-5" aria-hidden="true" /></span><div><h3 className="text-sm font-semibold group-hover:underline">{title}</h3><p className="mt-0.5 text-xs leading-5 text-muted-foreground">{text}</p></div></Link>)}</div></section>
        </div>
        <aside className="min-w-0 border-t border-border pt-6 xl:border-t-0 xl:border-l xl:pt-0 xl:pl-6" aria-label="App presentation">
          <h2 className="mb-4 text-lg font-bold">App presentation</h2><AppBanner media={media} className="aspect-[16/7]" />
          <div className="my-4 flex min-w-0 items-center gap-3"><AppIcon media={media} name={project.name} className="size-12" /><div className="min-w-0"><h3 className="break-words font-bold">{project.name}</h3><p className="text-xs text-muted-foreground">As seen by your invited testers</p></div></div>
          <AppScreenshots media={media} />
          {!media.some(item => item.kind === "SCREENSHOT") ? <p className="rounded-xl border border-dashed border-border p-4 text-xs leading-6 text-muted-foreground">Add real screenshots to show testers what your app does. A simple fallback is shown until you add your own images.</p> : null}
          <Link href="#images" className="mt-3 inline-block text-xs font-semibold underline underline-offset-4">Manage app images</Link>
        </aside>
      </div>
      <section id="settings" className="mt-10 scroll-mt-5 border-t border-border pt-8">
        <h2 className="text-xl font-bold">App profile</h2><p className="mb-5 mt-1 text-sm text-muted-foreground">Help testers recognize what they are downloading.</p>
        <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          <div className="rounded-2xl border border-border bg-card p-5"><ProjectForm project={{ id: project.id, name: project.name, description: project.description }} />{project.androidPackageName ? <p className="mt-4 break-all text-xs text-muted-foreground">Android package: {project.androidPackageName}</p> : null}</div>
          <div id="images" className="min-w-0 scroll-mt-5 rounded-2xl border border-border bg-card p-5"><ProjectMediaManager projectId={project.id} initialMedia={media} /></div>
        </div>
        <details className="mt-6 rounded-2xl border border-danger/20 bg-card p-5" open={query?.deleteError === "confirmation" || undefined}>
          <summary className="cursor-pointer text-sm font-semibold text-danger">Move this app to trash</summary>
          <p className="my-4 text-sm text-muted-foreground">Tester access stops immediately. Files stay in trash for seven days and still count against storage until purged.</p>
          <form action={deleteProjectAction} className="grid max-w-md gap-4">
            <input type="hidden" name="projectId" value={project.id} />
            {query?.deleteError === "confirmation" ? <p role="alert" className="text-sm text-danger">The confirmation did not match the project name.</p> : null}
            <div className="grid gap-2"><Label htmlFor="confirmation">Type {project.name} to confirm</Label><Input id="confirmation" name="confirmation" placeholder={project.name} required /></div>
            <PendingSubmitButton variant="danger" idleLabel="Move project to trash" pendingLabel="Moving to trash..." />
          </form>
        </details>
      </section>
    </div>
  </DashboardFrame>;
}
