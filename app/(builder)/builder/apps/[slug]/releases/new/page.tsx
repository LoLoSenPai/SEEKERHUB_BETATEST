import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { BuilderJourney } from "@/src/components/layout/builder-journey";
import { ReleaseUploadForm } from "@/src/features/releases/release-upload-form";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { requireBuilderSession } from "@/src/lib/session";

export default async function NewReleasePage({ params }: { params: Promise<{ slug: string }> }) {
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
      title={`New release for ${project.name}`}
      subtitle="Upload your APK, choose your audience, and get a link to share. You review everything before publishing."
      identityLabel={session.user.email}
    >
      <BuilderJourney
        projectSlug={project.slug}
        current="release"
        releaseCount={project.releases.length}
        inviteCount={project.inviteLinks.length}
        downloadCount={project.releases.reduce((total, release) => total + release.downloadEvents.length, 0)}
      />
      <ReleaseUploadForm
        projectId={project.id}
        projectSlug={project.slug}
        maxApkBytes={Number(session.builderProfile.maxApkBytes)}
      />
    </DashboardFrame>
  );
}
