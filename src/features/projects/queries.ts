import { prisma } from "@/src/lib/db";
import { hashInviteToken } from "@/src/lib/invite";
import { evaluateReleaseAccess } from "@/src/lib/access";
import type { Prisma } from "@prisma/client";

export async function getBuilderDashboard(userId: string) {
  const [
    projects,
    claims,
    grantedPlaces,
    uniqueTesterRows,
    downloads,
    uniqueViewRows,
    feedback,
    retainedProjectCount,
    retainedReleaseCount,
  ] = await Promise.all([
    prisma.appProject.findMany({
      where: { ownerId: userId, deletedAt: null },
      include: {
        releases: {
          where: { deletedAt: null },
          include: {
            downloadEvents: true,
            feedbackReports: true,
            inviteLinks: {
              include: {
                inviteClaims: true,
              },
            },
          },
          orderBy: { publishedAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.inviteClaim.count({
      where: { inviteLink: { project: { ownerId: userId } } },
    }),
    prisma.inviteClaim.count({
      where: { grantedAt: { not: null }, revokedAt: null, inviteLink: { project: { ownerId: userId } } },
    }),
    prisma.inviteClaim.findMany({
      where: { grantedAt: { not: null }, revokedAt: null, inviteLink: { project: { ownerId: userId } } },
      distinct: ["userId"],
      select: { userId: true },
    }),
    prisma.downloadEvent.count({
      where: {
        release: {
          project: {
            ownerId: userId,
          },
        },
      },
    }),
    prisma.releaseViewEvent.findMany({
      where: { userId: { not: null }, release: { project: { ownerId: userId } } },
      distinct: ["releaseId", "userId"],
      select: { releaseId: true, userId: true },
    }),
    prisma.feedbackReport.count({
      where: {
        release: {
          project: {
            ownerId: userId,
          },
        },
      },
    }),
    prisma.appProject.count({ where: { ownerId: userId } }),
    prisma.release.count({ where: { project: { ownerId: userId } } }),
  ]);

  return {
    projects,
    stats: {
      projectCount: projects.length,
      releaseCount: projects.reduce((count, project) => count + project.releases.length, 0),
      claims,
      grantedPlaces,
      uniqueTesters: uniqueTesterRows.length,
      uniqueViews: uniqueViewRows.length,
      downloads,
      feedback,
      retainedProjectCount,
      retainedReleaseCount,
    },
  };
}

export async function getProjectForOwner(slug: string, userId: string) {
  return prisma.appProject.findFirst({
    where: {
      slug,
      ownerId: userId,
      deletedAt: null,
    },
    include: {
      testerGroups: {
        include: {
          memberships: {
            where: { revokedAt: null },
            include: { user: true },
          },
        },
        orderBy: { name: "asc" },
      },
      inviteLinks: {
        include: {
          release: true,
          testerGroup: true,
          inviteClaims: true,
        },
        orderBy: { createdAt: "desc" },
      },
      testerAccesses: {
        include: { user: true },
        orderBy: { updatedAt: "desc" },
      },
      releases: {
        where: { deletedAt: null },
        include: {
          buildAsset: true,
          accessPolicy: {
            include: {
              walletEntries: true,
              testerGroup: true,
            },
          },
          feedbackReports: true,
          downloadEvents: true,
        },
        orderBy: { publishedAt: "desc" },
      },
    },
  });
}

export async function getReleaseForOwner(slug: string, releaseId: string, userId: string) {
  return prisma.release.findFirst({
    where: {
      id: releaseId,
      deletedAt: null,
      project: {
        slug,
        ownerId: userId,
        deletedAt: null,
      },
    },
    include: {
      project: {
        include: {
          testerGroups: { orderBy: { name: "asc" } },
          releases: { where: { deletedAt: null }, select: { id: true } },
          inviteLinks: { select: { id: true } },
        },
      },
      buildAsset: true,
      accessPolicy: {
        include: {
          walletEntries: true,
          testerGroup: true,
        },
      },
      feedbackReports: {
        orderBy: { createdAt: "desc" },
        include: {
          user: true,
        },
      },
      downloadEvents: true,
      releaseViewEvents: true,
      inviteLinks: {
        include: {
          inviteClaims: true,
        },
      },
    },
  });
}

export async function getInvitePreview(token: string) {
  return prisma.inviteLink.findFirst({
    where: {
      tokenHash: hashInviteToken(token),
      revokedAt: null,
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      project: { deletedAt: null },
      OR: [{ releaseId: null }, { release: { deletedAt: null } }],
    },
    include: {
      project: true,
      release: true,
      testerGroup: true,
      inviteClaims: true,
    },
  });
}

export async function getAccessibleReleasesForUser(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: true,
      testerMemberships: true,
      testerAccesses: true,
      inviteClaims: {
        include: {
          inviteLink: { include: { release: { include: { accessPolicy: true } } } },
        },
      },
      deviceProfiles: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });
  if (!user) return [];

  const revokedProjects = user.testerAccesses.filter((access) => access.revokedAt).map((access) => access.projectId);
  const activeGroups = user.testerMemberships.filter((membership) => !membership.revokedAt)
    .flatMap((membership) => membership.testerGroupId ? [membership.testerGroupId] : []);
  const candidates: Prisma.ReleaseWhereInput[] = user.inviteClaims.filter((claim) => !claim.revokedAt).map((claim) => {
    const invite = claim.inviteLink;
    if (!invite.releaseId) return { projectId: invite.projectId };
    if (claim.grantedAt && invite.release?.accessPolicy?.allowPreviousReleases) {
      return { projectId: invite.projectId, OR: [{ id: invite.releaseId }, { publishedAt: { lte: invite.release.publishedAt } }] };
    }
    return { projectId: invite.projectId, id: invite.releaseId };
  });
  candidates.push({ accessPolicy: {
    requireInviteAcceptance: false,
    AND: [
      { OR: [{ testerGroupId: null }, { testerGroupId: { in: activeGroups } }] },
      { OR: [{ walletEntries: { none: {} } }, { walletEntries: { some: { address: { in: user.wallets.map(({ address }) => address) } } } }] },
    ],
  } });

  const findPage = (cursor?: { publishedAt: Date; id: string }) => prisma.release.findMany({
    where: {
      status: "PUBLISHED",
      deletedAt: null,
      projectId: { notIn: revokedProjects },
      project: { deletedAt: null },
      AND: [
        { OR: candidates },
        ...(cursor ? [{ OR: [{ publishedAt: { lt: cursor.publishedAt } }, { publishedAt: cursor.publishedAt, id: { lt: cursor.id } }] }] : []),
      ],
    },
    include: {
      project: true,
      buildAsset: true,
      accessPolicy: {
        include: { walletEntries: true },
      },
    },
    orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
    take: 100,
  });

  const accessibleReleases: Awaited<ReturnType<typeof findPage>> = [];
  let cursor: { publishedAt: Date; id: string } | undefined;
  // Bound each fetch, not the result: never silently hide an older eligible build.
  for (;;) {
    const releases = await findPage(cursor);
    for (const release of releases) {
      if (!release.accessPolicy) continue;

      const decision = evaluateReleaseAccess({
        policy: release.accessPolicy,
        testerMemberships: user.testerMemberships,
        inviteClaims: user.inviteClaims,
        wallets: user.wallets,
        deviceProfile: user.deviceProfiles[0] ?? null,
        releaseId: release.id,
        projectId: release.projectId,
        releasePublishedAt: release.publishedAt,
        testerAccessRevoked: user.testerAccesses.some(
          (access) => access.projectId === release.projectId && Boolean(access.revokedAt),
        ),
      });

      if (decision.canViewMetadata) accessibleReleases.push(release);
    }
    if (releases.length < 100) break;
    cursor = releases[releases.length - 1];
  }

  return accessibleReleases;
}

export async function getTesterIdentity(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    include: {
      wallets: {
        orderBy: [{ isPrimary: "desc" }, { verifiedAt: "desc" }],
      },
      deviceProfiles: {
        orderBy: { capturedAt: "desc" },
        take: 1,
      },
    },
  });
}

export async function getTesterRelease(releaseId: string, userId: string) {
  const [user, release] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: true,
        testerMemberships: true,
        testerAccesses: true,
        inviteClaims: {
          include: {
            inviteLink: { include: { release: { include: { accessPolicy: true } } } },
          },
        },
        deviceProfiles: {
          orderBy: { capturedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.release.findFirst({
      where: { id: releaseId, status: "PUBLISHED", deletedAt: null, project: { deletedAt: null } },
      include: {
        project: true,
        buildAsset: true,
        accessPolicy: {
          include: {
            walletEntries: true,
          },
        },
      },
    }),
  ]);

  if (!user || !release?.accessPolicy) {
    return null;
  }

  const decision = evaluateReleaseAccess({
    policy: release.accessPolicy,
    testerMemberships: user.testerMemberships,
    inviteClaims: user.inviteClaims,
    wallets: user.wallets,
    deviceProfile: user.deviceProfiles[0] ?? null,
    releaseId: release.id,
    projectId: release.projectId,
    releasePublishedAt: release.publishedAt,
    testerAccessRevoked: user.testerAccesses.some(
      (access) => access.projectId === release.projectId && Boolean(access.revokedAt),
    ),
  });

  return {
    release,
    user,
    decision,
  };
}
