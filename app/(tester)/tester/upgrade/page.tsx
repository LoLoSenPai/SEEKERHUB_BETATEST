import { redirect } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { EmailAuthForm } from "@/src/components/auth/email-auth-form";
import { requireTesterSession } from "@/src/lib/session";
import { safeReturnTo } from "@/src/lib/redirect";

export default async function UpgradeTesterAccountPage({ searchParams }: { searchParams: Promise<{ returnTo?: string }> }) {
  const returnTo = safeReturnTo((await searchParams).returnTo, "/tester");
  const session = await requireTesterSession("/tester/upgrade");
  if (!session.user.isAnonymous) redirect(returnTo);

  return (
    <DashboardFrame
      kind="tester"
      currentPath="/tester"
      title="Protect tester access"
      subtitle="Convert this guest session into a durable tester account without losing accepted invites or activity."
      isGuest
      identityLabel="Guest tester"
    >
      <EmailAuthForm mode="sign-in" intent="tester" returnTo={returnTo} />
    </DashboardFrame>
  );
}
