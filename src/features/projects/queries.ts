import { prisma } from "@/src/lib/db";
import { hashInviteToken } from "@/src/lib/invite";
import { resolveInviteAcceptanceForRelease } from "@/src/lib/invite-access";
import { evaluateReleaseAccess } from "@/src/lib/access";

export async function getBuilderDashboard(userId: string) {
  const [projects, invitesAccepted, downloads, feedback] = await Promise.all([
    prisma.appProject.findMany({
      where: { ownerId: userId },
      include: {
        releases: {
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
      where: {
        inviteLink: {
          createdById: userId,
        },
      },
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
    prisma.feedbackReport.count({
      where: {
        release: {
          project: {
            ownerId: userId,
          },
        },
      },
    }),
  ]);

  const invitedTesters = projects.reduce(
    (total, project) =>
      total +
      project.releases.reduce(
        (releaseTotal, release) => releaseTotal + release.inviteLinks.reduce((acc, invite) => acc + (invite.maxUses ?? 1), 0),
        0,
      ),
    0,
  );

  return {
    projects,
    stats: {
      projectCount: projects.length,
      releaseCount: projects.reduce((count, project) => count + project.releases.length, 0),
      invitedTesters,
      invitesAccepted,
      downloads,
      feedback,
    },
  };
}

export async function getProjectForOwner(slug: string, userId: string) {
  return prisma.appProject.findFirst({
    where: {
      slug,
      ownerId: userId,
    },
    include: {
      testerGroups: {
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
      releases: {
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
      project: {
        slug,
        ownerId: userId,
      },
    },
    include: {
      project: true,
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
  const [user, releases] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      include: {
        wallets: true,
        testerMemberships: true,
        inviteClaims: {
          include: {
            inviteLink: true,
          },
        },
        deviceProfiles: {
          orderBy: { capturedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.release.findMany({
      where: {
        status: "PUBLISHED",
      },
      include: {
        project: true,
        buildAsset: true,
        accessPolicy: {
          include: {
            walletEntries: true,
          },
        },
      },
      orderBy: { publishedAt: "desc" },
    }),
  ]);

  if (!user) return [];

  const accessibleReleases: typeof releases = [];
  let resolvedInviteClaims = user.inviteClaims;

  for (const release of releases) {
    if (!release.accessPolicy) {
      continue;
    }

    const inviteResolution = await resolveInviteAcceptanceForRelease({
      userId,
      policy: release.accessPolicy,
      testerMemberships: user.testerMemberships,
      inviteClaims: resolvedInviteClaims,
      wallets: user.wallets,
      deviceProfile: user.deviceProfiles[0] ?? null,
      releaseId: release.id,
      projectId: release.projectId,
    });

    resolvedInviteClaims = inviteResolution.inviteClaims;

    const decision = evaluateReleaseAccess({
      policy: release.accessPolicy,
      testerMemberships: user.testerMemberships,
      inviteClaims: resolvedInviteClaims,
      wallets: user.wallets,
      deviceProfile: user.deviceProfiles[0] ?? null,
      releaseId: release.id,
      projectId: release.projectId,
    });

    if (decision.canView) {
      accessibleReleases.push(release);
    }
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
        inviteClaims: {
          include: {
            inviteLink: true,
          },
        },
        deviceProfiles: {
          orderBy: { capturedAt: "desc" },
          take: 1,
        },
      },
    }),
    prisma.release.findUnique({
      where: { id: releaseId },
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

  const inviteResolution = await resolveInviteAcceptanceForRelease({
    userId,
    policy: release.accessPolicy,
    testerMemberships: user.testerMemberships,
    inviteClaims: user.inviteClaims,
    wallets: user.wallets,
    deviceProfile: user.deviceProfiles[0] ?? null,
    releaseId: release.id,
    projectId: release.projectId,
  });

  const decision = evaluateReleaseAccess({
    policy: release.accessPolicy,
    testerMemberships: user.testerMemberships,
    inviteClaims: inviteResolution.inviteClaims,
    wallets: user.wallets,
    deviceProfile: user.deviceProfiles[0] ?? null,
    releaseId: release.id,
    projectId: release.projectId,
  });

  if (
    inviteResolution.inviteCapacityReason &&
    decision.reasons.includes("An accepted invite is required for this release.")
  ) {
    const capacityReason = inviteResolution.inviteCapacityReason;
    decision.reasons = decision.reasons.map((reason) =>
      reason === "An accepted invite is required for this release." ? capacityReason : reason,
    );
  }

  return {
    release,
    user,
    decision,
  };
}
