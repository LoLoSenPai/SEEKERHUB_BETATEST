"use client";

import { useState } from "react";
import { Check, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import type { ProjectMediaItem } from "./types";
import { useProjectMedia } from "./use-project-media";
import { MediaUploadSlot } from "./media-upload-slot";
import { SortableScreenshots } from "./sortable-screenshots";

export function ProjectMediaManager({ projectId, initialMedia }: { projectId: string; initialMedia: ProjectMediaItem[] }) {
  const editor = useProjectMedia(projectId, initialMedia);
  const [dragging, setDragging] = useState(false);
  const disabled = !editor.hydrated || editor.busy;
  const screenshots = editor.media.filter(item => item.kind === "SCREENSHOT").sort((a, b) => a.position - b.position);
  return <section className="grid gap-6" aria-label="Project images" aria-busy={disabled}>
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">App images</h2>
      <p className="text-sm text-muted-foreground">Images are optional and saved as you add them.</p>
      <p className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 3 MiB. Click an image to replace it.</p>
    </div>
    {editor.error ? <div className="space-y-2 rounded-xl border border-danger/30 bg-danger/10 p-3">
      <p role="alert" className="text-sm text-danger">{editor.error}</p>
      <div className="flex flex-wrap gap-3">
        {editor.retry ? <button type="button" disabled={disabled} onClick={editor.retry} className="text-sm font-semibold underline underline-offset-4">Retry upload</button> : null}
        <button type="button" disabled={disabled} onClick={editor.refresh} className="text-sm font-semibold underline underline-offset-4">Refresh images</button>
      </div>
    </div> : null}
    <fieldset disabled={disabled} className="grid min-w-0 gap-7">
      <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-6 sm:gap-8">
        {(["ICON", "BANNER"] as const).map(kind => <MediaUploadSlot key={kind} kind={kind} item={editor.media.find(item => item.kind === kind)}
          disabled={disabled || dragging} onUpload={(file, replaceId) => editor.upload(file, kind, replaceId)} onRemove={editor.remove} />)}
      </div>
      <div className="grid min-w-0 gap-3 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Screenshots</h3><span className="text-xs tabular-nums text-muted-foreground">{screenshots.length} / 5</span></div>
        <p className="text-xs text-muted-foreground">Drag the grip to reorder. Or focus it, press Space, use the arrow keys, then Space to drop.</p>
        <SortableScreenshots items={screenshots} disabled={disabled} editingDisabled={disabled || dragging} onDragging={setDragging}
          onUpload={(file, replaceId) => editor.upload(file, "SCREENSHOT", replaceId)} onRemove={editor.remove} onReorder={editor.reorder} />
      </div>
    </fieldset>
    <p role="status" aria-live="polite" className="flex min-h-5 min-w-0 items-center gap-2 text-xs text-muted-foreground">
      {!editor.hydrated || editor.busy ? <LoaderCircle className="size-3.5 shrink-0 animate-spin" aria-hidden="true" /> : editor.status ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : null}
      <span>{!editor.hydrated ? "Preparing image controls..." : editor.status}</span>
    </p>
    <details className="border-t border-border pt-4 text-xs text-muted-foreground">
      <summary className="w-fit cursor-pointer font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Image guidelines and preview help</summary>
      <div className="mt-3 grid gap-3 leading-relaxed">
        <p>Icons are saved at 512 x 512 and banners at 1200 x 600, matching the dApp Store dimensions. Use a solid icon background. Other icon/banner ratios are center-cropped. Screenshots keep their proportions and are never cropped.</p>
        <p>For Store screenshots, prepare 1080 x 1920 or 1920 x 1080 images with consistent dimensions. SeekerHub beta images remain optional; this is not a Store submission check.</p>
        <a href="https://docs.solanamobile.com/dapp-store/listing-page-guidelines" target="_blank" rel="noreferrer" className="w-fit underline underline-offset-4">Solana Mobile listing guidelines</a>
        <p>Static images only, up to 4096 px per side and 16 MP. We remove metadata and optimize to WebP. Screenshots are saved up to 1920 px on the longest side. The project image limit is 8 MiB; removed images count until cleanup completes.</p>
        <p>Your selection appears immediately on this device. Wait for the saved confirmation before leaving. Other testers see only images saved successfully.</p>
        <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={disabled || dragging} onClick={editor.refresh}><RefreshCw className="size-4" aria-hidden="true" /> Refresh previews</Button>
      </div>
    </details>
  </section>;
}
