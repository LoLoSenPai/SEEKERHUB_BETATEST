import type { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";

export async function writeAuditLog(input: {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Prisma.InputJsonValue;
  ipHash?: string | null;
}) {
  await prisma.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      metadataJson: input.metadata,
      ipHash: input.ipHash,
    },
  });
}
