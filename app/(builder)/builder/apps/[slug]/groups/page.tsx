import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { FieldLabel } from "@/src/components/ui/field-help";
import { Input } from "@/src/components/ui/input";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { Textarea } from "@/src/components/ui/textarea";
import {
  createTesterGroupAction,
  deleteTesterGroupAction,
  reactivateTesterAccessAction,
  revokeTesterAccessAction,
  updateTesterGroupAction,
} from "@/src/features/groups/actions";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { requireBuilderSession } from "@/src/lib/session";

export default async function GroupsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireBuilderSession();
  const project = await getProjectForOwner(slug, session.user.id);

  if (!project) {
    notFound();
  }

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={`${project.name} tester groups`}
      subtitle="Build reusable cohorts such as internal QA, creators, or community testers."
      identityLabel={session.user.email}
    >
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Create tester group</CardTitle>
            <CardDescription>Create a group, select it on a release, then create an invite using that same group.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createTesterGroupAction} className="grid gap-5">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="projectSlug" value={project.slug} />
              <div className="grid gap-2">
                <FieldLabel htmlFor="name" helpTitle="Group name" help="Use a stable cohort name such as Internal QA or Community Alpha. Testers do not need to enter it themselves.">Name</FieldLabel>
                <Input id="name" name="name" placeholder="Core QA" required />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="description" helpTitle="Group purpose" help="Optional internal note explaining who belongs in this cohort and what they should test.">Description</FieldLabel>
                <Textarea id="description" name="description" placeholder="Who belongs to this cohort?" />
              </div>
              <PendingSubmitButton idleLabel="Create group" pendingLabel="Creating group..." />
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Existing groups</CardTitle>
            <CardDescription>Simple reusable cohorts that can be attached to release policies or invite links.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {project.testerGroups.length ? (
              project.testerGroups.map((group) => (
                <div key={group.id} className="rounded-[1.4rem] border border-border bg-card p-4">
                  <form action={updateTesterGroupAction} className="grid gap-3">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="projectSlug" value={project.slug} />
                    <Input name="name" defaultValue={group.name} aria-label={`${group.name} name`} required />
                    <Textarea name="description" defaultValue={group.description ?? ""} aria-label={`${group.name} description`} />
                    <PendingSubmitButton variant="secondary" idleLabel="Save group" pendingLabel="Saving..." />
                  </form>
                  <div className="mt-4 border-t border-border pt-4">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Active testers</div>
                    <div className="mt-3 grid gap-2">
                      {group.memberships.length ? group.memberships.map((membership) => (
                        <div key={membership.id} className="flex items-center justify-between gap-3 rounded-xl bg-muted/60 px-3 py-2 text-sm">
                          <span className="truncate">{membership.user.email}</span>
                          <form action={revokeTesterAccessAction}>
                            <input type="hidden" name="projectId" value={project.id} />
                            <input type="hidden" name="projectSlug" value={project.slug} />
                            <input type="hidden" name="userId" value={membership.userId} />
                            <PendingSubmitButton variant="danger" size="sm" idleLabel="Revoke" pendingLabel="Revoking..." />
                          </form>
                        </div>
                      )) : <div className="text-sm text-muted-foreground">No granted testers in this group.</div>}
                    </div>
                  </div>
                  <form action={deleteTesterGroupAction} className="mt-4">
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="projectSlug" value={project.slug} />
                    <PendingSubmitButton variant="danger" size="sm" idleLabel="Delete unused group" pendingLabel="Deleting..." />
                  </form>
                </div>
              ))
            ) : (
              <div className="rounded-[1.3rem] border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No tester groups yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6 rounded-[1.75rem]">
        <CardHeader>
          <CardTitle>Project tester access</CardTitle>
          <CardDescription>
            Revocation applies to every current and future invite link for this project. Reactivation permits a new claim but does not restore old claims automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {project.testerAccesses.length ? project.testerAccesses.map((access) => (
            <div key={access.id} className="flex flex-wrap items-center justify-between gap-3 rounded-[1.2rem] border border-border bg-card p-4">
              <div>
                <div className="font-medium text-foreground">{access.user.email}</div>
                <div className="mt-1 text-xs text-muted-foreground">{access.revokedAt ? "Access revoked" : "Access active"}</div>
              </div>
              <form action={access.revokedAt ? reactivateTesterAccessAction : revokeTesterAccessAction}>
                <input type="hidden" name="projectId" value={project.id} />
                <input type="hidden" name="projectSlug" value={project.slug} />
                <input type="hidden" name="userId" value={access.userId} />
                <PendingSubmitButton
                  variant={access.revokedAt ? "secondary" : "danger"}
                  size="sm"
                  idleLabel={access.revokedAt ? "Reactivate" : "Revoke project access"}
                  pendingLabel={access.revokedAt ? "Reactivating..." : "Revoking..."}
                />
              </form>
            </div>
          )) : (
            <div className="rounded-[1.3rem] border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
              No tester has claimed access to this project yet.
            </div>
          )}
        </CardContent>
      </Card>
    </DashboardFrame>
  );
}
