import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/src/lib/db";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { getAccessibleReleasesForUser } from "@/src/features/projects/queries";

const integration = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const runId = randomUUID();
let ownerId: string;

async function tester() {
  return prisma.user.create({ data: { name: "Access tester", email: `access-${randomUUID()}@example.com` } });
}
async function fixture(maxUses = 1) {
  const project = await prisma.appProject.create({ data: { ownerId, name: "Access security test", slug: `access-${randomUUID()}` } });
  const group = await prisma.testerGroup.create({ data: { projectId: project.id, name: "QA" } });
  const release = await prisma.release.create({ data: { projectId: project.id, createdById: ownerId, versionName: "1", versionCode: 1,
    changelog: "Access regression", accessPolicy: { create: { requireInviteAcceptance: true, testerGroupId: group.id } } } });
  const invite = await prisma.inviteLink.create({ data: { projectId: project.id, releaseId: release.id,
    testerGroupId: group.id, createdById: ownerId, label: "Access regression", tokenHash: randomUUID(), maxUses } });
  return { project, group, release, invite };
}

integration("access security on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "");
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.toLowerCase().includes("test")) {
      throw new Error("Access integration tests require an explicitly configured, local disposable test database.");
    }
    const owner = await prisma.user.create({ data: { name: "Access test builder", email: `access-owner-${runId}@example.com` } });
    ownerId = owner.id;
  });

  it("allocates at most one seat under concurrent claims and repeated reconciliation", async () => {
    const { invite, project } = await fixture();
    const testers = await Promise.all(Array.from({ length: 6 }, tester));
    await prisma.inviteClaim.createMany({ data: testers.map(({ id }) => ({ userId: id, inviteLinkId: invite.id })) });
    await Promise.all(testers.map(({ id }) => reconcilePendingInviteGrants(id, project.id)));
    await Promise.all(testers.map(({ id }) => reconcilePendingInviteGrants(id, project.id)));
    expect(await prisma.inviteClaim.count({ where: { inviteLinkId: invite.id, grantedAt: { not: null } } })).toBe(1);
    expect(await prisma.testerMembership.count({ where: { inviteLinkId: invite.id } })).toBe(1);
  });

  it.each(["revoked", "expired", "project-deleted", "access-revoked", "membership-revoked"])(
    "does not grant a pending claim after %s", async (condition) => {
      const { invite, project, group } = await fixture();
      const user = await tester();
      const claim = await prisma.inviteClaim.create({ data: { userId: user.id, inviteLinkId: invite.id } });
      if (condition === "revoked") await prisma.inviteLink.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
      if (condition === "expired") await prisma.inviteLink.update({ where: { id: invite.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      if (condition === "project-deleted") await prisma.appProject.update({ where: { id: project.id }, data: { deletedAt: new Date() } });
      if (condition === "access-revoked") await prisma.testerAccess.create({ data: { userId: user.id, projectId: project.id, revokedAt: new Date() } });
      if (condition === "membership-revoked") await prisma.testerMembership.create({ data: {
        userId: user.id, projectId: project.id, testerGroupId: group.id, revokedAt: new Date(),
      } });
      await reconcilePendingInviteGrants(user.id, project.id);
      expect((await prisma.inviteClaim.findUniqueOrThrow({ where: { id: claim.id } })).grantedAt).toBeNull();
      if (condition === "membership-revoked") expect((await prisma.testerMembership.findFirstOrThrow({
        where: { userId: user.id, projectId: project.id },
      })).revokedAt).not.toBeNull();
    },
  );

  it("serializes a pending grant with link closure and preserves a previously granted seat", async () => {
    const { invite, project } = await fixture(2);
    const [granted, pending] = await Promise.all([tester(), tester()]);
    await prisma.inviteClaim.createMany({ data: [granted, pending].map(({ id }) => ({ userId: id, inviteLinkId: invite.id })) });
    await reconcilePendingInviteGrants(granted.id, project.id);
    let locked!: () => void;
    let close!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const resume = new Promise<void>((resolve) => { close = resolve; });
    const closure = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "InviteLink" WHERE "id" = ${invite.id} FOR UPDATE`;
      locked();
      await resume;
      await tx.inviteLink.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
    });
    await ready;
    const reconciliation = reconcilePendingInviteGrants(pending.id, project.id);
    close();
    await Promise.all([closure, reconciliation]);
    const claims = await prisma.inviteClaim.findMany({ where: { inviteLinkId: invite.id } });
    expect(claims.find(({ userId }) => userId === pending.id)?.grantedAt).toBeNull();
    expect(claims.find(({ userId }) => userId === granted.id)?.grantedAt).not.toBeNull();
    expect((await getAccessibleReleasesForUser(granted.id)).some(({ projectId }) => projectId === project.id)).toBe(true);
  });

  it("keeps a combined group, wallet and SGT claim pending until every live requirement is met", async () => {
    const { invite, project, release } = await fixture();
    const user = await tester();
    const address = bs58.encode(randomBytes(32));
    await prisma.accessPolicy.update({ where: { releaseId: release.id }, data: {
      requireLinkedWallet: true, requireVerifiedSeeker: true, walletEntries: { create: { address } },
    } });
    const claim = await prisma.inviteClaim.create({ data: { userId: user.id, inviteLinkId: invite.id } });
    await reconcilePendingInviteGrants(user.id, project.id);
    expect((await prisma.inviteClaim.findUniqueOrThrow({ where: { id: claim.id } })).grantedAt).toBeNull();
    const wallet = await prisma.wallet.create({ data: { userId: user.id, address, verifiedAt: new Date(),
      seekerGenesisVerifiedAt: new Date(), seekerGenesisVerificationExpiresAt: new Date(Date.now() - 1),
    } });
    await reconcilePendingInviteGrants(user.id, project.id);
    expect((await prisma.inviteClaim.findUniqueOrThrow({ where: { id: claim.id } })).grantedAt).toBeNull();
    expect(await prisma.testerMembership.count({ where: { projectId: project.id, userId: user.id } })).toBe(0);
    await prisma.wallet.update({ where: { id: wallet.id }, data: { seekerGenesisVerificationExpiresAt: new Date(Date.now() + 60_000) } });
    await reconcilePendingInviteGrants(user.id, project.id);
    expect((await prisma.inviteClaim.findUniqueOrThrow({ where: { id: claim.id } })).grantedAt).not.toBeNull();
    expect(await prisma.testerMembership.count({ where: { projectId: project.id, userId: user.id, revokedAt: null } })).toBe(1);
  });

  it("discovers older claimed builds and hides no-invite allowlists until an exact wallet is linked", async () => {
    const { project, release, invite } = await fixture();
    const user = await tester();
    await prisma.release.update({ where: { id: release.id }, data: { publishedAt: new Date("2026-10-30T12:00:00Z"),
      accessPolicy: { update: { allowPreviousReleases: true } } } });
    const older = await prisma.release.create({ data: { projectId: project.id, createdById: ownerId, versionName: "old", versionCode: 2,
      changelog: "Older", publishedAt: new Date("2026-10-01T12:00:00Z"), accessPolicy: { create: { requireInviteAcceptance: true } } } });
    const privateRelease = await prisma.release.create({ data: { projectId: project.id, createdById: ownerId, versionName: "private", versionCode: 3,
      changelog: "Private", accessPolicy: { create: { requireInviteAcceptance: false, requireLinkedWallet: true,
        walletEntries: { create: { address: bs58.encode(randomBytes(32)) } } } } } });
    await prisma.inviteClaim.create({ data: { userId: user.id, inviteLinkId: invite.id } });
    await reconcilePendingInviteGrants(user.id, project.id);
    let ids = (await getAccessibleReleasesForUser(user.id)).map(({ id }) => id);
    expect(ids).toEqual(expect.arrayContaining([release.id, older.id]));
    expect(ids).not.toContain(privateRelease.id);
    const entry = await prisma.accessPolicyWalletEntry.findFirstOrThrow({ where: { accessPolicy: { releaseId: privateRelease.id } } });
    await prisma.wallet.create({ data: { userId: user.id, address: entry.address, verifiedAt: new Date() } });
    ids = (await getAccessibleReleasesForUser(user.id)).map(({ id }) => id);
    expect(ids).toContain(privateRelease.id);
  });
});
