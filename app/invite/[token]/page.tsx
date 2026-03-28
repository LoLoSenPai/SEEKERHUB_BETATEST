import { notFound } from "next/navigation";
import { InviteClaimCard } from "@/src/features/invites/invite-claim-card";
import { getInvitePreview } from "@/src/features/projects/queries";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await getInvitePreview(token);

  if (!invite) {
    notFound();
  }

  return (
    <main className="relative min-h-screen overflow-hidden px-5 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(93,135,255,0.18),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(77,187,148,0.12),transparent_24%)]" />
      <div className="absolute inset-0 bg-gradient-to-b from-background via-background to-muted/70" />
      <div className="relative mx-auto grid max-w-5xl items-center gap-10 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="space-y-5">
          <div className="section-eyebrow">Private invite</div>
          <h1 className="text-5xl font-semibold tracking-tight text-foreground">{invite.project.name}</h1>
          <p className="max-w-xl text-lg leading-8 text-muted-foreground">
            This invite unlocks a private Android beta flow built for Solana mobile builders. Claim the link to open the tester dashboard and private release pages.
          </p>
          <div className="grid gap-2 text-sm text-muted-foreground">
            <div>Release scope: {invite.release?.versionName ?? "Project-wide"}</div>
            <div>Tester group: {invite.testerGroup?.name ?? "No tester group"}</div>
            <div>Expires: {invite.expiresAt ? invite.expiresAt.toLocaleString() : "Never"}</div>
          </div>
        </div>
        <InviteClaimCard
          token={token}
          label={invite.label}
          projectName={invite.project.name}
          releaseVersion={invite.release?.versionName ?? null}
        />
      </div>
    </main>
  );
}
