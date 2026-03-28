import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { ReleaseUploadForm } from "@/src/features/releases/release-upload-form";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { requireSession } from "@/src/lib/session";

export default async function NewReleasePage({ params }: { params: Promise<{ slug: string }> }) {
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
      title={`Upload release for ${project.name}`}
      subtitle="Presigned upload first, server-side APK validation second, then publish a private beta release with a clean access policy."
    >
      <ReleaseUploadForm
        projectId={project.id}
        projectSlug={project.slug}
        groups={project.testerGroups.map((group) => ({ id: group.id, name: group.name }))}
      />
    </DashboardFrame>
  );
}
