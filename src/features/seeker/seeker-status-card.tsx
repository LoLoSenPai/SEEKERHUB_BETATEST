"use client";

import { Badge } from "@/src/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { useDeviceContext } from "@/src/features/seeker/use-device-context";

export function SeekerStatusCard({ verifiedSeeker }: { verifiedSeeker: boolean }) {
  const { context } = useDeviceContext(verifiedSeeker);

  return (
    <Card className="rounded-[1.6rem]">
      <CardHeader>
        <CardTitle>Device and Solana Mobile context</CardTitle>
        <CardDescription>
          Web-first device detection stays conservative: capability signals are immediate, strict Seeker proof only comes from wallet verification.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-foreground">
        <div className="flex flex-wrap gap-2">
          <Badge variant={context.isSeeker ? "success" : "neutral"}>{context.isSeeker ? "Seeker aware" : "Not verified as Seeker"}</Badge>
          <Badge variant={context.isSolanaMobileCapable ? "brand" : "neutral"}>
            {context.isSolanaMobileCapable ? "Solana Mobile capable" : "Standard browser context"}
          </Badge>
          <Badge>{context.hasMobileWalletAdapterContext ? "MWA compatible" : "No MWA signal"}</Badge>
        </div>
        <div>Browser: {context.browserName ?? "Unknown"}</div>
        <div>OS: {context.osName ?? "Unknown"}</div>
        <div>Device class: {context.deviceClass}</div>
        <div>Recognition source: {context.recognitionSource}</div>
      </CardContent>
    </Card>
  );
}
