"use client";

import { startTransition, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import type { ProjectMediaItem, ProjectMediaKind } from "./types";
import { PrivateMediaImage } from "./private-media-image";

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
  const inFlight = useRef(false);
  const controlsDisabled = !hydrated || busy;

  async function requestMedia(query: URLSearchParams, options?: RequestInit) {
    if (!hydrated || inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/project-media?${query}`, { ...options, credentials: "same-origin", cache: "no-store" });
      const result = await response.json() as { media?: ProjectMediaItem[]; error?: string };
      if (!response.ok || !result.media) throw new Error(result.error ?? "Unable to update images.");
      setMedia(result.media);
      setMessage(options?.method ? "Images saved. Removed images free storage after cleanup." : "Image previews refreshed.");
      if (options?.method) startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to update images.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  async function upload(file: File | undefined, kind: ProjectMediaKind, replaceId?: string) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 3 * 1024 * 1024 || file.size === 0) {
      setError("Choose a static JPEG, PNG or WebP image, up to 3 MiB."); return;
    }
    const query = new URLSearchParams({ projectId, kind, ...(replaceId ? { replaceId } : {}) });
    // The browser sets Content-Length for the File body; JavaScript cannot set this header.
    await requestMedia(query, { method: "POST", headers: { "Content-Type": file.type }, body: file });
  }

  const screenshots = media.filter((item) => item.kind === "SCREENSHOT").sort((a, b) => a.position - b.position);
  return <section className="grid gap-5" aria-label="Project images" aria-busy={controlsDisabled}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-lg font-semibold">Make your app recognizable</h2><p className="text-sm text-muted-foreground">Optional icon, banner and up to 5 real screenshots. No images are added automatically.</p></div>
      <Button type="button" variant="secondary" disabled={controlsDisabled} onClick={() => void requestMedia(new URLSearchParams({ projectId }))}><RefreshCw className="size-4" /> Refresh previews</Button>
    </div>
    <p className="text-xs text-muted-foreground">Static JPEG, PNG or WebP. Up to 3 MiB, 4096 px per side and 16 MP. Images are optimized to WebP and metadata is removed. Project limit: 8 MiB, including images awaiting cleanup.</p>
    <fieldset disabled={controlsDisabled} className="grid gap-6">
      {(["ICON", "BANNER", "SCREENSHOT"] as const).map((kind) => {
        const items = kind === "SCREENSHOT" ? screenshots : media.filter((item) => item.kind === kind);
        return <div key={kind} className="grid gap-3">
          <h3 className="font-medium">{LABELS[kind]}</h3>
          <div className="flex flex-wrap gap-3">
            {items.map((item, index) => <div key={item.id} className="grid w-44 gap-2 rounded-xl border border-border p-3">
              <PrivateMediaImage key={`${item.id}:${item.url}`} id={item.id} src={item.url} alt={`${LABELS[kind]} ${index + 1}`} width={item.width} height={item.height} className="h-28 w-full rounded-lg object-contain" />
              <label className="grid gap-1 text-xs">Replace image<input type="file" disabled={controlsDisabled} accept="image/jpeg,image/png,image/webp" className="max-w-full text-xs" onChange={(event) => { void upload(event.currentTarget.files?.[0], kind, item.id); event.currentTarget.value = ""; }} /></label>
              <div className="flex gap-1">
                <Button type="button" variant="secondary" size="sm" disabled={controlsDisabled} aria-label={`Remove ${LABELS[kind]} ${index + 1}`} onClick={() => void requestMedia(new URLSearchParams({ projectId, id: item.id }), { method: "DELETE" })}><Trash2 className="size-4" /></Button>
                {kind === "SCREENSHOT" ? <>
                  <Button type="button" variant="secondary" size="sm" disabled={index === 0 || controlsDisabled} aria-label={`Move screenshot ${index + 1} earlier`} onClick={() => {
                    const ids = screenshots.map((shot) => shot.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
                    void requestMedia(new URLSearchParams({ projectId }), { method: "PATCH", body: JSON.stringify({ projectId, ids }), headers: { "Content-Type": "application/json" } });
                  }}><ArrowUp className="size-4" /></Button>
                  <Button type="button" variant="secondary" size="sm" disabled={index === screenshots.length - 1 || controlsDisabled} aria-label={`Move screenshot ${index + 1} later`} onClick={() => {
                    const ids = screenshots.map((shot) => shot.id); [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
                    void requestMedia(new URLSearchParams({ projectId }), { method: "PATCH", body: JSON.stringify({ projectId, ids }), headers: { "Content-Type": "application/json" } });
                  }}><ArrowDown className="size-4" /></Button>
                </> : null}
              </div>
            </div>)}
          </div>
          {(kind === "SCREENSHOT" ? items.length < 5 : items.length === 0) ? <label className="grid max-w-sm gap-2 text-sm"><span className="flex items-center gap-2"><ImagePlus className="size-4" /> Add {kind === "SCREENSHOT" ? "screenshot" : LABELS[kind].toLowerCase()}</span>
            <input type="file" disabled={controlsDisabled} accept="image/jpeg,image/png,image/webp" className="max-w-full text-sm" onChange={(event) => { void upload(event.currentTarget.files?.[0], kind); event.currentTarget.value = ""; }} />
          </label> : null}
        </div>;
      })}
    </fieldset>
    <p className="text-xs text-muted-foreground">Private preview links expire after 60 seconds. Refresh previews if an image no longer loads. Icons: 512 x 512; banners: 1600 x 900; screenshots: up to 1920 px.</p>
    {error ? <p role="alert" className="text-sm text-danger">{error}</p> : null}
    <p role="status" className="text-sm text-muted-foreground">{!hydrated ? "Preparing image controls..." : busy ? "Processing image..." : message}</p>
  </section>;
}
