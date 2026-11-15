"use client";

/* eslint-disable @next/next/no-img-element -- Local blob previews must not use the shared image optimizer. */
import { ImageOff, LoaderCircle, Pencil, X } from "lucide-react";
import { cn } from "@/src/lib/utils";
import type { EditorMedia } from "./use-project-media";
import { MediaFilePicker } from "./media-file-picker";
import { PrivateMediaImage } from "./private-media-image";

export function MediaPreview({ item, alt }: { item: EditorMedia; alt: string }) {
  const style = cn("size-full", item.kind === "SCREENSHOT" ? "object-contain" : "object-cover");
  return item.localUrl ? <img src={item.localUrl} alt={alt} width={item.width} height={item.height} className={style} draggable={false} />
    : <PrivateMediaImage key={`${item.id}:${item.url}`} id={item.id} src={item.url} alt={alt}
      width={item.width} height={item.height} className={style}
      fallback={<span className="flex flex-col items-center gap-2 p-3 text-center text-xs text-muted-foreground"><ImageOff className="size-5" aria-hidden="true" />Preview unavailable</span>} />;
}

export function MediaTile({ item, label, disabled, className, onUpload, onRemove }: {
  item?: EditorMedia; label: string; disabled: boolean; className?: string;
  onUpload: (file: File, replaceId?: string) => void; onRemove: (id: string) => void;
}) {
  return <div className={cn("relative min-w-0", className)}>
    <MediaFilePicker label={`${item ? "Replace" : "Add"} ${label}`} disabled={disabled} className="size-full"
      onFile={file => onUpload(file, item?.id)}>
      {item ? <>
        <MediaPreview item={item} alt={label} />
        {!item.saving ? <span aria-hidden="true" className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/75 p-2 text-white opacity-0 transition-opacity group-hover/picker:opacity-100 group-focus-visible/picker:opacity-100"><Pencil className="size-3.5" /></span> : null}
      </> : undefined}
    </MediaFilePicker>
    {item && !item.saving ? <button type="button" disabled={disabled} aria-label={`Remove ${label}`} title={`Remove ${label}`}
      onClick={() => onRemove(item.id)} className="absolute -right-3 -top-3 z-10 flex size-11 cursor-pointer items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
      <span className="rounded-full border border-border bg-card p-1 text-foreground shadow-sm"><X className="size-4" aria-hidden="true" /></span>
    </button> : null}
    {item?.saving ? <div className="pointer-events-none absolute inset-x-1 bottom-1 flex items-center justify-center gap-1.5 rounded-lg bg-black/80 px-2 py-1.5 text-xs text-white"><LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />Saving...</div> : null}
  </div>;
}

export function MediaUploadSlot({ kind, item, disabled, onUpload, onRemove }: {
  kind: "ICON" | "BANNER"; item?: EditorMedia; disabled: boolean;
  onUpload: (file: File, replaceId?: string) => void; onRemove: (id: string) => void;
}) {
  const icon = kind === "ICON";
  return <div className="grid min-w-0 content-start gap-2">
    <div><h3 className="text-sm font-semibold">{icon ? "App icon" : "App banner"}</h3><p className="mt-1 text-xs text-muted-foreground">{icon ? "512 x 512" : "1200 x 600"} px</p></div>
    <MediaTile item={item} label={icon ? "app icon" : "app banner"} disabled={disabled}
      className={icon ? "aspect-square w-24" : "aspect-[2/1] w-full max-w-60"} onUpload={onUpload} onRemove={onRemove} />
  </div>;
}
