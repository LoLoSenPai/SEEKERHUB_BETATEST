import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { ProjectForm } from "@/src/features/projects/project-form";
import { requireBuilderSession } from "@/src/lib/session";

export default async function NewAppProjectPage() {
  const session = await requireBuilderSession();

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder/apps/new"
      title="Create app project"
      subtitle="Model the Android app before the first beta release so every upload, tester group, invite, and metric has a stable home."
      identityLabel={session.user.email}
    >
      <Card className="rounded-[1.75rem]">
        <CardHeader>
          <CardTitle>App details</CardTitle>
          <CardDescription>Keep the model simple in v1: one project per Android app, then add releases over time.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProjectForm />
        </CardContent>
      </Card>
    </DashboardFrame>
  );
}
