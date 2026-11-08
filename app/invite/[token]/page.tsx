import Link from "next/link";
import { InviteClaimCard } from "@/src/features/invites/invite-claim-card";
import { getInvitePreview, getTesterIdentity } from "@/src/features/projects/queries";
import { WalletProviders } from "@/src/features/wallet/wallet-providers";
import { getInviteWalletRequirements } from "@/src/features/wallet/invite-wallet-requirements";
import { getSession } from "@/src/lib/session";
import { getTesterIdentityLabel } from "@/src/lib/tester-identity";
import { AppBanner, AppIcon } from "@/src/features/project-media/app-media";
import { getProjectMedia } from "@/src/features/project-media/queries";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invite, session] = await Promise.all([getInvitePreview(token), getSession()]);

  if (!invite) {
    return <main className="page-shell min-h-screen justify-center"><div className="mx-auto w-full max-w-lg rounded-[2rem] border border-border bg-surface p-6"><h1 className="text-2xl font-semibold">This invitation is unavailable</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">The link may be invalid, expired or revoked. Ask the builder for a new invitation. If you already have access, try signing in to recover it.</p><Link href="/sign-in?intent=tester&returnTo=%2Ftester" className="mt-5 inline-block font-semibold hover:underline">Recover tester access</Link></div></main>;
  }

  const requirements = getInviteWalletRequirements(invite.release
    ? [invite.release.accessPolicy]
    : invite.project.releases.map((release) => release.accessPolicy));
  const tester = session && !session.user.isAnonymous ? await getTesterIdentity(session.user.id) : null;
  const currentIdentity = tester ? getTesterIdentityLabel(tester) : null;
  const media = await getProjectMedia(invite.project.id);

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-10">
      <div className="absolute inset-0 bg-gradient-to-b from-brand/10 via-background to-background" />
      <div className="relative mx-auto grid max-w-4xl items-center gap-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-4">
          <AppBanner media={media} className="aspect-[3/1]" />
          <div className="section-eyebrow">You&apos;re invited to test</div>
          <div className="flex min-w-0 items-center gap-4"><AppIcon media={media} name={invite.project.name} /><h1 className="min-w-0 break-words text-4xl font-semibold tracking-tight text-foreground">{invite.project.name}</h1></div>
          <p className="max-w-xl text-base leading-7 text-muted-foreground">{invite.project.description || "A private Android beta, shared with you by its builder."}</p>
          <p className="text-sm text-muted-foreground">Open the beta, download the APK, then share your feedback.</p>
          <details className="text-sm text-muted-foreground"><summary className="cursor-pointer font-semibold">Invitation details</summary><p className="mt-2">{invite.release?.versionName ? `Version ${invite.release.versionName}` : "Project invitation"} · {invite.expiresAt ? `Expires ${invite.expiresAt.toLocaleString()}` : "No expiry"}</p></details>
        </div>
        <div className="min-w-0">
          <WalletProviders><InviteClaimCard token={token} projectName={invite.project.name} releaseVersion={invite.release?.versionName ?? null} currentIdentity={currentIdentity} combinedSeekerCheck={requirements.seekerRequired && (!invite.release || invite.release.status === "PUBLISHED")} {...requirements} /></WalletProviders>
        </div>
      </div>
    </main>
  );
}
