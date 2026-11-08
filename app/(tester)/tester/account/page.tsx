import Link from "next/link";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { WalletLinkCard } from "@/src/features/wallet/wallet-link-card";
import { WalletSignIn } from "@/src/features/wallet/wallet-sign-in";
import { getTesterIdentity } from "@/src/features/projects/queries";
import { prisma } from "@/src/lib/db";
import { requireTesterSession } from "@/src/lib/session";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";
import { needsAccountEmail } from "@/src/lib/workspace";
import { AddAccountEmailForm } from "@/src/components/auth/add-account-email-form";

export default async function TesterAccountPage() {
  const session = await requireTesterSession("/tester/account");
  const [tester, builder] = await Promise.all([getTesterIdentity(session.user.id), prisma.builderProfile.findUnique({ where: { userId: session.user.id }, select: { id: true } })]);
  return <DashboardFrame kind="tester" currentPath="/tester/account" title="Account" subtitle="One account for publishing, testing and recovery." canBuild={Boolean(builder)} isGuest={Boolean(session.user.isAnonymous)} identityLabel={getTesterIdentityLabel({ ...session.user, wallets: tester?.wallets })} identityWalletAddress={(tester?.wallets.find((wallet) => wallet.isPrimary) ?? tester?.wallets[0])?.address}>
    <div className="grid max-w-3xl gap-5">
      {session.user.isAnonymous ? <section className="rounded-2xl border border-brand/25 bg-brand/5 p-5"><h2 className="text-lg font-semibold">Keep your apps and feedback</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Guest access is tied to this browser. Add a recovery email or connect a wallet to keep this account when you change browsers.</p><Link href="/tester/upgrade?returnTo=%2Ftester%2Faccount" className="mt-4 inline-block font-semibold underline">Add recovery email</Link><WalletSignIn returnTo="/tester/account" /></section> : <section className="rounded-2xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Your tester account</h2><p className="mt-2 break-words text-sm text-muted-foreground">Signed in as {getTesterIdentityLabel({ ...session.user, wallets: tester?.wallets })}. Use the same account to return to your apps and feedback.</p></section>}
      {!session.user.isAnonymous ? <WalletLinkCard linkedWallets={tester?.wallets ?? []} /> : null}
      {!session.user.isAnonymous && needsAccountEmail(session.user.email) ? <section className="rounded-2xl border border-border bg-card p-5"><h2 className="text-lg font-semibold">Add an email to this account</h2><p className="mb-5 mt-2 text-sm leading-6 text-muted-foreground">Keep wallet sign-in and add an email as another way back in. A verified email also lets you activate publishing.</p><AddAccountEmailForm returnTo="/tester/account" /></section> : null}
    </div>
  </DashboardFrame>;
}
