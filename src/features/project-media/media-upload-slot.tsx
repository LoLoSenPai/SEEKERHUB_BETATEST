"use client";

import { ImageOff, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import type { ProjectMediaItem } from "./types";
import { MediaFilePicker } from "./media-file-picker";
import { PrivateMediaImage } from "./private-media-image";

export function MediaPreview({ item, alt, className }: { item: ProjectMediaItem; alt: string; className?: string }) {
  return <div className={cn("flex min-w-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-surface", className)}>
    <PrivateMediaImage key={`${item.id}:${item.url}`} id={item.id} src={item.url} alt={alt}
      width={item.width} height={item.height} className="size-full object-contain"
      fallback={<span className="flex flex-col items-center gap-2 p-3 text-center text-xs text-muted-foreground"><ImageOff className="size-5" aria-hidden="true" />Preview unavailable</span>} />
  </div>;
}

export function MediaUploadSlot({ kind, item, disabled, onUpload, onRemove }: {
  kind: "ICON" | "BANNER";
  item?: ProjectMediaItem;
  disabled: boolean;
  onUpload: (file: File, replaceId?: string) => void;
  onRemove: (id: string) => void;
}) {
  const isIcon = kind === "ICON";
  const name = isIcon ? "App icon" : "App banner";
  const dimensions = isIcon ? "512 x 512" : "1200 x 600";
  const aspect = isIcon ? "aspect-square" : "aspect-[2/1]";
  return <div className={cn("grid min-w-0 content-start gap-3", isIcon && "max-w-36")}>
    <div><h3 className="text-sm font-semibold">{name}</h3><p className="mt-1 text-xs text-muted-foreground">{dimensions} px</p></div>
    {item ? <>
      <MediaPreview item={item} alt={`${name} 1`} className={aspect} />
      <div className="flex items-center gap-2">
        <MediaFilePicker label={`Replace ${name.toLowerCase()}`} compact disabled={disabled} className="flex-1"
          onFile={(file) => onUpload(file, item.id)} />
        <Button type="button" variant="ghost" size="sm" disabled={disabled} className="shrink-0 px-2"
          aria-label={`Remove ${name} 1`} title={`Remove ${name.toLowerCase()}`} onClick={() => onRemove(item.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>
      </div>
    </> : <MediaFilePicker label={`Add ${name.toLowerCase()}`} disabled={disabled} className={aspect}
      hint={isIcon ? "Square image" : "Wide image, 2:1 ratio"} onFile={(file) => onUpload(file)} />}
    <p className="text-xs leading-relaxed text-muted-foreground">{isIcon ? "Use a solid background for the dApp Store." : "Shown above your app details. Other ratios are center-cropped when uploaded."}</p>
  </div>;
}
