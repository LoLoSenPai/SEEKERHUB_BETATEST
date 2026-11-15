"use client";

import { startTransition, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, LoaderCircle, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { cn } from "@/src/lib/utils";
import type { ProjectMediaItem, ProjectMediaKind } from "./types";
import { MediaFilePicker } from "./media-file-picker";
import { MediaPreview, MediaUploadSlot } from "./media-upload-slot";

const LABELS: Record<ProjectMediaKind, string> = { ICON: "App icon", BANNER: "App banner", SCREENSHOT: "Screenshots" };
const subscribeToHydration = () => () => {};
const clientHydrationSnapshot = () => true;
const serverHydrationSnapshot = () => false;

export function ProjectMediaManager({ projectId, initialMedia }: { projectId: string; initialMedia: ProjectMediaItem[] }) {
  const router = useRouter();
  // Keep SSR and initial hydration disabled until React has attached the handlers.
  const hydrated = useSyncExternalStore(subscribeToHydration, clientHydrationSnapshot, serverHydrationSnapshot);
  const [media, setMedia] = useState(initialMedia);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [activity, setActivity] = useState("");
  const inFlight = useRef(false);
  const controlsDisabled = !hydrated || busy;

  async function requestMedia(query: URLSearchParams, options?: RequestInit, pending = "Updating images...", success = "Images saved.") {
    if (!hydrated || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage(""); setActivity(pending);
    try {
      const response = await fetch(`/api/project-media?${query}`, { ...options, credentials: "same-origin", cache: "no-store" });
      const result = await response.json() as { media?: ProjectMediaItem[]; error?: string };
      if (!response.ok || !result.media) throw new Error(result.error ?? "Unable to update images.");
      setMedia(result.media);
      setMessage(success);
      if (options?.method) startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update images.");
    } finally { inFlight.current = false; setBusy(false); setActivity(""); }
  }

  async function upload(file: File | undefined, kind: ProjectMediaKind, replaceId?: string) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024 || file.size === 0) {
      setMessage(""); setError("Choose a static JPEG, PNG or WebP image, up to 3 MiB."); return;
    }
    const query = new URLSearchParams({ projectId, kind, ...(replaceId ? { replaceId } : {}) });
    // The browser sets Content-Length for the File body; JavaScript cannot set this header.
    await requestMedia(query, { method: "POST", headers: { "Content-Type": file.type }, body: file }, `Uploading ${file.name}...`, `${kind === "SCREENSHOT" ? "Screenshot" : LABELS[kind]} saved.`);
  }

  function remove(id: string) {
    void requestMedia(new URLSearchParams({ projectId, id }), { method: "DELETE" }, "Removing image...", "Image removed.");
  }

  const screenshots = media.filter((item) => item.kind === "SCREENSHOT").sort((a, b) => a.position - b.position);
  function move(index: number, direction: -1 | 1) {
    const ids = screenshots.map((shot) => shot.id);
    [ids[index], ids[index + direction]] = [ids[index + direction], ids[index]];
    void requestMedia(new URLSearchParams({ projectId }), { method: "PATCH", body: JSON.stringify({ projectId, ids }), headers: { "Content-Type": "application/json" } }, "Saving screenshot order...", "Screenshot order saved.");
  }

  return <section className="grid gap-5" aria-label="Project images" aria-busy={controlsDisabled}>
    <div className="space-y-2">
      <h2 className="text-lg font-semibold">Give your app a face</h2>
      <p className="text-sm text-muted-foreground">Help testers recognize your app before they download it. Images are optional and saved as you add them.</p>
      <p className="text-xs text-muted-foreground">JPEG, PNG or WebP. Up to 3 MiB per image.</p>
    </div>
    {error ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/10 p-3 text-sm text-danger">{error}</p> : null}
    <p role="status" aria-live="polite" className={cn("flex min-w-0 items-center gap-2 text-sm text-muted-foreground", hydrated && !busy && !message && "sr-only")}>
      {!hydrated || busy ? <LoaderCircle className="size-4 shrink-0 animate-spin" aria-hidden="true" /> : message ? <Check className="size-4 shrink-0" aria-hidden="true" /> : null}
      <span className="min-w-0 break-all">{!hydrated ? "Preparing image controls..." : busy ? activity : message}</span>
    </p>
    <fieldset disabled={controlsDisabled} className="grid min-w-0 gap-6">
      <div className="grid min-w-0 gap-6 sm:grid-cols-[144px_minmax(0,1fr)]">
        {(["ICON", "BANNER"] as const).map(kind => <MediaUploadSlot key={kind} kind={kind} item={media.find(item => item.kind === kind)}
          disabled={controlsDisabled} onUpload={(file, replaceId) => void upload(file, kind, replaceId)} onRemove={remove} />)}
      </div>
      <div className="grid min-w-0 gap-3 border-t border-border pt-5">
        <div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">Screenshots</h3><span className="text-xs tabular-nums text-muted-foreground">{screenshots.length} / 5</span></div>
        <p className="text-xs text-muted-foreground">Show what testing your app looks like. Keep a consistent orientation; images are never cropped.</p>
        <div className="grid min-w-0 grid-cols-2 items-start gap-3 sm:grid-cols-3">
          {screenshots.map((item, index) => <div key={item.id} className="grid min-w-0 gap-2">
            <MediaPreview item={item} alt={`Screenshots ${index + 1}`} className={item.width > item.height ? "aspect-video" : item.width === item.height ? "aspect-square" : "aspect-[9/16]"} />
            <MediaFilePicker label={`Replace screenshot ${index + 1}`} compact disabled={controlsDisabled} onFile={(file) => void upload(file, "SCREENSHOT", item.id)} />
            <div className="flex flex-wrap items-center justify-between gap-1">
              <Button type="button" variant="ghost" size="sm" className="px-2" disabled={index === 0 || controlsDisabled} aria-label={`Move screenshot ${index + 1} earlier`} onClick={() => move(index, -1)}><ArrowLeft className="size-4" aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="sm" className="px-2" disabled={index === screenshots.length - 1 || controlsDisabled} aria-label={`Move screenshot ${index + 1} later`} onClick={() => move(index, 1)}><ArrowRight className="size-4" aria-hidden="true" /></Button>
              <Button type="button" variant="ghost" size="sm" className="px-2" disabled={controlsDisabled} aria-label={`Remove Screenshots ${index + 1}`} onClick={() => remove(item.id)}><Trash2 className="size-4" aria-hidden="true" /></Button>
            </div>
          </div>)}
          {screenshots.length < 5 ? <MediaFilePicker label="Add screenshot" disabled={controlsDisabled}
            className={screenshots.length === 0 ? "col-span-full" : screenshots[0].width > screenshots[0].height ? "aspect-video" : "aspect-[9/16]"}
            hint={screenshots.length === 0 ? "Add up to 5 images, portrait or landscape" : "Portrait or landscape"} onFile={file => void upload(file, "SCREENSHOT")} /> : null}
        </div>
      </div>
    </fieldset>
    <details className="rounded-xl border border-border px-4 py-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Image guidelines and preview help</summary>
      <div className="mt-3 grid gap-3 leading-relaxed">
        <p>Icons are saved at 512 x 512 and banners at 1200 x 600, matching the dApp Store dimensions. For Store screenshots, prepare 1080 x 1920 or 1920 x 1080 images with consistent dimensions. SeekerHub beta images remain optional; this is not a Store submission check.</p>
        <a href="https://docs.solanamobile.com/dapp-store/listing-page-guidelines" target="_blank" rel="noreferrer" className="w-fit underline underline-offset-4">Solana Mobile listing guidelines</a>
        <p>Static images only, up to 4096 px per side and 16 MP. We remove metadata and optimize to WebP. Screenshots keep their proportions, up to 1920 px on the longest side. The project image limit is 8 MiB; removed images count until cleanup completes.</p>
        <p>Previews are private and refresh automatically when possible. If an image is missing, try refreshing it below.</p>
        <Button type="button" variant="secondary" size="sm" className="w-fit" disabled={controlsDisabled} onClick={() => void requestMedia(new URLSearchParams({ projectId }), undefined, "Refreshing previews...", "Image previews refreshed.")}><RefreshCw className="size-4" aria-hidden="true" /> Refresh previews</Button>
      </div>
    </details>
  </section>;
}
