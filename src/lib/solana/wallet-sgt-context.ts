import { z } from "zod";
import { prisma } from "@/src/lib/db";
import { AppError } from "@/src/lib/errors";
import { hashInviteToken } from "@/src/lib/invite";
import { walletChallengeSchema } from "@/src/lib/validation";
import type { WalletSgtContext } from "./wallet-types";

const contextSchema = z.union([
  z.object({ releaseId: z.string().cuid() }).strict(),
  z.object({ inviteToken: z.string().min(20).max(512) }).strict(),
]);

// Keep the legacy schema unchanged for other consumers.
export const contextualWalletChallengeSchema = walletChallengeSchema.extend({
  purpose: z.enum(["LINK", "VERIFY_SGT", "SIGN_IN", "SIGN_IN_AND_VERIFY_SGT"]).default("LINK"),
  sgtContext: contextSchema.optional(),
}).superRefine((body, ctx) => {
  if ((body.purpose === "SIGN_IN_AND_VERIFY_SGT") !== Boolean(body.sgtContext)) {
    ctx.addIssue({ code: "custom", path: ["sgtContext"], message: "Combined sign-in requires an explicit SGT policy context only." });
  }
});

export async function resolveWalletSgtContext(context: WalletSgtContext) {
  const denied = () => new AppError("This invitation or release does not require an SGT check.", 400, "SGT_CONTEXT_NOT_REQUIRED");
  if ("releaseId" in context) {
    const release = await prisma.release.findFirst({
      where: { id: context.releaseId, status: "PUBLISHED", deletedAt: null, project: { deletedAt: null },
        accessPolicy: { requireVerifiedSeeker: true } },
      select: { id: true },
    });
    if (!release) throw denied();
    return `release:${release.id}`;
  }

  const invite = await prisma.inviteLink.findFirst({
    where: { tokenHash: hashInviteToken(context.inviteToken), revokedAt: null, project: { deletedAt: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { id: true, projectId: true, releaseId: true },
  });
  if (!invite) throw denied();
  // A project-wide invite can cover mixed policies; require at least one published SGT-gated build.
  const release = await prisma.release.findFirst({
    where: { projectId: invite.projectId, id: invite.releaseId ?? undefined, status: "PUBLISHED", deletedAt: null,
      accessPolicy: { requireVerifiedSeeker: true } },
    select: { id: true },
  });
  if (!release) throw denied();
  // Bind the server identity, never disclose the bearer invite token to a wallet provider.
  return `invite:${invite.id};release:${release.id}`;
}
