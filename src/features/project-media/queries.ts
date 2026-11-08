import "server-only";
import { prisma } from "@/src/lib/db";
import { createSignedMediaUrl } from "@/src/lib/storage/project-media";
import type { ProjectMediaItem } from "./types";

/**
 * AUTHORIZATION PRECONDITION: the caller must already have checked project ownership,
 * canViewMetadata, or a valid invite. Never expose this helper through a public endpoint.
 * Do not persist/cache the result: private bearer URLs expire after 60 seconds.
 */
export async function getProjectMedia(projectId: string): Promise<ProjectMediaItem[]> {
  const rows = await prisma.projectMedia.findMany({
    where: { projectId, status: "READY", deletedAt: null, project: { deletedAt: null } },
    orderBy: [{ kind: "asc" }, { position: "asc" }],
    select: { id: true, kind: true, storageKey: true, width: true, height: true, position: true },
    take: 7,
  });
  return Promise.all(rows.map(async ({ storageKey, ...item }) => ({ ...item, url: await createSignedMediaUrl(storageKey) })));
}
