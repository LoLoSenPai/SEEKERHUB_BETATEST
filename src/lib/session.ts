import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/src/lib/auth";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { AppError } from "@/src/lib/errors";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

async function findBuilderProfile(user: { id: string; email: string }) {
  const adminByEmail = getServerEnv().ADMIN_EMAILS.includes(user.email.toLowerCase());
  const profile = await prisma.builderProfile.findUnique({ where: { userId: user.id } });

  if (!profile && adminByEmail) {
    return prisma.builderProfile.create({
      data: { userId: user.id, isAdmin: true },
    });
  }

  if (profile && adminByEmail && !profile.isAdmin) {
    return prisma.builderProfile.update({ where: { id: profile.id }, data: { isAdmin: true } });
  }

  return profile;
}

export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return session;
}

export async function requireOptionalSession() {
  return getSession();
}

export async function requireTesterSession(returnTo = "/tester") {
  const session = await getSession();
  if (!session) redirect(`/sign-in?intent=tester&returnTo=${encodeURIComponent(returnTo)}`);
  return session;
}

export async function requireBuilderSession() {
  const session = await getSession();
  if (!session || session.user.isAnonymous) redirect("/sign-in?intent=builder&returnTo=/builder");
  if (!session.user.emailVerified) redirect("/verify-email?returnTo=/builder");

  const builderProfile = await findBuilderProfile(session.user);
  if (!builderProfile) redirect("/builder/onboarding");
  if (builderProfile.status === "SUSPENDED") redirect("/account-suspended");

  return { ...session, builderProfile };
}

export async function requireAdminSession() {
  const session = await requireBuilderSession();
  if (!session.builderProfile.isAdmin) redirect("/builder");
  return session;
}

export async function requireBuilderApiSession(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.isAnonymous) {
    throw new AppError("Builder authentication required.", 401, "BUILDER_AUTH_REQUIRED");
  }
  if (!session.user.emailVerified) {
    throw new AppError("Verify your email before using builder tools.", 403, "EMAIL_NOT_VERIFIED");
  }

  const builderProfile = await findBuilderProfile(session.user);
  if (!builderProfile) throw new AppError("Builder enrollment required.", 403, "BUILDER_REQUIRED");
  if (builderProfile.status === "SUSPENDED") {
    throw new AppError("This builder account is suspended.", 403, "BUILDER_SUSPENDED");
  }

  return { ...session, builderProfile };
}
