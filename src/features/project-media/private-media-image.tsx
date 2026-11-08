"use client";

/* eslint-disable @next/next/no-img-element -- Never proxy private signed URLs through the shared optimizer cache. */
import { useRef, useState, type ReactNode } from "react";

export function PrivateMediaImage({ id, src, alt, width, height, className, fallback = null }: {
  id: string; src: string; alt: string; width: number; height: number; className?: string; fallback?: ReactNode;
}) {
  const [url, setUrl] = useState(src);
  const [failed, setFailed] = useState(false);
  const attempted = useRef(false);
  if (failed) return fallback;
  return <img src={url} alt={alt} width={width} height={height} className={className} loading="eager" referrerPolicy="no-referrer" onError={async () => {
    if (attempted.current) { setFailed(true); return; }
    attempted.current = true;
    try {
      // Same-origin fetch sends the referring page only to our own server. The
      // cross-origin S3 image above never receives a bearer invite URL as Referer.
      const response = await fetch(`/api/project-media/${encodeURIComponent(id)}/url`, { credentials: "same-origin", cache: "no-store", referrerPolicy: "same-origin" });
      if (!response.ok) { setFailed(true); return; }
      const body = await response.json() as { url?: string };
      if (!body.url || body.url === url) { setFailed(true); return; }
      setUrl(body.url);
    } catch { setFailed(true); }
  }} />;
}
