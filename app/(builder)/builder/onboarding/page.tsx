import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { AddAccountEmailForm } from "@/src/components/auth/add-account-email-form";
import { enrollBuilderAction } from "@/src/features/builders/actions";
import { prisma } from "@/src/lib/db";
import { getSession } from "@/src/lib/session";
import { DEFAULT_MAX_APK_BYTES } from "@/src/lib/quota";
import { formatBytes } from "@/src/lib/utils";
import { safeReturnTo } from "@/src/lib/redirect";
import { needsAccountEmail } from "@/src/lib/workspace";

export default async function BuilderOnboardingPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const requested = safeReturnTo((await searchParams).returnTo, "/builder");
  const returnTo = requested.startsWith("/builder/onboarding") ? "/builder" : requested;
  const onboardingUrl = `/builder/onboarding?returnTo=${encodeURIComponent(returnTo)}`;
  const session = await getSession();
  if (!session || session.user.isAnonymous) redirect(`/sign-in?returnTo=${encodeURIComponent(onboardingUrl)}`);
  if (needsAccountEmail(session.user.email)) {
    return <DashboardFrame kind="builder" currentPath="/builder/onboarding" title="Start publishing" subtitle="Keep your wallet, apps and feedback in the same account." identityLabel="Wallet account">
      <Card className="max-w-xl"><CardHeader><div className="section-eyebrow">1 / 2 - Verify an email</div><CardTitle>Add your publishing email</CardTitle><CardDescription>A verified email is required to publish. This adds an email to your current wallet account; it does not create another account or change your tester access.</CardDescription></CardHeader><CardContent className="mt-5"><AddAccountEmailForm returnTo={onboardingUrl} /></CardContent></Card>
    </DashboardFrame>;
  }
  if (!session.user.emailVerified) redirect(`/verify-email?email=${encodeURIComponent(session.user.email)}&returnTo=${encodeURIComponent(onboardingUrl)}`);
  const profile = await prisma.builderProfile.findUnique({ where: { userId: session.user.id } });
  if (profile?.status === "SUSPENDED") redirect("/account-suspended");
  if (profile) redirect(returnTo);

  return <DashboardFrame kind="builder" currentPath="/builder/onboarding" title="Start publishing" subtitle="Your account can publish and test apps. No second sign-up needed." identityLabel={session.user.email}><Card className="max-w-2xl"><CardHeader><div className="section-eyebrow">Email verified - Activate publishing</div><CardTitle>Your first publishing workspace</CardTitle><CardDescription>Activate publishing when you are ready to share an app. Your tester library stays exactly as it is.</CardDescription></CardHeader><CardContent className="mt-4 space-y-5"><ul className="space-y-2 text-sm"><li>1 app project and 5 retained releases.</li><li>Up to {formatBytes(BigInt(DEFAULT_MAX_APK_BYTES))} per APK, within 500 MiB total storage.</li><li>Uploads temporarily need room for the uploaded and checked copies. Trash keeps counting until it is purged after seven days.</li></ul><form action={enrollBuilderAction}><input type="hidden" name="returnTo" value={returnTo} /><PendingSubmitButton className="w-full" idleLabel="Activate publishing" pendingLabel="Opening your workspace..." /></form></CardContent></Card></DashboardFrame>;
}
