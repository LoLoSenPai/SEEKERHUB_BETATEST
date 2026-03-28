import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { Textarea } from "@/src/components/ui/textarea";
import { createProjectAction } from "@/src/features/projects/actions";
import { requireSession } from "@/src/lib/session";

export default async function NewAppProjectPage() {
  await requireSession();

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder/apps/new"
      title="Create app project"
      subtitle="Model the Android app before the first beta release so every upload, tester group, invite, and metric has a stable home."
    >
      <Card className="rounded-[1.75rem]">
        <CardHeader>
          <CardTitle>App details</CardTitle>
          <CardDescription>Keep the model simple in v1: one project per Android app, then add releases over time.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createProjectAction} className="grid gap-5">
            <div className="grid gap-2">
              <Label htmlFor="name">App name</Label>
              <Input id="name" name="name" placeholder="Seeker Notes" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" name="description" placeholder="What builders and testers should know about this project." />
            </div>
            <PendingSubmitButton idleLabel="Create project" pendingLabel="Creating project..." />
          </form>
        </CardContent>
      </Card>
    </DashboardFrame>
  );
}
