import Link from "next/link";
import { format } from "date-fns";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import {
  purgeStorageTaskAction,
  setBuilderStatusAction,
  updateBuilderQuotaAction,
} from "@/src/features/admin/actions";
import { prisma } from "@/src/lib/db";
import { requireAdminSession } from "@/src/lib/session";
import { formatBytes } from "@/src/lib/utils";

export default async function AdminPage() {
  await requireAdminSession();
  const [builders, tasks, audit] = await Promise.all([
    prisma.builderProfile.findMany({
      include: { user: { include: { _count: { select: { ownedProjects: true } } } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.storageDeletionTask.findMany({
      where: { status: { not: "COMPLETED" } },
      orderBy: { scheduledFor: "asc" },
      take: 50,
    }),
    prisma.auditLog.findMany({
      include: { actor: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  return (
    <main className="page-shell">
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-[1.75rem] border border-border bg-surface p-5">
        <div>
          <div className="section-eyebrow">Internal administration</div>
          <h1 className="mt-2 text-3xl font-semibold">Public beta controls</h1>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link href="/builder" className="text-sm font-semibold">Builder workspace</Link>
        </div>
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader>
            <CardTitle>Builders and quotas</CardTitle>
            <CardDescription>Suspension blocks builder operations but does not mutate tester history.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            {builders.map((profile) => (
              <div key={profile.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">{profile.user.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {profile.user.email} / {profile.status} / {profile.user._count.ownedProjects} projects
                    </div>
                  </div>
                  <form action={setBuilderStatusAction}>
                    <input type="hidden" name="profileId" value={profile.id} />
                    <input type="hidden" name="status" value={profile.status === "ACTIVE" ? "SUSPENDED" : "ACTIVE"} />
                    <PendingSubmitButton
                      variant={profile.status === "ACTIVE" ? "danger" : "secondary"}
                      size="sm"
                      idleLabel={profile.status === "ACTIVE" ? "Suspend" : "Reactivate"}
                      pendingLabel="Updating..."
                    />
                  </form>
                </div>
                <div className="mt-3 text-sm text-muted-foreground">
                  Used {formatBytes(profile.usedStorageBytes)} / reserved {formatBytes(profile.reservedStorageBytes)} / limit {formatBytes(profile.maxStorageBytes)}
                </div>
                <form action={updateBuilderQuotaAction} className="mt-3 grid gap-2 sm:grid-cols-4">
                  <input type="hidden" name="profileId" value={profile.id} />
                  <Input name="maxProjects" type="number" min="0" defaultValue={profile.maxProjects} aria-label="Project quota" />
                  <Input name="maxStoredReleases" type="number" min="0" defaultValue={profile.maxStoredReleases} aria-label="Release quota" />
                  <Input name="maxStorageMiB" type="number" min="0" defaultValue={Number(profile.maxStorageBytes / 1024n / 1024n)} aria-label="Storage quota MiB" />
                  <PendingSubmitButton variant="secondary" idleLabel="Save quotas" pendingLabel="Saving..." />
                </form>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Deletion queue</CardTitle>
            <CardDescription>Immediate purge is irreversible and requires explicit confirmation.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {tasks.length ? tasks.map((task) => (
              <div key={task.id} className="rounded-2xl border border-border bg-card p-4">
                <div className="font-semibold">{task.resourceType}</div>
                <div className="mt-1 break-all text-xs text-muted-foreground">{task.storageKey}</div>
                <div className="mt-2 text-xs text-muted-foreground">
                  {task.status} / scheduled {format(task.scheduledFor, "PPP p")}
                </div>
                <form action={purgeStorageTaskAction} className="mt-3 flex gap-2">
                  <input type="hidden" name="taskId" value={task.id} />
                  <Input name="confirmation" placeholder="Type PURGE" required />
                  <PendingSubmitButton variant="danger" size="sm" idleLabel="Purge now" pendingLabel="Purging..." />
                </form>
              </div>
            )) : <div className="text-sm text-muted-foreground">Deletion queue is empty.</div>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Audit trail</CardTitle>
          <CardDescription>Recent privileged and lifecycle events.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {audit.map((entry) => (
            <div key={entry.id} className="grid gap-1 rounded-xl border border-border bg-card px-4 py-3 text-sm sm:grid-cols-[180px_1fr_1fr]">
              <span>{format(entry.createdAt, "PPP p")}</span>
              <span className="font-mono text-xs">{entry.action}</span>
              <span className="text-muted-foreground">
                {entry.actor?.email ?? "system"} / {entry.targetType} {entry.targetId ?? ""}
              </span>
            </div>
          ))}
        </CardContent>
      </Card>
    </main>
  );
}
