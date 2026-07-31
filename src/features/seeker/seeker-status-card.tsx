"use client";

import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { useDeviceContext } from "@/src/features/seeker/use-device-context";

export function SeekerStatusCard({ verifiedSeeker }: { verifiedSeeker: boolean }) {
  const { context } = useDeviceContext();

  return (
    <Card className="min-w-0 overflow-hidden rounded-[1.6rem]">
      <CardHeader>
        <CardTitle>Seeker access</CardTitle>
        <CardDescription>
          Device detection is guidance only. A release can require recent wallet-based SGT verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-foreground">
        <div className="flex flex-wrap gap-2">
          <Badge variant={verifiedSeeker ? "success" : "neutral"}>{verifiedSeeker ? "SGT verified (24h)" : context.isSeeker ? "Seeker browser hint" : "No current SGT proof"}</Badge>
          <Badge variant={context.isSolanaMobileCapable ? "brand" : "neutral"}>
            {context.isSolanaMobileCapable ? "Solana Mobile capable" : "Standard browser context"}
          </Badge>
          <Badge>{context.hasMobileWalletAdapterContext ? "MWA compatible" : "No MWA signal"}</Badge>
        </div>
        <details className="rounded-xl border border-border bg-muted/40 p-3 text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground">Device details</summary>
          <div className="mt-3 grid gap-2">
            <div>Browser: {context.browserName ?? "Unknown"}</div>
            <div>OS: {context.osName ?? "Unknown"}</div>
            <div>Device class: {context.deviceClass}</div>
            <div>Recognition source: {context.recognitionSource} (advisory only)</div>
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
