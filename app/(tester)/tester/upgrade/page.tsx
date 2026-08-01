import { redirect } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { EmailAuthForm } from "@/src/components/auth/email-auth-form";
import { requireTesterSession } from "@/src/lib/session";

export default async function UpgradeTesterAccountPage() {
  const session = await requireTesterSession("/tester/upgrade");
  if (!session.user.isAnonymous) redirect("/tester");

  return (
    <DashboardFrame
      kind="tester"
      currentPath="/tester"
      title="Protect tester access"
      subtitle="Convert this guest session into a durable tester account without losing accepted invites or activity."
      isGuest
      identityLabel="Guest tester"
    >
      <EmailAuthForm mode="sign-in" intent="tester" returnTo="/tester" />
    </DashboardFrame>
  );
}
