"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { authClient } from "@/src/lib/auth-client";
import { useDeviceContext } from "@/src/features/seeker/use-device-context";

export function InviteClaimCard({
  token,
  label,
  projectName,
  releaseVersion,
}: {
  token: string;
  label: string;
  projectName: string;
  releaseVersion?: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const { persistDeviceProfile } = useDeviceContext();

  return (
    <Card className="rounded-[2rem] border-border bg-surface shadow-[0_24px_90px_rgba(15,23,42,0.08)]">
      <CardHeader>
        <div className="section-eyebrow">Invite access</div>
        <CardTitle>{label}</CardTitle>
        <CardDescription>
          Claim access to {projectName}
          {releaseVersion ? ` (${releaseVersion})` : ""}. If you do not have a tester account yet, SeekerHub creates a lightweight guest session first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          size="lg"
          disabled={loading}
          onClick={async () => {
            setLoading(true);
            try {
              const session = await authClient.getSession();
              if (!session.data) {
                const guestResult = await authClient.signIn.anonymous();
                if (guestResult.error) {
                  throw new Error(guestResult.error.message);
                }
              }

              await persistDeviceProfile();

              const response = await fetch(`/api/invites/${token}/claim`, {
                method: "POST",
              });
              const payload = await response.json();

              if (!response.ok) {
                throw new Error(payload.error ?? "Unable to claim invite.");
              }

              toast.success("Invite claimed.");
              router.push(payload.redirectTo ?? "/tester");
              router.refresh();
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Invite claim failed.");
            } finally {
              setLoading(false);
            }
          }}
        >
          {loading ? "Claiming access..." : "Claim invite"}
        </Button>
      </CardContent>
    </Card>
  );
}
