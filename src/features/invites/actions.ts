"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";
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

export async function createInviteLinkAction(formData: FormData) {
  const session = await requireSession();
  const projectSlug = String(formData.get("projectSlug"));

  const parsed = inviteInputSchema.safeParse({
    projectId: formData.get("projectId"),
    releaseId: parseNullableString(formData.get("releaseId")),
    testerGroupId: parseNullableString(formData.get("testerGroupId")),
    label: formData.get("label"),
    maxUses: parseNullableString(formData.get("maxUses")),
    expiresAt: parseNullableString(formData.get("expiresAt")),
  });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const message = issue?.message ?? "Invalid invite settings.";

    redirect(buildInvitesPath(projectSlug, { error: message }));
  }

  const project = await prisma.appProject.findUnique({
    where: { id: parsed.data.projectId },
    select: { ownerId: true },
  });

  if (!project || project.ownerId !== session.user.id) {
    throw new Error("Project not found.");
  }

  const token = createInviteToken();

  await prisma.inviteLink.create({
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

  revalidatePath(`/builder/apps/${projectSlug}/invites`);
  redirect(buildInvitesPath(projectSlug, { token }));
}

export async function revokeInviteLinkAction(formData: FormData) {
  const session = await requireSession();
  const projectSlug = String(formData.get("projectSlug"));
  const inviteId = String(formData.get("inviteId"));

  const invite = await prisma.inviteLink.findUnique({
    where: { id: inviteId },
    include: {
      project: {
        select: {
          ownerId: true,
        },
      },
    },
  });

  if (!invite || invite.project.ownerId !== session.user.id) {
    throw new Error("Invite not found.");
  }

  if (!invite.revokedAt) {
    await prisma.inviteLink.update({
      where: { id: invite.id },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  revalidatePath(`/builder/apps/${projectSlug}/invites`);
  redirect(buildInvitesPath(projectSlug));
}
