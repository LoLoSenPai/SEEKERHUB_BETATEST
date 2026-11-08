import Link from "next/link";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { buttonVariants } from "@/src/components/ui/button";
import { EmptyState } from "@/src/components/ui/empty-state";
import { prisma } from "@/src/lib/db";
import { requireBuilderSession } from "@/src/lib/session";
import { format } from "date-fns";

export default async function BuilderFeedbackPage({ searchParams }: { searchParams: Promise<{ app?: string; cursor?: string }> }) {
  const session = await requireBuilderSession();
  const { app, cursor } = await searchParams;
  const reports = await prisma.feedbackReport.findMany({
    where: { release: { deletedAt: null, project: { ownerId: session.user.id, deletedAt: null, ...(app ? { slug: app } : {}) } },
      ...(cursor ? { id: { lt: cursor } } : {}) },
    include: { release: { select: { id: true, versionName: true, project: { select: { name: true, slug: true } } } } },
    orderBy: { id: "desc" }, take: 51,
  });
  const visible = reports.slice(0, 50);
  return <DashboardFrame kind="builder" currentPath="/builder/feedback" title="Tester feedback" subtitle="What testers found, ready for your next build." identityLabel={session.user.email}>
    {app ? <Link href="/builder/feedback" className="mb-5 inline-block text-sm font-semibold text-brand underline underline-offset-4">Show all apps</Link> : null}
    {visible.length ? <div className="workspace-enter space-y-4">{visible.map(report => <article key={report.id} className="min-w-0 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center gap-3"><Badge>{report.severity}</Badge><Link href={`/builder/apps/${report.release.project.slug}/releases/${report.release.id}`} className="text-xs font-semibold text-brand">{report.release.project.name} · {report.release.versionName}</Link><time className="text-xs text-muted-foreground" dateTime={report.createdAt.toISOString()}>{format(report.createdAt, "MMM d, yyyy")}</time></div>
      <h2 className="mt-3 break-words text-base font-semibold">{report.title}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">{report.description}</p>
    </article>)}{reports.length > 50 ? <Link href={`/builder/feedback?${new URLSearchParams({ ...(app ? { app } : {}), cursor: visible[visible.length - 1].id })}`} className={buttonVariants({ variant: "outline" })}>Older feedback</Link> : null}</div>
      : <EmptyState title="No feedback yet" description="Once testers try a build, their reports will appear here. Share an invite from your app to get started." action={<Link href="/builder" className={buttonVariants()}>Open my apps</Link>} />}
  </DashboardFrame>;
}
