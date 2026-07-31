"use client";

import { useEffect } from "react";
import { Button } from "@/src/components/ui/button";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("[ui] route error", { digest: error.digest }); }, [error]);
  return <main className="page-shell min-h-screen justify-center"><div className="mx-auto max-w-lg rounded-[1.75rem] border border-border bg-surface p-8"><div className="section-eyebrow">Request failed</div><h1 className="mt-3 text-3xl font-semibold">This page could not load</h1><p className="mt-3 text-sm leading-6 text-muted-foreground">The error was logged without exposing internal details. Retry the request, then check service health if it persists.</p><Button className="mt-6" onClick={reset}>Try again</Button></div></main>;
}
