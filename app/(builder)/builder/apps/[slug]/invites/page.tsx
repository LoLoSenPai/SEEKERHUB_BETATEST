import { format } from "date-fns";
import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { Select } from "@/src/components/ui/select";
import { InviteLinkCopyButton } from "@/src/features/invites/invite-link-copy-button";
import { createInviteLinkAction, revokeInviteLinkAction } from "@/src/features/invites/actions";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { buildInviteShareUrl, decryptInviteToken } from "@/src/lib/invite";
import { requireSession } from "@/src/lib/session";

export default async function InvitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { token, error } = await searchParams;
  const session = await requireSession();
  const project = await getProjectForOwner(slug, session.user.id);

  if (!project) {
    notFound();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const generatedLink = token ? buildInviteShareUrl(token, appUrl) : null;
  const inviteLinks = project.inviteLinks.map((invite) => {
    let shareUrl: string | null = null;
    const acceptedClaims = invite.inviteClaims.length;
    const grantedSeats = invite.maxUses
      ? invite.inviteClaims.filter((claim) => Boolean(claim.grantedAt)).length
      : acceptedClaims;
    const hasReachedMaxUses = invite.maxUses ? grantedSeats >= invite.maxUses : false;
    const isExpired = Boolean(invite.expiresAt && invite.expiresAt < new Date());
    const isRevoked = Boolean(invite.revokedAt);
    const status = isRevoked ? "revoked" : hasReachedMaxUses ? "consumed" : isExpired ? "expired" : "active";

    if (invite.tokenCiphertext) {
      try {
        shareUrl = buildInviteShareUrl(decryptInviteToken(invite.tokenCiphertext), appUrl);
      } catch {
        shareUrl = null;
      }
    }

    return {
      ...invite,
      acceptedClaims,
      grantedSeats,
      hasReachedMaxUses,
      isExpired,
      isRevoked,
      status,
      shareUrl,
    };
  });

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={`${project.name} invite links`}
      subtitle="Private invite links are the main acquisition path for testers in the MVP."
    >
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Create invite link</CardTitle>
            <CardDescription>Scope a link to the project, a release, or a tester group. Sharing stays manual in v1.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {generatedLink ? (
              <div className="rounded-[1.4rem] bg-emerald-50 p-4 text-sm text-emerald-800">
                <div className="font-semibold">New invite ready</div>
                <div className="mt-2 break-all font-mono text-xs">{generatedLink}</div>
              </div>
            ) : null}
            {error ? (
              <div className="rounded-[1.4rem] bg-rose-50 px-4 py-3 text-sm text-rose-700">
                <div className="font-semibold">Invite not created</div>
                <div className="mt-1">{error}</div>
              </div>
            ) : null}
            <form action={createInviteLinkAction} className="grid gap-5">
              <input type="hidden" name="projectId" value={project.id} />
              <input type="hidden" name="projectSlug" value={project.slug} />
              <div className="grid gap-2">
                <Label htmlFor="label">Label</Label>
                <Input id="label" name="label" placeholder="Core QA wave" required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="releaseId">Release scope</Label>
                <Select id="releaseId" name="releaseId" defaultValue="">
                  <option value="">Project-wide access</option>
                  {project.releases.map((release) => (
                    <option key={release.id} value={release.id}>
                      {release.versionName} ({release.versionCode})
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="testerGroupId">Tester group</Label>
                <Select id="testerGroupId" name="testerGroupId" defaultValue="">
                  <option value="">No tester group</option>
                  {project.testerGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid gap-5 lg:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="maxUses">Max uses</Label>
                  <Input id="maxUses" name="maxUses" type="number" min={1} placeholder="10" />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="expiresAt">Expires at</Label>
                  <Input id="expiresAt" name="expiresAt" type="datetime-local" />
                </div>
              </div>
              <PendingSubmitButton idleLabel="Create invite" pendingLabel="Creating invite..." />
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Existing invite links</CardTitle>
            <CardDescription>Invite claims are counted separately for the MVP analytics layer.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {inviteLinks.length ? (
              inviteLinks.map((invite) => (
                <div key={invite.id} className="rounded-[1.4rem] border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="text-lg font-semibold">{invite.label}</div>
                    <Badge variant="brand">{invite.release?.versionName ?? "Project-wide"}</Badge>
                    <Badge>{invite.testerGroup?.name ?? "No group"}</Badge>
                    <Badge
                      variant={
                        invite.status === "active"
                          ? "success"
                          : invite.status === "revoked"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {invite.status}
                    </Badge>
                  </div>
                  <div className="mt-4 rounded-[1rem] border border-border/70 bg-muted/40 p-3">
                    {invite.shareUrl ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">Share URL</div>
                          <div className="mt-1 break-all font-mono text-xs text-foreground">{invite.shareUrl}</div>
                        </div>
                        <InviteLinkCopyButton url={invite.shareUrl} />
                      </div>
                    ) : (
                      <div className="text-sm text-muted-foreground">
                        This invite was created before reusable link storage was enabled. Create a replacement invite if you need a shareable URL from the dashboard.
                      </div>
                    )}
                  </div>
                  <div className="mt-3 grid gap-2 text-sm text-muted-foreground">
                    <div>{invite.acceptedClaims} raw claims</div>
                    <div>{invite.grantedSeats} granted seats</div>
                    <div>Max uses: {invite.maxUses ?? "Unlimited"}</div>
                    <div>Expires: {invite.expiresAt ? format(invite.expiresAt, "PPP p") : "Never"}</div>
                    {invite.revokedAt ? <div>Revoked: {format(invite.revokedAt, "PPP p")}</div> : null}
                  </div>
                  <div className="mt-4">
                    <form action={revokeInviteLinkAction}>
                      <input type="hidden" name="inviteId" value={invite.id} />
                      <input type="hidden" name="projectSlug" value={project.slug} />
                      <PendingSubmitButton
                        variant="secondary"
                        idleLabel={invite.isRevoked ? "Invite revoked" : "Revoke invite"}
                        pendingLabel="Revoking..."
                        disabled={invite.isRevoked}
                      />
                    </form>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[1.3rem] border border-dashed border-border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                No invite links yet.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </DashboardFrame>
  );
}
