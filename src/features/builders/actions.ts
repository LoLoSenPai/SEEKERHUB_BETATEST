"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";
import { safeReturnTo } from "@/src/lib/redirect";
import { needsAccountEmail } from "@/src/lib/workspace";

export async function enrollBuilderAction(formData: FormData) {
  const requested = safeReturnTo(String(formData.get("returnTo") ?? ""), "/builder");
  const returnTo = requested.startsWith("/builder/onboarding") ? "/builder" : requested;
  const onboardingUrl = `/builder/onboarding?returnTo=${encodeURIComponent(returnTo)}`;
  const session = await requireSession();
  if (session.user.isAnonymous) redirect(`/sign-in?returnTo=${encodeURIComponent(onboardingUrl)}`);
  if (needsAccountEmail(session.user.email)) redirect(onboardingUrl);
  if (!session.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}&returnTo=${encodeURIComponent(onboardingUrl)}`);

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
  redirect(returnTo);
}
