import { Prisma } from "@prisma/client";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { createInviteToken, encryptInviteToken, hashInviteToken } from "@/src/lib/invite";
import { isTransactionConflict } from "@/src/lib/prisma-errors";
import type { PublishReleaseInput } from "./publish-input";

export async function publishRelease(userId: string, releaseId: string, input: PublishReleaseInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const release = await tx.release.findFirst({
          where: { id: releaseId, deletedAt: null, project: { ownerId: userId, deletedAt: null } },
          include: { buildAsset: true, project: true },
        });
        if (!release) throw new AppError("Draft not found.", 404, "DRAFT_NOT_FOUND");
        if (release.status === "PUBLISHED") {
          const publication = await tx.auditLog.findFirst({ where: { action: "release.published", targetType: "Release", targetId: releaseId }, orderBy: { createdAt: "desc" }, select: { metadataJson: true } });
          const metadata = publication?.metadataJson;
          const savedInviteId = metadata && typeof metadata === "object" && !Array.isArray(metadata) && typeof metadata.inviteId === "string" ? metadata.inviteId : null;
          const invite = await tx.inviteLink.findFirst({ where: { projectId: release.projectId, revokedAt: null, ...(savedInviteId ? { id: savedInviteId } : { releaseId }) }, orderBy: { createdAt: "desc" }, select: { id: true } });
          return { release, alreadyPublished: true, inviteId: invite?.id ?? null };
        }
        if (release.status !== "DRAFT") throw new AppError("Only a draft can be published here.", 409, "NOT_A_DRAFT");
        if (!release.buildAsset?.validatedAt) throw new AppError("Validate the APK before publishing.", 409, "APK_NOT_VALIDATED");

        const policy = input.accessPolicy;
        if (policy.testerGroupId && !await tx.testerGroup.findFirst({ where: { id: policy.testerGroupId, projectId: release.projectId } })) {
          throw new AppError("Choose a tester group from this app.", 400, "INVALID_TESTER_GROUP");
        }
        const publishedAt = new Date();
        // A committed publication can be recovered with its original payload,
        // even when that invitation has since expired.
        if (input.invitation.expiresAt && new Date(input.invitation.expiresAt) <= publishedAt) {
          throw new AppError("Choose an expiration in the future.", 400, "INVALID_INVITE_EXPIRATION");
        }
        const updated = await tx.release.updateMany({
          where: { id: releaseId, status: "DRAFT", deletedAt: null },
          data: { status: "PUBLISHED", changelog: input.changelog, publishedAt },
        });
        if (updated.count !== 1) throw new AppError("This draft changed. Refresh before publishing.", 409, "DRAFT_CHANGED");
        const { walletAllowlist, ...policyFields } = policy;
        const savedPolicy = await tx.accessPolicy.upsert({
          where: { releaseId },
          create: { releaseId, ...policyFields },
          update: policyFields,
        });
        await tx.accessPolicyWalletEntry.deleteMany({ where: { accessPolicyId: savedPolicy.id } });
        if (walletAllowlist.length) await tx.accessPolicyWalletEntry.createMany({
          data: walletAllowlist.map((address) => ({ accessPolicyId: savedPolicy.id, address })),
        });

        let inviteId: string | null = null;
        if (policy.requireInviteAcceptance) {
          const token = createInviteToken();
          const invite = await tx.inviteLink.create({ data: {
            projectId: release.projectId,
            releaseId: input.invitation.scope === "release" ? releaseId : null,
            testerGroupId: policy.testerGroupId ?? null,
            createdById: userId,
            label: `Release ${release.versionName}`,
            tokenHash: hashInviteToken(token),
            tokenCiphertext: encryptInviteToken(token),
            maxUses: input.invitation.maxUses,
            expiresAt: input.invitation.expiresAt ? new Date(input.invitation.expiresAt) : null,
          } });
          inviteId = invite.id;
        }
        await tx.auditLog.create({ data: { actorUserId: userId, action: "release.published", targetType: "Release", targetId: releaseId, metadataJson: { inviteId } } });
        return { release: { ...release, status: "PUBLISHED" as const, changelog: input.changelog, publishedAt }, alreadyPublished: false, inviteId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (isTransactionConflict(error) && attempt < 2) continue;
      throw error;
    }
  }
  throw new AppError("Publication is busy. Try again.", 409, "PUBLISH_CONFLICT");
}
