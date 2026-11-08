import { prisma } from "@/src/lib/db";
import { auth } from "@/src/lib/auth";
import { evaluateReleaseAccess } from "@/src/lib/access";
import { AppError } from "@/src/lib/errors";
import { getServerEnv } from "@/src/lib/env";
import { hashInviteToken } from "@/src/lib/invite";
import { consumeRateLimit } from "@/src/lib/rate-limit";

async function testerCanViewMedia(userId: string, projectId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId }, include: {
      wallets: true,
      testerMemberships: { where: { projectId } }, testerAccesses: { where: { projectId } },
      inviteClaims: { where: { inviteLink: { projectId } }, include: { inviteLink: { include: { release: { include: { accessPolicy: true } } } } } },
      deviceProfiles: { orderBy: { capturedAt: "desc" }, take: 1 },
    },
  });
  if (!user || user.testerAccesses.some((access) => access.revokedAt)) return false;
  let cursor: string | undefined;
  for (;;) {
    const releases = await prisma.release.findMany({
      where: { projectId, status: "PUBLISHED", deletedAt: null, project: { deletedAt: null } },
      include: { accessPolicy: { include: { walletEntries: true } } }, orderBy: { id: "asc" },
      take: 100, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    for (const release of releases) {
      if (release.accessPolicy && evaluateReleaseAccess({
        policy: release.accessPolicy, testerMemberships: user.testerMemberships, inviteClaims: user.inviteClaims,
        wallets: user.wallets, deviceProfile: user.deviceProfiles[0] ?? null,
        projectId, releaseId: release.id, releasePublishedAt: release.publishedAt,
      }).canViewMetadata) return true;
    }
    if (releases.length < 100) return false;
    cursor = releases[releases.length - 1].id;
  }
}

export async function authorizeMediaRenewal(request: Request, id: string) {
  const denied = () => new AppError("Image not found.", 404, "MEDIA_NOT_FOUND");
  const appOrigin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  if (request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.headers.has("origin") && request.headers.get("origin") !== appOrigin)) throw denied();
  const session = await auth.api.getSession({ headers: request.headers });
  await consumeRateLimit({ request, userId: session?.user.id, action: "project-media.renew", limit: 120, windowMs: 10 * 60_000 });
  const media = await prisma.projectMedia.findFirst({
    where: { id, status: "READY", deletedAt: null, project: { deletedAt: null } },
    select: { storageKey: true, projectId: true, project: { select: { ownerId: true } } },
  });
  if (!media) throw denied();
  if (session?.user.id === media.project.ownerId || (session && await testerCanViewMedia(session.user.id, media.projectId))) return media.storageKey;

  // Invite previews may be anonymous. A same-origin referring invite URL carries
  // the existing bearer credential; validate it, never trust Referer as authorization.
  // Missing/referrer-stripped requests fail closed instead of inventing public access.
  let token: string | undefined;
  try {
    const referrer = new URL(request.headers.get("referer") ?? "");
    const match = /^\/invite\/([a-zA-Z0-9_-]{20,512})\/?$/.exec(referrer.pathname);
    if (referrer.origin === appOrigin && match) token = match[1];
  } catch { /* No usable invite credential. */ }
  if (token) {
    const invite = await prisma.inviteLink.findFirst({ where: {
      projectId: media.projectId, tokenHash: hashInviteToken(token), revokedAt: null,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      project: { deletedAt: null }, OR: [{ releaseId: null }, { release: { deletedAt: null } }],
    }, select: { id: true } });
    if (invite) return media.storageKey;
  }
  throw denied();
}
