"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import { requireBuilderSession } from "@/src/lib/session";
import { createInviteToken, encryptInviteToken, hashInviteToken } from "@/src/lib/invite";
import { inviteInputSchema } from "@/src/lib/validation";

function parseNullableString(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function buildInvitesPath(projectSlug: string, params?: Record<string, string>) {
  const searchParams = new URLSearchParams(params);
  const queryString = searchParams.toString();
  return queryString ? `/builder/apps/${projectSlug}/invites?${queryString}` : `/builder/apps/${projectSlug}/invites`;
}

function parseLocalExpiration(formData: FormData) {
  const value = parseNullableString(formData.get("expiresAt"));
  if (!value) return null;
  const timezoneOffset = Number(formData.get("timezoneOffset") ?? 0);
  if (!Number.isFinite(timezoneOffset) || Math.abs(timezoneOffset) > 14 * 60) return value;
  const localAsUtc = new Date(`${value}:00Z`);
  if (Number.isNaN(localAsUtc.getTime())) return value;
  return new Date(localAsUtc.getTime() + timezoneOffset * 60_000).toISOString();
}

export async function createInviteLinkAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectSlug = String(formData.get("projectSlug"));

  const parsed = inviteInputSchema.safeParse({
    projectId: formData.get("projectId"),
    releaseId: parseNullableString(formData.get("releaseId")),
    testerGroupId: parseNullableString(formData.get("testerGroupId")),
    label: formData.get("label"),
    maxUses: parseNullableString(formData.get("maxUses")),
    expiresAt: parseLocalExpiration(formData),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ?? "Invalid invite settings.";

    redirect(buildInvitesPath(projectSlug, { error: message }));
  }
  if (parsed.data.expiresAt && new Date(parsed.data.expiresAt) <= new Date()) {
    redirect(buildInvitesPath(projectSlug, { error: "Invite expiration must be in the future." }));
  }

  const project = await prisma.appProject.findFirst({
    where: { id: parsed.data.projectId, deletedAt: null },
    select: { ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  const [release, testerGroup] = await Promise.all([
    parsed.data.releaseId
      ? prisma.release.findFirst({ where: { id: parsed.data.releaseId, projectId: parsed.data.projectId, deletedAt: null } })
      : null,
    parsed.data.testerGroupId
      ? prisma.testerGroup.findFirst({ where: { id: parsed.data.testerGroupId, projectId: parsed.data.projectId } })
      : null,
  ]);
  if (parsed.data.releaseId && !release) throw new Error("The selected release does not belong to this project.");
  if (parsed.data.testerGroupId && !testerGroup) throw new Error("The selected tester group does not belong to this project.");

  const token = createInviteToken();

  const invite = await prisma.$transaction(async (tx) => {
    const invite = await tx.inviteLink.create({
      data: {
        projectId: parsed.data.projectId,
        releaseId: parsed.data.releaseId,
        testerGroupId: parsed.data.testerGroupId,
        createdById: session.user.id,
        label: parsed.data.label,
        tokenHash: hashInviteToken(token),
        tokenCiphertext: encryptInviteToken(token),
        maxUses: parsed.data.maxUses ?? null,
        expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
      },
    });
    await tx.auditLog.create({
      data: { actorUserId: session.user.id, action: "invite.created", targetType: "InviteLink", targetId: invite.id },
    });
    return invite;
  });

  revalidatePath(`/builder/apps/${projectSlug}/invites`);
  redirect(buildInvitesPath(projectSlug, { created: invite.id }));
}

export async function revokeInviteLinkAction(formData: FormData) {
  const session = await requireBuilderSession();
  const projectSlug = String(formData.get("projectSlug"));
  const inviteId = String(formData.get("inviteId"));

  const invite = await prisma.inviteLink.findUnique({
    where: { id: inviteId },
    include: {
      project: {
        select: {
          ownerId: true,
          deletedAt: true,
        },
      },
    },
  });

  if (!invite || invite.project.ownerId !== session.user.id || invite.project.deletedAt) {
    throw new Error("Invite not found.");
  }

  if (!invite.revokedAt) {
    await prisma.$transaction(async (tx) => {
      await tx.inviteLink.update({ where: { id: invite.id }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({
        data: { actorUserId: session.user.id, action: "invite.revoked", targetType: "InviteLink", targetId: invite.id },
      });
    });
  }

  revalidatePath(`/builder/apps/${projectSlug}/invites`);
  redirect(buildInvitesPath(projectSlug));
}
