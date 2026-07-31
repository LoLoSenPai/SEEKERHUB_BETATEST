"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/src/lib/db";
import { requireBuilderSession } from "@/src/lib/session";

export async function createTesterGroupAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectId = String(formData.get("projectId"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  const projectSlug = String(formData.get("projectSlug"));

  if (!name) {
    throw new Error("Group name is required.");
  }

  const project = await prisma.appProject.findFirst({
    where: { id: projectId, deletedAt: null },
    select: { ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  await prisma.testerGroup.create({
    data: {
      projectId,
      name,
      description: description || null,
    },
  });

  revalidatePath(`/builder/apps/${projectSlug}/groups`);
}

export async function updateTesterGroupAction(formData: FormData) {
  const session = await requireBuilderSession();
  const groupId = String(formData.get("groupId"));
  const projectSlug = String(formData.get("projectSlug"));
  const name = String(formData.get("name") ?? "").trim();
  const description = String(formData.get("description") ?? "").trim();
  if (!name) throw new Error("Group name is required.");
  const group = await prisma.testerGroup.findFirst({
    where: { id: groupId, project: { ownerId: session.user.id, deletedAt: null } },
  });
  if (!group) throw new Error("Tester group not found.");
  await prisma.testerGroup.update({ where: { id: group.id }, data: { name, description: description || null } });
  revalidatePath(`/builder/apps/${projectSlug}/groups`);
}

export async function deleteTesterGroupAction(formData: FormData) {
  const session = await requireBuilderSession();
  const groupId = String(formData.get("groupId"));
  const projectSlug = String(formData.get("projectSlug"));
  const group = await prisma.testerGroup.findFirst({
    where: { id: groupId, project: { ownerId: session.user.id, deletedAt: null } },
    include: { _count: { select: { accessPolicies: true, inviteLinks: true, memberships: true } } },
  });
  if (!group) throw new Error("Tester group not found.");
  if (group._count.accessPolicies || group._count.inviteLinks || group._count.memberships) {
    throw new Error("Remove this group from releases, invites, and memberships before deleting it.");
  }
  await prisma.testerGroup.delete({ where: { id: group.id } });
  revalidatePath(`/builder/apps/${projectSlug}/groups`);
}

export async function revokeTesterAccessAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectId = String(formData.get("projectId"));
  const userId = String(formData.get("userId"));
  const projectSlug = String(formData.get("projectSlug"));
  const project = await prisma.appProject.findFirst({
    where: { id: projectId, ownerId: session.user.id, deletedAt: null },
  });
  if (!project) throw new Error("Project not found.");
  const revokedAt = new Date();
  await prisma.$transaction([
    prisma.testerAccess.upsert({
      where: { projectId_userId: { projectId, userId } },
      create: { projectId, userId, revokedAt },
      update: { revokedAt },
    }),
    prisma.testerMembership.updateMany({ where: { projectId, userId }, data: { revokedAt } }),
    prisma.inviteClaim.updateMany({ where: { userId, inviteLink: { projectId } }, data: { revokedAt } }),
    prisma.auditLog.create({
      data: { actorUserId: session.user.id, action: "tester.revoked", targetType: "User", targetId: userId, metadataJson: { projectId } },
    }),
  ]);
  revalidatePath(`/builder/apps/${projectSlug}/groups`);
}

export async function reactivateTesterAccessAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectId = String(formData.get("projectId"));
  const userId = String(formData.get("userId"));
  const projectSlug = String(formData.get("projectSlug"));
  const project = await prisma.appProject.findFirst({
    where: { id: projectId, ownerId: session.user.id, deletedAt: null },
  });
  if (!project) throw new Error("Project not found.");
  await prisma.$transaction([
    prisma.testerAccess.updateMany({ where: { projectId, userId }, data: { revokedAt: null } }),
    prisma.auditLog.create({
      data: { actorUserId: session.user.id, action: "tester.reactivated", targetType: "User", targetId: userId, metadataJson: { projectId } },
    }),
  ]);
  revalidatePath(`/builder/apps/${projectSlug}/groups`);
}
