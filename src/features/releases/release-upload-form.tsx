"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { formatBytes } from "@/src/lib/utils";

export function ReleaseUploadForm({ projectId, projectSlug, maxApkBytes }: {
  projectId: string;
  projectSlug: string;
  maxApkBytes: number;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const pendingSession = useRef<string | null>(null);
  const [retryValidation, setRetryValidation] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<"idle" | "reserving" | "uploading" | "validating">("idle");
  const [progress, setProgress] = useState(0);
  const busy = stage !== "idle";

  async function upload() {
    if (inFlight.current || !file) return;
    if (!/\.apk$/i.test(file.name) || file.size <= 0) { setError("Choose one non-empty .apk file, not an AAB or ZIP bundle."); return; }
    if (file.size > maxApkBytes) { setError(`This APK is ${formatBytes(file.size)}. Your per-APK limit is ${formatBytes(maxApkBytes)}.`); return; }
    inFlight.current = true; setError("");
    try {
      if (!pendingSession.current) {
        setStage("reserving"); setProgress(0);
        const contentType = file.type || "application/vnd.android.package-archive";
        const response = await fetch("/api/uploads/releases", {
          method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ projectId, fileName: file.name, contentType, fileSize: file.size,
            draft: { projectId, versionName: "manifest-source-of-truth", versionCode: 1, changelog: "Draft release", accessPolicy: {
              requireInviteAcceptance: true, requireLinkedWallet: false, requireVerifiedSeeker: false,
              requireSolanaMobile: false, allowPreviousReleases: false, testerGroupId: null, walletAllowlist: [],
            } },
          }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Unable to reserve storage. Please try again.");
        setStage("uploading");
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open("PUT", result.uploadUrl);
          xhr.setRequestHeader("content-type", contentType);
          xhr.upload.onprogress = (event) => { if (event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
          xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("Storage rejected the upload. Please try again."));
          xhr.onerror = () => reject(new Error("Upload interrupted. Check your connection and try again."));
          xhr.timeout = 20 * 60 * 1000;
          xhr.ontimeout = () => reject(new Error("Upload timed out. Please try again on a faster connection."));
          xhr.send(file);
        });
        pendingSession.current = result.sessionId;
        setRetryValidation(true);
      }
      setStage("validating");
      const response = await fetch(`/api/uploads/releases/${pendingSession.current}/finalize`, { method: "POST" });
      const result = await response.json().catch(() => null);
      if (!response.ok) {
        // Retry the saved upload after a transient validation failure, not another copy.
        if ([400, 404, 410, 413, 422].includes(response.status)) { pendingSession.current = null; setRetryValidation(false); }
        throw new Error(result?.error ?? "APK validation could not finish. Retry to continue with the saved upload.");
      }
      router.push(`/builder/apps/${projectSlug}/releases/${result.releaseId}`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed. Please try again."); }
    finally { inFlight.current = false; setStage("idle"); }
  }

  return <Card className="rounded-[2rem]">
    <CardHeader>
      <div className="section-eyebrow">Step 1 of 4</div>
      <CardTitle>Start with your APK</CardTitle>
      <CardDescription>We will read its version and package for you. Next: release notes, audience, then review and publish.</CardDescription>
    </CardHeader>
    <CardContent>
      <form className="space-y-6" onSubmit={(event) => { event.preventDefault(); void upload(); }}>
        <div className="grid gap-4 rounded-2xl border border-dashed border-brand/40 bg-brand/5 p-5 sm:p-8">
          <UploadCloud className="size-8 text-brand" aria-hidden="true" />
          <div><Label htmlFor="apk">Choose a signed Android APK</Label><p className="mt-2 text-sm text-muted-foreground">One .apk file, up to {formatBytes(maxApkBytes)}. Nothing is published at this step.</p></div>
          <Input id="apk" name="apk" type="file" accept=".apk,application/vnd.android.package-archive,application/octet-stream" required disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); pendingSession.current = null; setRetryValidation(false); setError(""); }} />
          {file ? <p className="break-all text-sm font-semibold">{file.name} <span className="font-normal text-muted-foreground">({formatBytes(file.size)})</span></p> : null}
        </div>
        <details className="text-sm text-muted-foreground"><summary className="cursor-pointer font-medium text-foreground">Which file should I use?</summary><p className="mt-3 leading-6">Use the signed release APK from your Android build, for example app-release.apk. Do not compress it or upload an .aab, .apks, or .xapk. We check the archive, manifest and signature marker; this is not a malware scan or full signature verification.</p></details>
        <p className="text-xs leading-5 text-muted-foreground">Checking an upload temporarily reserves twice its size. The extra copy is released after storage cleanup, normally within about 90 minutes.</p>
        <div aria-live="polite">
          {busy ? <div className="space-y-3 rounded-2xl bg-muted/60 p-4"><p className="text-sm">{stage === "reserving" ? "Preparing private storage..." : stage === "uploading" ? `Uploading APK: ${progress}%` : "Checking the APK and reading its version..."}</p><progress className="w-full accent-brand" max={100} value={stage === "uploading" ? progress : undefined} aria-label="APK upload progress" /><p className="text-xs text-muted-foreground">Please keep this page open. Large builds can take a few minutes.</p></div> : null}
          {error ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</p> : null}
        </div>
        <Button type="submit" size="lg" disabled={busy || !file} className="w-full sm:w-auto">{busy ? <Loader2 className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}{busy ? "Saving your APK..." : retryValidation ? "Retry APK validation" : "Upload and check APK"}</Button>
      </form>
    </CardContent>
  </Card>;
}
