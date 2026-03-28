import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";

type AccessPolicySummaryProps = {
  title?: string;
  description?: string;
  policy:
    | {
        requireInviteAcceptance: boolean;
        requireLinkedWallet: boolean;
        requireSolanaMobile: boolean;
        requireVerifiedSeeker: boolean;
        allowPreviousReleases: boolean;
        testerGroup?: { name: string } | null;
        walletEntries: { id?: string; address: string }[];
      }
    | null
    | undefined;
  reasons?: string[];
};

function StatusBadge({ enabled, enabledLabel, disabledLabel }: { enabled: boolean; enabledLabel: string; disabledLabel: string }) {
  return <Badge variant={enabled ? "brand" : "neutral"}>{enabled ? enabledLabel : disabledLabel}</Badge>;
}

export function AccessPolicySummary({
  title = "Access policy",
  description = "Server-side rules that control who can view, download, and leave feedback on this release.",
  policy,
  reasons = [],
}: AccessPolicySummaryProps) {
  if (!policy) {
    return (
      <Card className="rounded-[1.75rem]">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">No access policy attached to this release.</CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-[1.75rem]">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <StatusBadge enabled={policy.requireInviteAcceptance} enabledLabel="Invite required" disabledLabel="No invite required" />
          <StatusBadge enabled={policy.requireLinkedWallet} enabledLabel="Wallet required" disabledLabel="Wallet optional" />
          <StatusBadge enabled={policy.requireSolanaMobile} enabledLabel="Solana Mobile required" disabledLabel="Any browser allowed" />
          <StatusBadge enabled={policy.requireVerifiedSeeker} enabledLabel="Verified Seeker required" disabledLabel="Seeker optional" />
          <StatusBadge enabled={policy.allowPreviousReleases} enabledLabel="Previous builds visible" disabledLabel="Current build only" />
        </div>

        <div className="grid gap-3 text-sm text-foreground">
          <div>Tester group: {policy.testerGroup?.name ?? "None"}</div>
          <div>
            Wallet allowlist:
            <div className="mt-2 flex flex-wrap gap-2">
              {policy.walletEntries.length ? (
                policy.walletEntries.map((entry) => <Badge key={entry.id ?? entry.address}>{entry.address}</Badge>)
              ) : (
                <Badge>No allowlist entries</Badge>
              )}
            </div>
          </div>
        </div>

        {reasons.length ? (
          <div className="rounded-[1.2rem] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
            <div className="font-semibold">Current blockers</div>
            <div className="mt-2 grid gap-1">
              {reasons.map((reason) => (
                <div key={reason}>{reason}</div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
