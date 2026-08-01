import { format } from "date-fns";
import { notFound } from "next/navigation";
import { DashboardFrame } from "@/src/components/layout/dashboard-frame";
import { BuilderJourney } from "@/src/components/layout/builder-journey";
import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { FieldLabel } from "@/src/components/ui/field-help";
import { Input } from "@/src/components/ui/input";
import { PendingSubmitButton } from "@/src/components/ui/pending-submit-button";
import { Select } from "@/src/components/ui/select";
import { InviteLinkCopyButton } from "@/src/features/invites/invite-link-copy-button";
import { InviteExpiryField } from "@/src/features/invites/invite-expiry-field";
import { createInviteLinkAction, revokeInviteLinkAction } from "@/src/features/invites/actions";
import { getProjectForOwner } from "@/src/features/projects/queries";
import { buildInviteShareUrl, decryptInviteToken } from "@/src/lib/invite";
import { requireBuilderSession } from "@/src/lib/session";

export default async function InvitesPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ created?: string; error?: string }>;
}) {
  const { slug } = await params;
  const { created, error } = await searchParams;
  const session = await requireBuilderSession();
  const project = await getProjectForOwner(slug, session.user.id);

  if (!project) {
    notFound();
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const inviteLinks = project.inviteLinks.map((invite) => {
    let shareUrl: string | null = null;
    const acceptedClaims = invite.inviteClaims.length;
    const grantedSeats = invite.inviteClaims.filter((claim) => Boolean(claim.grantedAt)).length;
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
  const generatedLink = created ? inviteLinks.find((invite) => invite.id === created)?.shareUrl ?? null : null;

  return (
    <DashboardFrame
      kind="builder"
      currentPath="/builder"
      title={`${project.name} invite links`}
      subtitle="Create a shareable link, set its tester limit, and decide which release or group it unlocks."
      identityLabel={session.user.email}
    >
      <BuilderJourney
        projectSlug={project.slug}
        current="invite"
        releaseCount={project.releases.length}
        inviteCount={project.inviteLinks.length}
        downloadCount={project.releases.reduce((total, release) => total + release.downloadEvents.length, 0)}
      />
      <Card className="mb-6 rounded-[1.75rem] border-brand/25 bg-brand/5">
        <CardContent className="grid gap-4 p-5 md:grid-cols-3">
          <div><div className="font-semibold">Limited tester link</div><p className="mt-1 text-sm leading-6 text-muted-foreground">Set a Tester limit. Only eligible claims consume one of those places.</p></div>
          <div><div className="font-semibold">One release only</div><p className="mt-1 text-sm leading-6 text-muted-foreground">Select a release when the link must not unlock later builds.</p></div>
          <div><div className="font-semibold">Controlled cohort</div><p className="mt-1 text-sm leading-6 text-muted-foreground">Select a tester group when access should follow a reusable team.</p></div>
        </CardContent>
      </Card>
      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Create invite link</CardTitle>
            <CardDescription>Choose what the link unlocks, how many eligible testers it accepts, and when it expires.</CardDescription>
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
                <FieldLabel htmlFor="label" helpTitle="Internal label" help="Only builders see this name. Use it to recognize where the link was shared.">Internal label</FieldLabel>
                <Input id="label" name="label" placeholder="Core QA wave" required />
              </div>
              <div className="grid gap-2">
                <FieldLabel htmlFor="releaseId" helpTitle="Release scope" help="Project-wide links can grant access to current and future eligible releases. Select one release for a single-build campaign.">Release scope</FieldLabel>
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
                <FieldLabel htmlFor="testerGroupId" helpTitle="Tester group" help="Optional. The tester receives a membership in this reusable cohort only after all release requirements are satisfied.">Tester group</FieldLabel>
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
                  <FieldLabel
                    htmlFor="maxUses"
                    helpTitle="Tester limit"
                    help="Counts eligible tester identities that receive access, not raw link opens. Guest sessions are browser-based; require an email, wallet, or SGT when the limit must map to a durable identity. Leave empty for no limit."
                  >
                    Tester limit
                  </FieldLabel>
                  <Input id="maxUses" name="maxUses" type="number" min={1} placeholder="10" />
                </div>
                <InviteExpiryField />
              </div>
              <PendingSubmitButton idleLabel="Create share link" pendingLabel="Creating share link..." />
            </form>
          </CardContent>
        </Card>

        <Card className="rounded-[1.75rem]">
          <CardHeader>
            <CardTitle>Existing invite links</CardTitle>
            <CardDescription>Copy active links again at any time, review granted places, or revoke future claims.</CardDescription>
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
                    <div>{invite.acceptedClaims} tester sessions claimed this link</div>
                    <div>{invite.grantedSeats} eligible testers granted access</div>
                    <div>Tester limit: {invite.maxUses ?? "Unlimited"}</div>
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
