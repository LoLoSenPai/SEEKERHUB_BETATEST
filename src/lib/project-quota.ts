import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { isTransactionConflict, isUniqueConstraintError } from "@/src/lib/prisma-errors";
import { toSlug } from "@/src/lib/utils";

export async function createProjectWithinQuota(input: {
  userId: string;
  name: string;
  description: string | null;
}) {
  const baseSlug = toSlug(input.name);
  let slugSequence = 1;

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const slug = slugSequence === 1 ? baseSlug : `${baseSlug}-${slugSequence}`;
    try {
      return await prisma.$transaction(
        async (tx) => {
          const profile = await tx.builderProfile.findUnique({ where: { userId: input.userId } });
          if (!profile || profile.status !== "ACTIVE") {
            throw new AppError("An active builder account is required.", 403, "BUILDER_REQUIRED");
          }

          const projectCount = await tx.appProject.count({ where: { ownerId: input.userId } });
          if (projectCount >= profile.maxProjects) {
            throw new AppError("Your builder project quota is full.", 409, "PROJECT_QUOTA_EXCEEDED");
          }

          const project = await tx.appProject.create({
            data: {
              ownerId: input.userId,
              slug,
              name: input.name,
              description: input.description,
            },
          });
          await tx.auditLog.create({
            data: {
              actorUserId: input.userId,
              action: "project.created",
              targetType: "AppProject",
              targetId: project.id,
            },
          });
          return project;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (isTransactionConflict(error)) continue;
      if (isUniqueConstraintError(error)) {
        slugSequence += 1;
        continue;
      }
      throw error;
    }
  }

  throw new AppError("Unable to allocate a project slug safely.", 409, "PROJECT_CREATE_CONFLICT");
}
