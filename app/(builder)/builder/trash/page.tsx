import { format } from "date-fns";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { restoreProjectAction } from "@/src/features/projects/actions";
import { restoreReleaseAction } from "@/src/features/releases/actions";
import { prisma } from "@/src/lib/db";
import { requireBuilderSession } from "@/src/lib/session";

export default async function BuilderTrashPage() {
  const session = await requireBuilderSession();
  const [projects, releases] = await Promise.all([
    prisma.appProject.findMany({ where: { ownerId: session.user.id, deletedAt: { not: null } }, orderBy: { deletedAt: "desc" } }),
    prisma.release.findMany({
      where: { deletedAt: { not: null }, project: { ownerId: session.user.id, deletedAt: null } },
      include: { project: true },
      orderBy: { deletedAt: "desc" },
    }),
  ]);
  return <DashboardFrame kind="builder" currentPath="/builder/trash" title="Trash" subtitle="Items remain private and count against quota until R2 and database records are purged after seven days."><div className="grid gap-6 lg:grid-cols-2"><Card><CardHeader><CardTitle>Projects</CardTitle><CardDescription>Restoring a project also restores its releases while the purge window is open.</CardDescription></CardHeader><CardContent className="grid gap-3">{projects.length ? projects.map((project) => <div key={project.id} className="rounded-2xl border border-border bg-card p-4"><div className="font-semibold">{project.name}</div><div className="mt-1 text-sm text-muted-foreground">Purge after {project.purgeAfter ? format(project.purgeAfter, "PPP p") : "pending"}</div><form action={restoreProjectAction} className="mt-3"><input type="hidden" name="projectId" value={project.id} /><PendingSubmitButton variant="secondary" size="sm" idleLabel="Restore project" pendingLabel="Restoring..." /></form></div>) : <div className="text-sm text-muted-foreground">No projects in trash.</div>}</CardContent></Card><Card><CardHeader><CardTitle>Releases</CardTitle><CardDescription>Only releases deleted independently are listed here.</CardDescription></CardHeader><CardContent className="grid gap-3">{releases.length ? releases.map((release) => <div key={release.id} className="rounded-2xl border border-border bg-card p-4"><div className="font-semibold">{release.project.name} {release.versionName}</div><div className="mt-1 text-sm text-muted-foreground">Purge after {release.purgeAfter ? format(release.purgeAfter, "PPP p") : "pending"}</div><form action={restoreReleaseAction} className="mt-3"><input type="hidden" name="releaseId" value={release.id} /><PendingSubmitButton variant="secondary" size="sm" idleLabel="Restore release" pendingLabel="Restoring..." /></form></div>) : <div className="text-sm text-muted-foreground">No releases in trash.</div>}</CardContent></Card></div></DashboardFrame>;
}
