import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { publishRelease } from "@/src/features/releases/publish";
import { publishReleaseInputSchema } from "@/src/features/releases/publish-input";
import { prisma } from "@/src/lib/db";

const integrationDescribe = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
const runId = randomUUID();
const wallet = "11111111111111111111111111111111";

function assertDisposableDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests.");
  const url = new URL(databaseUrl);
  if (!["127.0.0.1", "localhost"].includes(url.hostname) || !url.pathname.toLowerCase().includes("test")) {
    throw new Error("Integration tests only run against a local disposable database whose name contains 'test'.");
  }
}

integrationDescribe("draft publication database invariants", () => {
  let ownerId: string;
  let otherId: string;
  let projectId: string;
  let groupId: string;
  let foreignGroupId: string;
  let versionCode = 0;

  const input = (testerGroupId?: string) => publishReleaseInputSchema.parse({
    changelog: "Published notes",
    accessPolicy: { testerGroupId, requireInviteAcceptance: true },
    invitation: { scope: "release", maxUses: 3, expiresAt: "2100-01-01T00:00:00.000Z" },
  });

  async function draft(validated: boolean) {
    versionCode += 1;
    return prisma.release.create({ data: {
      projectId, createdById: ownerId, status: "DRAFT", versionName: `test-${versionCode}`, versionCode, changelog: "Draft notes",
      buildAsset: { create: {
        storageKey: `test/${runId}/${versionCode}.apk`, bucket: "test", originalFileName: "test.apk",
        contentType: "application/vnd.android.package-archive", fileSizeBytes: 10, sha256Checksum: "test",
        validatedAt: validated ? new Date() : null,
      } },
    } });
  }

  beforeAll(async () => {
    assertDisposableDatabase();
    await prisma.$connect();
    const owner = await prisma.user.create({ data: { name: "Owner", email: `publish-owner-${runId}@example.com` } });
    ownerId = owner.id;
    const other = await prisma.user.create({ data: { name: "Other", email: `publish-other-${runId}@example.com` } });
    otherId = other.id;
    const project = await prisma.appProject.create({ data: { ownerId, name: "Publication test", slug: `publish-${runId}` } });
    projectId = project.id;
    groupId = (await prisma.testerGroup.create({ data: { projectId, name: "Testers" } })).id;
    const foreignProject = await prisma.appProject.create({ data: { ownerId: otherId, name: "Other app", slug: `publish-other-${runId}` } });
    foreignGroupId = (await prisma.testerGroup.create({ data: { projectId: foreignProject.id, name: "Other testers" } })).id;
  });

  afterAll(async () => {
    if (!ownerId && !otherId) return;
    await prisma.auditLog.deleteMany({ where: { actorUserId: { in: [ownerId, otherId].filter(Boolean) } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId].filter(Boolean) } } });
  });

  it("allows only the owner and requires a validated asset", async () => {
    const release = await draft(false);
    await expect(publishRelease(otherId, release.id, input())).rejects.toMatchObject({ code: "DRAFT_NOT_FOUND" });
    await expect(publishRelease(ownerId, release.id, input())).rejects.toMatchObject({ code: "APK_NOT_VALIDATED" });
    const stored = await prisma.release.findUniqueOrThrow({ where: { id: release.id }, include: { accessPolicy: true, inviteLinks: true } });
    expect(stored).toMatchObject({ status: "DRAFT", changelog: "Draft notes", accessPolicy: null, inviteLinks: [] });
    const withoutAsset = await prisma.release.create({ data: { projectId, createdById: ownerId, status: "DRAFT", versionName: "no-asset", versionCode: ++versionCode, changelog: "Draft notes" } });
    await expect(publishRelease(ownerId, withoutAsset.id, input())).rejects.toMatchObject({ code: "APK_NOT_VALIDATED" });
    expect((await prisma.release.findUniqueOrThrow({ where: { id: withoutAsset.id } })).status).toBe("DRAFT");
  });

  it("creates only one invite under concurrent publication attempts", async () => {
    const release = await draft(true);
    const results = await Promise.all([publishRelease(ownerId, release.id, input(groupId)), publishRelease(ownerId, release.id, input(groupId))]);
    expect(results.map((result) => result.alreadyPublished).sort()).toEqual([false, true]);
    expect(await prisma.inviteLink.count({ where: { releaseId: release.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "release.published", targetId: release.id } })).toBe(1);
  });

  it("publishes policy and scoped group invite together, and a repeat creates no second link", async () => {
    const release = await draft(true);
    const first = await publishRelease(ownerId, release.id, input(groupId));
    const second = await publishRelease(ownerId, release.id, input(groupId));
    expect(first.alreadyPublished).toBe(false);
    expect(second.alreadyPublished).toBe(true);
    const stored = await prisma.release.findUniqueOrThrow({ where: { id: release.id }, include: { accessPolicy: true, inviteLinks: true } });
    expect(stored).toMatchObject({ status: "PUBLISHED", changelog: "Published notes", accessPolicy: { testerGroupId: groupId, requireInviteAcceptance: true } });
    expect(stored.inviteLinks).toHaveLength(1);
    expect(stored.inviteLinks[0]).toMatchObject({ id: first.inviteId, projectId, releaseId: release.id, testerGroupId: groupId, maxUses: 3, expiresAt: new Date("2100-01-01T00:00:00.000Z") });
    expect(await prisma.auditLog.count({ where: { action: "release.published", targetId: release.id } })).toBe(1);
    expect(first.release).toMatchObject({ status: "PUBLISHED", changelog: stored.changelog, publishedAt: stored.publishedAt });
    expect(second.inviteId).toBe(first.inviteId);
  });

  it("returns the same project-wide invite on retry without creating another", async () => {
    const release = await draft(true);
    const projectInput = input(groupId);
    projectInput.invitation.scope = "project";
    const before = await prisma.inviteLink.count({ where: { projectId, releaseId: null } });
    const first = await publishRelease(ownerId, release.id, projectInput);
    const second = await publishRelease(ownerId, release.id, projectInput);

    expect(first.alreadyPublished).toBe(false);
    expect(second.alreadyPublished).toBe(true);
    expect(first.inviteId).toEqual(expect.any(String));
    expect(second.inviteId).toBe(first.inviteId);
    expect(await prisma.inviteLink.count({ where: { projectId, releaseId: null } })).toBe(before + 1);
    expect(await prisma.inviteLink.findUniqueOrThrow({ where: { id: first.inviteId! } })).toMatchObject({ projectId, releaseId: null, testerGroupId: groupId });
    const publication = await prisma.auditLog.findFirstOrThrow({ where: { action: "release.published", targetType: "Release", targetId: release.id } });
    expect(publication.metadataJson).toMatchObject({ inviteId: first.inviteId });
    expect(await prisma.auditLog.count({ where: { action: "release.published", targetId: release.id } })).toBe(1);
  });

  it("rejects a group from another project without changing the draft", async () => {
    const release = await draft(true);
    await expect(publishRelease(ownerId, release.id, input(foreignGroupId))).rejects.toMatchObject({ code: "INVALID_TESTER_GROUP" });
    const stored = await prisma.release.findUniqueOrThrow({ where: { id: release.id }, include: { accessPolicy: true, inviteLinks: true } });
    expect(stored).toMatchObject({ status: "DRAFT", changelog: "Draft notes", accessPolicy: null, inviteLinks: [] });
  });

  it.each(["release", "project"] as const)("recovers the same expired %s invite after commit but rejects that payload on a fresh draft", async (scope) => {
    const release = await draft(true);
    const freshDraft = await draft(true);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const payload = { ...input(groupId), invitation: { scope, maxUses: 3, expiresAt } };
    const first = await publishRelease(ownerId, release.id, publishReleaseInputSchema.parse(payload));

    // Keep database I/O timers real; only advance the application clock past expiry.
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(new Date(expiresAt).getTime() + 1));
      const retriedInput = publishReleaseInputSchema.parse(JSON.parse(JSON.stringify(payload)));
      const retry = await publishRelease(ownerId, release.id, retriedInput);
      expect(retry).toMatchObject({ alreadyPublished: true, inviteId: first.inviteId });
      expect(retry.release.publishedAt).toEqual(first.release.publishedAt);
      const invite = await prisma.inviteLink.findUniqueOrThrow({ where: { id: first.inviteId! } });
      expect(invite).toMatchObject({ expiresAt: new Date(expiresAt), maxUses: 3, testerGroupId: groupId });
      expect(invite.expiresAt!.getTime()).toBeLessThan(Date.now());
      expect(await prisma.auditLog.count({ where: { action: "release.published", targetId: release.id } })).toBe(1);

      await expect(publishRelease(ownerId, freshDraft.id, retriedInput)).rejects.toMatchObject({
        code: "INVALID_INVITE_EXPIRATION", status: 400,
      });
      const stored = await prisma.release.findUniqueOrThrow({ where: { id: freshDraft.id }, include: { accessPolicy: true, inviteLinks: true } });
      expect(stored).toMatchObject({ status: "DRAFT", changelog: "Draft notes", accessPolicy: null, inviteLinks: [] });
      expect(await prisma.auditLog.count({ where: { action: "release.published", targetId: freshDraft.id } })).toBe(0);
      expect(await prisma.inviteLink.count({ where: { projectId, label: `Release ${release.versionName}` } })).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back the status and policy when a later database write fails", async () => {
    const release = await draft(true);
    const invalid = input(groupId);
    invalid.accessPolicy.walletAllowlist = [wallet, wallet];
    await expect(publishRelease(ownerId, release.id, invalid)).rejects.toThrow();
    const stored = await prisma.release.findUniqueOrThrow({ where: { id: release.id }, include: { accessPolicy: true, inviteLinks: true } });
    expect(stored).toMatchObject({ status: "DRAFT", changelog: "Draft notes", accessPolicy: null, inviteLinks: [] });
    expect(await prisma.auditLog.count({ where: { action: "release.published", targetId: release.id } })).toBe(0);
  });
});
