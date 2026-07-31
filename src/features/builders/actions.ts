"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";

export async function enrollBuilderAction() {
  const session = await requireSession();
  if (session.user.isAnonymous) redirect("/sign-up?intent=builder&returnTo=/builder/onboarding");
  if (!session.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}&returnTo=/builder/onboarding`);

  await prisma.$transaction(async (tx) => {
    await tx.builderProfile.upsert({
      where: { userId: session.user.id },
      create: { userId: session.user.id },
      update: {},
    });
    await tx.auditLog.create({
      data: {
        actorUserId: session.user.id,
        action: "builder.enrolled",
        targetType: "BuilderProfile",
        targetId: session.user.id,
      },
    });
  });
  redirect("/builder");
}
