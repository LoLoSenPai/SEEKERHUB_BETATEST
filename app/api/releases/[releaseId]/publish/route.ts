import { after, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireBuilderApiSession } from "@/src/lib/session";
import { apiError } from "@/src/lib/errors";
import { publishReleaseInputSchema } from "@/src/features/releases/publish-input";
import { publishRelease } from "@/src/features/releases/publish";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { prisma } from "@/src/lib/db";
import { logger } from "@/src/lib/logger";

export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ releaseId: string }> }) {
  try {
    const session = await requireBuilderApiSession(request);
    const { releaseId } = await params;
    const input = publishReleaseInputSchema.parse(await request.json());
    const result = await publishRelease(session.user.id, releaseId, input);
    const { release, alreadyPublished } = result;
    const path = `/builder/apps/${release.project.slug}`;
    if (!alreadyPublished) {
      // Publication has committed. Invitation retries must not turn its response into an error.
      after(async () => {
        try {
          const pending = await prisma.inviteClaim.findMany({
            where: { grantedAt: null, revokedAt: null, inviteLink: { projectId: release.projectId, revokedAt: null } },
            distinct: ["userId"], select: { userId: true }, take: 100,
          });
          const deadline = Date.now() + 40_000;
          for (const user of pending) {
            if (Date.now() >= deadline) break;
            await reconcilePendingInviteGrants(user.userId, release.projectId);
          }
          // Remaining users can explicitly retry their invitation; reads never allocate seats.
          if (pending.length === 100 || Date.now() >= deadline) logger.warn("invite.post_publish_reconciliation_bounded", { projectId: release.projectId });
        } catch (error) {
          logger.error("invite.post_publish_reconciliation_failed", { projectId: release.projectId, error });
        }
      });
    }
    revalidatePath(path);
    revalidatePath(`${path}/releases/${releaseId}`);
    revalidatePath(`${path}/invites`);
    const inviteQuery = "inviteId" in result && result.inviteId ? `&invite=${encodeURIComponent(result.inviteId)}` : "";
    return NextResponse.json({ releaseId, redirectTo: `${path}/releases/${releaseId}?published=1${inviteQuery}` });
  } catch (error) {
    return apiError(error, "Unable to publish this draft. Your APK is saved; you can try again.");
  }
}
