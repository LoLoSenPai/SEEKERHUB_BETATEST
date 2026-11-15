"use client";

import { startTransition, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { ProjectMediaItem, ProjectMediaKind } from "./types";

const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
const names = { ICON: "App icon", BANNER: "App banner", SCREENSHOT: "Screenshot" };
export type EditorMedia = ProjectMediaItem & { localUrl?: string; saving?: boolean };
type Upload = { file: File; kind: ProjectMediaKind; replaceId?: string };

export function useProjectMedia(projectId: string, initialMedia: ProjectMediaItem[]) {
  const router = useRouter();
  const hydrated = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [media, setMedia] = useState<EditorMedia[]>(initialMedia);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState<Upload | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    const urls = objectUrls.current;
    return () => { alive.current = false; for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
  }, []);
  useEffect(() => {
    if (!busy) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [busy]);

  function updateMedia(next: EditorMedia[]) {
    if (!alive.current) return;
    const retained = new Set(next.map(item => item.localUrl).filter(Boolean));
    for (const url of objectUrls.current) {
      if (!retained.has(url)) { URL.revokeObjectURL(url); objectUrls.current.delete(url); }
    }
    setMedia(next);
  }

  async function mutate(query: URLSearchParams, options?: RequestInit, optimistic?: EditorMedia[], upload?: Upload, localUrl?: string) {
    if (!hydrated || inFlight.current) return;
    const previous = media;
    inFlight.current = true;
    setBusy(true); setError(""); setRetry(null); setStatus(options?.method ? "Saving changes..." : "Refreshing images...");
    if (optimistic) setMedia(optimistic);
    let safeToRetry = false;
    try {
      const response = await fetch(`/api/project-media?${query}`, { ...options, credentials: "same-origin", cache: "no-store" });
      // A rejected input is retryable. A lost response/5xx can follow a committed write.
      safeToRetry = response.status >= 400 && response.status < 500;
      const result = await response.json() as { media?: ProjectMediaItem[]; error?: string };
      if (!response.ok || !result.media) throw new Error(result.error ?? "Unable to save images.");
      if (!alive.current) return;
      const next: EditorMedia[] = result.media.map(item => ({ ...item, localUrl: previous.find(old => old.id === item.id)?.localUrl }));
      if (upload && localUrl) {
        const saved = next.find(item => item.kind === upload.kind && !previous.some(old => old.id === item.id));
        if (saved) saved.localUrl = localUrl;
      }
      updateMedia(next);
      setStatus(upload ? `${names[upload.kind]} saved.` : options?.method === "DELETE" ? "Image removed." : options?.method === "PATCH" ? "Screenshot order saved." : "Images refreshed.");
      if (options?.method) startTransition(() => router.refresh());
    } catch (caught) {
      if (!alive.current) return;
      updateMedia(previous);
      setStatus("");
      const detail = caught instanceof Error ? caught.message : "Unable to save images.";
      setError(safeToRetry ? `${detail} Your previous images are unchanged.` : `${detail} We could not confirm the save. Refresh images to check before uploading again.`);
      if (safeToRetry && upload) setRetry(upload);
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function upload(file: File, kind: ProjectMediaKind, replaceId?: string) {
    if (!hydrated || inFlight.current) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || !file.size || file.size > 3 * 1024 * 1024) {
      setStatus(""); setRetry(null); setError("Choose a static JPEG, PNG or WebP image, up to 3 MiB."); return;
    }
    const localUrl = URL.createObjectURL(file);
    objectUrls.current.add(localUrl);
    const original = media.find(item => replaceId ? item.id === replaceId : item.kind === kind && kind !== "SCREENSHOT");
    const pending: EditorMedia = { id: original?.id ?? `local-${crypto.randomUUID()}`, kind, position: original?.position ?? media.filter(item => item.kind === kind).length,
      width: kind === "BANNER" ? 1200 : kind === "ICON" ? 512 : 1080, height: kind === "BANNER" ? 600 : kind === "ICON" ? 512 : 1920,
      url: localUrl, localUrl, saving: true };
    const optimistic = original ? media.map(item => item.id === original.id ? pending : item) : [...media, pending];
    void mutate(new URLSearchParams({ projectId, kind, ...(replaceId ? { replaceId } : {}) }),
      { method: "POST", headers: { "Content-Type": file.type }, body: file }, optimistic, { file, kind, replaceId }, localUrl);
    if (kind === "SCREENSHOT") {
      const image = new Image();
      image.onload = () => {
        if (alive.current) setMedia(current => current.map(item => item.localUrl === localUrl && item.saving
          ? { ...item, width: image.naturalWidth, height: image.naturalHeight } : item));
      };
      image.src = localUrl;
    }
  }

  function remove(id: string) {
    void mutate(new URLSearchParams({ projectId, id }), { method: "DELETE" }, media.filter(item => item.id !== id));
  }
  function reorder(ids: string[]) {
    if (ids.length !== media.filter(item => item.kind === "SCREENSHOT").length || new Set(ids).size !== ids.length) return;
    void mutate(new URLSearchParams({ projectId }), { method: "PATCH", body: JSON.stringify({ projectId, ids }), headers: { "Content-Type": "application/json" } },
      media.map(item => item.kind === "SCREENSHOT" ? { ...item, position: ids.indexOf(item.id) } : item));
  }

  return { media, busy, hydrated, status, error, upload, remove, reorder,
    retry: retry ? () => upload(retry.file, retry.kind, retry.replaceId) : undefined,
    refresh: () => void mutate(new URLSearchParams({ projectId })) };
}
