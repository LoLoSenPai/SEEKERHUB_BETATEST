import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { Textarea } from "@/src/components/ui/textarea";
import { createTesterGroupAction } from "@/src/features/groups/actions";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { requireSession } from "@/src/lib/session";

export default async function GroupsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const session = await requireSession();
  const project = await getProjectForOwner(slug, session.user.id);

  if (!project) {
    notFound();
  }

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={`${project.name} tester groups`}
      subtitle="Use groups to scope private releases without creating a new policy model each time."
    >
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Create tester group</CardTitle>
            <CardDescription>Groups are reusable access targets for releases and invite links.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createTesterGroupAction} className="grid gap-5">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="projectSlug" value={project.slug} />
              <div className="grid gap-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" placeholder="Core QA" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="description">Description</Label>
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
                  <div className="text-lg font-semibold">{group.name}</div>
                  <div className="mt-2 text-sm leading-7 text-muted-foreground">{group.description || "No description."}</div>
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
    </DashboardFrame>
  );
}
