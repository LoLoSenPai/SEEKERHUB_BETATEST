import Link from "next/link";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { getAccessibleReleasesForUser, getTesterIdentity } from "@/src/features/projects/queries";
import { prisma } from "@/src/lib/db";
import { requireTesterSession } from "@/src/lib/session";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";

export default async function TesterFeedbackPage() {
  const session = await requireTesterSession("/tester/feedback");
  const [releases, tester, builder] = await Promise.all([
    getAccessibleReleasesForUser(session.user.id),
    getTesterIdentity(session.user.id),
    prisma.builderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } }),
  ]);
  // Only expose project metadata while the current access decision permits it.
  const reports = await prisma.feedbackReport.findMany({ where: { userId: session.user.id, releaseId: { in: releases.map((release) => release.id) } }, orderBy: { createdAt: "desc" }, select: { id: true, releaseId: true, title: true, description: true, severity: true, createdAt: true } });
  const byId = new Map(releases.map((release) => [release.id, release]));
  return <DashboardFrame kind="tester" currentPath="/tester/feedback" title="Feedback" subtitle="Reports you have sent to builders." canBuild={Boolean(builder)} isGuest={Boolean(session.user.isAnonymous)} identityLabel={getTesterIdentityLabel({ ...session.user, wallets: tester?.wallets })} identityWalletAddress={(tester?.wallets.find((wallet) => wallet.isPrimary) ?? tester?.wallets[0])?.address}>
    {reports.length ? <div className="grid gap-4">{reports.map((report) => { const release = byId.get(report.releaseId); if (!release) return null; return <article key={report.id} className="min-w-0 rounded-2xl border border-border bg-card p-5"><div className="flex flex-wrap justify-between gap-2 text-sm text-muted-foreground"><Link href={`/tester/releases/${release.id}`} className="font-semibold text-foreground underline">{release.project.name} · {release.versionName}</Link><time dateTime={report.createdAt.toISOString()}>{report.createdAt.toLocaleDateString()}</time></div><h2 className="mt-3 break-words text-lg font-semibold">{report.title}</h2><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">{report.description}</p><p className="mt-3 text-xs text-muted-foreground">Severity: {report.severity.toLowerCase()}</p></article>; })}</div> : <div className="rounded-2xl border border-border bg-card p-6"><h2 className="font-semibold">No feedback to show yet</h2><p className="mt-2 text-sm text-muted-foreground">After testing an app, open it from My apps to send a report.</p><Link href="/tester" className="mt-4 inline-block text-sm font-semibold underline">Go to My apps</Link></div>}
  </DashboardFrame>;
}
