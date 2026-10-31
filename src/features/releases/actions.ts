"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { isPolicyAudienceBroadened } from "@/src/lib/access";
import { prisma } from "@/src/lib/db";
import { reconcilePendingInviteGrants } from "@/src/lib/invite-access";
import { requireBuilderSession } from "@/src/lib/session";
import { accessPolicyInputSchema } from "@/src/lib/validation";

function bool(formData: FormData, name: string) {
  return formData.get(name) === "on";
}

export type ReleasePolicyFormState = { status: "idle" | "success" | "error"; message: string };
class PolicyFormError extends Error {}

export async function updateReleasePolicyAction(formData: FormData): Promise<void>;
export async function updateReleasePolicyAction(state: ReleasePolicyFormState, formData: FormData): Promise<ReleasePolicyFormState>;
export async function updateReleasePolicyAction(input: FormData | ReleasePolicyFormState, submitted?: FormData): Promise<void | ReleasePolicyFormState> {
  const formData = submitted ?? (input as FormData);
  try {
    const message = await saveReleasePolicy(formData);
    if (submitted) return { status: "success", message };
  } catch (error) {
    if (!submitted) throw error;
    return { status: "error", message: error instanceof PolicyFormError ? error.message : "The access policy could not be saved. Refresh and try again." };
  }
}

async function saveReleasePolicy(formData: FormData) {
  const session = await requireBuilderSession();
  const releaseId = String(formData.get("releaseId"));
  const accessPreset = String(formData.get("accessPreset") ?? "invite");
  const parsed = accessPolicyInputSchema.safeParse({
    requireInviteAcceptance: bool(formData, "requireInviteAcceptance"),
    testerGroupId: String(formData.get("testerGroupId") ?? "").trim() || null,
    requireLinkedWallet: bool(formData, "requireLinkedWallet"),
    requireSolanaMobile: bool(formData, "requireSolanaMobile"),
    requireVerifiedSeeker: bool(formData, "requireVerifiedSeeker"),
    allowPreviousReleases: bool(formData, "allowPreviousReleases"),
    walletAllowlist: String(formData.get("walletAllowlist") ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
  });
  if (!parsed.success) throw new PolicyFormError(parsed.error.issues[0]?.message ?? "Invalid access policy.");
  const policy = parsed.data;
  if (!policy.requireInviteAcceptance && policy.walletAllowlist.length === 0) {
    throw new PolicyFormError("Require an invite link or add at least one allowed Solana wallet before saving.");
  }
  if (!["invite", "group", "wallet", "seeker", "custom"].includes(accessPreset)) throw new PolicyFormError("Choose a valid audience preset.");
  if (accessPreset === "wallet" && policy.walletAllowlist.length === 0) {
    throw new PolicyFormError("Add at least one Solana address for the wallet allowlist preset.");
  }
  if (accessPreset === "group" && !policy.testerGroupId) {
    throw new PolicyFormError("Select a tester group for the group-restricted preset.");
  }

  const release = await prisma.$transaction(async (tx) => {
    const release = await tx.release.findFirst({
      where: { id: releaseId, deletedAt: null, project: { ownerId: session.user.id, deletedAt: null } },
      include: { project: true, accessPolicy: { include: { walletEntries: true } } },
    });
    if (!release) throw new PolicyFormError("Release not found.");
    const previous = release.accessPolicy;
    if (previous && isPolicyAudienceBroadened({ ...previous, walletAllowlist: previous.walletEntries.map(({ address }) => address) }, policy) &&
      !bool(formData, "confirmAudienceBroadening")) {
      throw new PolicyFormError("Confirm the audience broadening before saving this policy.");
    }
    if (policy.testerGroupId) {
      const group = await tx.testerGroup.findFirst({ where: { id: policy.testerGroupId, projectId: release.projectId } });
      if (!group) throw new PolicyFormError("Tester group not found in this project.");
    }
    const accessPolicy = await tx.accessPolicy.upsert({
      where: { releaseId },
      create: {
        releaseId,
        requireInviteAcceptance: policy.requireInviteAcceptance,
        testerGroupId: policy.testerGroupId,
        requireLinkedWallet: policy.requireLinkedWallet,
        requireSolanaMobile: policy.requireSolanaMobile,
        requireVerifiedSeeker: policy.requireVerifiedSeeker,
        allowPreviousReleases: policy.allowPreviousReleases,
      },
      update: {
        requireInviteAcceptance: policy.requireInviteAcceptance,
        testerGroupId: policy.testerGroupId,
        requireLinkedWallet: policy.requireLinkedWallet,
        requireSolanaMobile: policy.requireSolanaMobile,
        requireVerifiedSeeker: policy.requireVerifiedSeeker,
        allowPreviousReleases: policy.allowPreviousReleases,
      },
    });
    await tx.accessPolicyWalletEntry.deleteMany({ where: { accessPolicyId: accessPolicy.id } });
    if (policy.walletAllowlist.length) {
      await tx.accessPolicyWalletEntry.createMany({
        data: policy.walletAllowlist.map((address) => ({ accessPolicyId: accessPolicy.id, address })),
      });
    }
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "release.policy_updated", targetType: "Release", targetId: releaseId },
    });
    return release;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

  let reconciliationPending = false;
  try {
    const pendingUsers = await prisma.inviteClaim.findMany({
      where: { grantedAt: null, revokedAt: null, inviteLink: { projectId: release.projectId } },
      distinct: ["userId"],
      select: { userId: true },
    });
    for (const { userId } of pendingUsers) await reconcilePendingInviteGrants(userId, release.projectId);
  } catch {
    reconciliationPending = true;
  }
  revalidatePath(`/builder/apps/${release.project.slug}/releases/${releaseId}`);
  revalidatePath("/tester");
  return reconciliationPending
    ? "Access policy saved. Some pending invitations could not be checked. Ask those testers to retry claiming their invitation explicitly."
    : "Access policy saved.";
}

export async function setReleaseArchivedAction(formData: FormData) {
  const session = await requireBuilderSession();
  const releaseId = String(formData.get("releaseId"));
  const projectSlug = String(formData.get("projectSlug"));
  const archive = formData.get("archive") === "true";
  const release = await prisma.release.findFirst({
    where: { id: releaseId, deletedAt: null, project: { ownerId: session.user.id, deletedAt: null } },
  });
  if (!release) throw new Error("Release not found.");
  if (release.status !== (archive ? "PUBLISHED" : "ARCHIVED")) {
    throw new Error("Only published releases can be archived and only archived releases can be restored. Publish drafts through the publish endpoint.");
  }
  await prisma.$transaction([
    prisma.release.update({
      where: { id: release.id, status: archive ? "PUBLISHED" : "ARCHIVED", deletedAt: null,
        project: { ownerId: session.user.id, deletedAt: null } },
      data: { status: archive ? "ARCHIVED" : "PUBLISHED" },
    }),
    prisma.auditLog.create({
      data: {
        actorUserId: session.user.id,
        action: archive ? "release.archived" : "release.republished",
        targetType: "Release",
        targetId: release.id,
      },
    }),
  ]);
  revalidatePath(`/builder/apps/${projectSlug}`);
  revalidatePath(`/builder/apps/${projectSlug}/releases/${releaseId}`);
}

export async function trashReleaseAction(formData: FormData) {
  const session = await requireBuilderSession();
  const releaseId = String(formData.get("releaseId"));
  const projectSlug = String(formData.get("projectSlug"));
  const release = await prisma.release.findFirst({
    where: { id: releaseId, deletedAt: null, project: { ownerId: session.user.id, deletedAt: null } },
    include: { buildAsset: true },
  });
  if (!release) throw new Error("Release not found.");
  const deletedAt = new Date();
  const purgeAfter = new Date(deletedAt.getTime() + 7 * 24 * 60 * 60_000);
  await prisma.$transaction(async (tx) => {
    await tx.release.update({ where: { id: release.id }, data: { deletedAt, purgeAfter } });
    if (release.buildAsset) {
      await tx.storageDeletionTask.upsert({
        where: { storageKey: release.buildAsset.storageKey },
        create: { storageKey: release.buildAsset.storageKey, resourceType: "Release", resourceId: release.id, scheduledFor: purgeAfter },
        update: { status: "PENDING", scheduledFor: purgeAfter, lastError: null },
      });
    }
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "release.trashed", targetType: "Release", targetId: release.id },
    });
  });
  redirect(`/builder/apps/${projectSlug}`);
}

export async function restoreReleaseAction(formData: FormData) {
  const session = await requireBuilderSession();
  const releaseId = String(formData.get("releaseId"));
  const release = await prisma.release.findFirst({
    where: { id: releaseId, deletedAt: { not: null }, project: { ownerId: session.user.id, deletedAt: null } },
    include: { buildAsset: true },
  });
  if (!release) throw new Error("Release not found in trash.");
  if (release.purgeAfter && release.purgeAfter <= new Date()) {
    throw new Error("This release is already eligible for permanent purge.");
  }
  await prisma.$transaction(async (tx) => {
    if (release.buildAsset) {
      const removedTask = await tx.storageDeletionTask.deleteMany({
        where: { storageKey: release.buildAsset.storageKey, status: { in: ["PENDING", "FAILED"] } },
      });
      if (!removedTask.count) throw new Error("Cleanup has already started; this release can no longer be restored.");
    }
    await tx.release.update({ where: { id: release.id }, data: { deletedAt: null, purgeAfter: null } });
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "release.restored", targetType: "Release", targetId: release.id },
    });
  });
  revalidatePath("/builder/trash");
}
