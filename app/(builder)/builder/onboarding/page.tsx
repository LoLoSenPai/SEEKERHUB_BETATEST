import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { enrollBuilderAction } from "@/src/features/builders/actions";
import { prisma } from "@/src/lib/db";
import { requireSession } from "@/src/lib/session";
import { DEFAULT_MAX_APK_BYTES } from "@/src/lib/quota";
import { formatBytes } from "@/src/lib/utils";
import { safeReturnTo } from "@/src/lib/redirect";

export default async function BuilderOnboardingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const requested = safeReturnTo((await searchParams).returnTo, "/builder");
  const returnTo = requested.startsWith("/builder/onboarding") ? "/builder" : requested;
  const onboardingUrl = `/builder/onboarding?returnTo=${encodeURIComponent(returnTo)}`;
  const session = await requireSession();
  if (session.user.isAnonymous) redirect(`/sign-up?intent=builder&returnTo=${encodeURIComponent(onboardingUrl)}`);
  if (!session.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}&returnTo=${encodeURIComponent(onboardingUrl)}`);
  if (await prisma.builderProfile.findUnique({ where: { userId: session.user.id } })) redirect(returnTo);

  return <main className="page-shell min-h-screen justify-center"><Card className="mx-auto w-full max-w-2xl"><CardHeader><div className="section-eyebrow">Builder workspace</div><CardTitle>Create your builder workspace</CardTitle><CardDescription>Your existing account also keeps its tester access.</CardDescription></CardHeader><CardContent className="space-y-5"><ul className="space-y-2 text-sm"><li>1 app project and 5 retained releases.</li><li>Up to {formatBytes(BigInt(DEFAULT_MAX_APK_BYTES))} per APK, within 500 MiB total storage.</li><li>Uploads temporarily need room for the uploaded and checked copies. Trash keeps counting until it is purged after seven days.</li></ul><form action={enrollBuilderAction}><input type="hidden" name="returnTo" value={returnTo} /><PendingSubmitButton className="w-full" idleLabel="Create builder workspace" pendingLabel="Creating workspace..." /></form></CardContent></Card></main>;
}
