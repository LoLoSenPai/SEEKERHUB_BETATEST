/* eslint-disable @next/next/no-img-element -- Private, short-lived URLs must not enter the shared image optimizer cache. */
import { AppWindow } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { ProjectMediaItem } from "./types";
import { PrivateMediaImage } from "./private-media-image";

export function AppIcon({ media, name, className }: { media: ProjectMediaItem[]; name: string; className?: string }) {
  const icon = media.find((item) => item.kind === "ICON");
  return <div className={cn("flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-border bg-surface text-muted-foreground", className)}>
    {icon ? <PrivateMediaImage key={`${icon.id}:${icon.url}`} id={icon.id} src={icon.url} alt={`${name} icon`} width={icon.width} height={icon.height} className="size-full object-cover" fallback={<AppWindow className="size-7" role="img" aria-label={`${name} app`} />} />
      : <AppWindow className="size-7" role="img" aria-label={`${name} app`} />}
  </div>;
}

export function AppBanner({ media, className }: { media: ProjectMediaItem[]; className?: string }) {
  const banner = media.find((item) => item.kind === "BANNER");
  return <div className={cn("aspect-video w-full overflow-hidden rounded-2xl bg-surface", className)}>
    {banner ? <PrivateMediaImage key={`${banner.id}:${banner.url}`} id={banner.id} src={banner.url} alt="" width={banner.width} height={banner.height} className="size-full object-cover"
      fallback={<img src="/images/workspace-atmosphere.png" alt="" width={1600} height={900} className="size-full object-cover" />} />
      : <img src="/images/workspace-atmosphere.png" alt="" width={1600} height={900} className="size-full object-cover" />}
  </div>;
}

export function AppScreenshots({ media, className }: { media: ProjectMediaItem[]; className?: string }) {
  const screenshots = media.filter((item) => item.kind === "SCREENSHOT").sort((a, b) => a.position - b.position);
  if (!screenshots.length) return null;
  return <div className={cn("flex snap-x gap-4 overflow-x-auto pb-3", className)} aria-label="App screenshots">
    {screenshots.map((item, index) => <PrivateMediaImage key={`${item.id}:${item.url}`} id={item.id} src={item.url} alt={`App screenshot ${index + 1}`} width={item.width} height={item.height}
      className="h-64 w-auto max-w-[85%] shrink-0 snap-start rounded-xl border border-border object-contain" />)}
  </div>;
}
