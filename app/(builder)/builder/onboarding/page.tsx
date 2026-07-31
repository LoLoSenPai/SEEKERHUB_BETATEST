import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { enrollBuilderAction } from "@/src/features/builders/actions";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";

export default async function BuilderOnboardingPage() {
  const session = await requireSession();
  if (session.user.isAnonymous) redirect("/sign-up?intent=builder&returnTo=/builder/onboarding");
  if (!session.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}&returnTo=/builder/onboarding`);
  if (await prisma.builderProfile.findUnique({ where: { userId: session.user.id } })) redirect("/builder");

  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-2xl"><CardHeader><div className="section-eyebrow">Builder workspace</div><CardTitle>Start with conservative public-beta limits</CardTitle><CardDescription>One project, five retained releases, 250 MiB per APK, and 500 MiB total. Deleted builds continue counting until the seven-day trash period is purged.</CardDescription></CardHeader><CardContent><form action={enrollBuilderAction}><PendingSubmitButton className="w-full" idleLabel="Create builder workspace" pendingLabel="Creating workspace..." /></form></CardContent></Card></main>;
}
