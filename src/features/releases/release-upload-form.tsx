"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";

type GroupOption = {
  id: string;
  name: string;
};

export function ReleaseUploadForm({
  projectId,
  projectSlug,
  groups,
}: {
  projectId: string;
  projectSlug: string;
  groups: GroupOption[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accessMode, setAccessMode] = useState("invite");
  const [walletAllowlist, setWalletAllowlist] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<"idle" | "reserving" | "uploading" | "validating">("idle");
  const groupChoices = useMemo(() => groups, [groups]);
  const accessSummary = useMemo(() => {
    if (accessMode === "group") {
      return "Tester group restricted means the tester must first claim an invite that adds them to the selected group, then the release checks that group membership.";
    }

    if (accessMode === "wallet-only") {
      return "Wallet allowlist skips invite acceptance. If the allowlist is empty, any linked wallet can open the release unless you also require verified Seeker.";
    }

    return "Private by invite means an accepted invite is the main gate. Wallet and Seeker requirements below are additional filters on top.";
  }, [accessMode]);

  return (
    <Card className="rounded-[2rem]">
      <CardHeader>
        <div className="section-eyebrow">Phase 2</div>
        <CardTitle>Upload a release APK</CardTitle>
        <CardDescription>
          Create a release draft, upload the signed APK to private storage, inspect file metadata, then publish the release.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setError(null);
            setLoading(true);
            setUploadStage("reserving");
            setUploadProgress(0);

            try {
            const form = event.currentTarget;
            const formData = new FormData(form);
            const file = formData.get("apk") as File | null;

            if (!file) {
              setError("Select an APK file first.");
              setLoading(false);
              return;
            }

            const selectedAccessMode = String(formData.get("accessMode") ?? "invite");
            const selectedTesterGroupId = String(formData.get("testerGroupId") ?? "").trim();

            if (selectedAccessMode === "group" && !selectedTesterGroupId) {
              setError("Select a tester group for the group-restricted preset.");
              setLoading(false);
              return;
            }

            const draft = {
              projectId,
              versionName: "manifest-source-of-truth",
              versionCode: 1,
              changelog: String(formData.get("changelog") ?? ""),
              accessPolicy: {
                requireInviteAcceptance: selectedAccessMode !== "wallet-only",
                testerGroupId: selectedTesterGroupId || null,
                requireLinkedWallet: selectedAccessMode === "wallet-only" || formData.get("walletRequired") === "on",
                requireSolanaMobile: formData.get("requireSolanaMobile") === "on",
                requireVerifiedSeeker: formData.get("requireVerifiedSeeker") === "on",
                allowPreviousReleases: formData.get("allowPreviousReleases") === "on",
                walletAllowlist: walletAllowlist
                  .split("\n")
                  .map((item) => item.trim())
                  .filter(Boolean),
              },
            };

            const sessionResponse = await fetch("/api/uploads/releases", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                projectId,
                fileName: file.name,
                contentType: file.type || "application/vnd.android.package-archive",
                fileSize: file.size,
                draft,
              }),
            });

            if (!sessionResponse.ok) {
              const payload = await sessionResponse.json().catch(() => null);
              setError(payload?.error ?? "Unable to create the upload session.");
              setLoading(false);
              return;
            }

            const { uploadUrl, sessionId } = (await sessionResponse.json()) as {
              uploadUrl: string;
              sessionId: string;
            };

            setUploadStage("uploading");
            await new Promise<void>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open("PUT", uploadUrl);
              xhr.setRequestHeader("content-type", file.type || "application/vnd.android.package-archive");
              xhr.setRequestHeader("x-amz-meta-expected-size", String(file.size));
              xhr.upload.onprogress = (progressEvent) => {
                if (progressEvent.lengthComputable) setUploadProgress(Math.round((progressEvent.loaded / progressEvent.total) * 100));
              };
              xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error("R2 rejected the APK upload."));
              xhr.onerror = () => reject(new Error("The APK upload was interrupted."));
              xhr.send(file);
            });

            setUploadStage("validating");
            const finalizeResponse = await fetch(`/api/uploads/releases/${sessionId}/finalize`, {
              method: "POST",
            });

            const finalizePayload = await finalizeResponse.json().catch(() => null);

            if (!finalizeResponse.ok) {
              setError(finalizePayload?.error ?? "Release finalization failed.");
              setLoading(false);
              return;
            }

            router.push(`/builder/apps/${projectSlug}/releases/${finalizePayload.releaseId}`);
            router.refresh();
          } catch (caught) {
            setError(caught instanceof Error ? caught.message : "Release upload failed.");
          } finally {
            setLoading(false);
          }}}
        >
          <div className="rounded-[1.5rem] border border-border bg-muted/60 p-5">
            <div className="section-eyebrow">1 - APK</div>
            <div className="mt-2 text-sm leading-6 text-muted-foreground">Select one signed release APK. Package, version name, version code, min SDK, and target SDK are read from AndroidManifest.xml and override manual input.</div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="changelog">2 - Release notes</Label>
            <Textarea id="changelog" name="changelog" placeholder="What changed in this release?" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="apk">Signed APK (max 250 MiB)</Label>
            <Input id="apk" name="apk" type="file" accept=".apk,application/vnd.android.package-archive,application/octet-stream" required />
          </div>

          <div className="grid gap-5 rounded-[1.5rem] border border-border bg-muted/60 p-5 lg:grid-cols-2">
            <div className="section-eyebrow lg:col-span-2">3 - Audience</div>
            <div className="grid gap-4">
              <div className="grid gap-2">
                <Label htmlFor="accessMode">Visibility preset</Label>
                <Select id="accessMode" name="accessMode" value={accessMode} onChange={(event) => setAccessMode(event.target.value)}>
                  <option value="invite">Private by invite</option>
                  <option value="group">Tester group restricted</option>
                  <option value="wallet-only">Wallet allowlist</option>
                </Select>
                <div className="text-sm leading-6 text-muted-foreground">{accessSummary}</div>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="testerGroupId">Tester group</Label>
                <Select id="testerGroupId" name="testerGroupId" defaultValue="">
                  <option value="">No tester group</option>
                  {groupChoices.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div className="grid gap-4">
              <Label htmlFor="walletAllowlist">Wallet allowlist</Label>
              <Textarea
                id="walletAllowlist"
                placeholder="One wallet address per line"
                value={walletAllowlist}
                onChange={(event) => setWalletAllowlist(event.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-3 rounded-[1.5rem] border border-border bg-card p-5 sm:grid-cols-2">
            <label className="flex items-center gap-3 text-sm text-foreground">
              <input type="checkbox" name="walletRequired" className="size-4 rounded border-input" />
              Require linked wallet
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
              <input type="checkbox" name="requireSolanaMobile" className="size-4 rounded border-input" />
              Recommend a Solana Mobile capable device
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
              <input type="checkbox" name="requireVerifiedSeeker" className="size-4 rounded border-input" />
              Require verified Seeker wallet
            </label>
            <label className="flex items-center gap-3 text-sm text-foreground">
              <input type="checkbox" name="allowPreviousReleases" className="size-4 rounded border-input" />
              Allow previous build browsing
            </label>
          </div>

          <div aria-live="polite">
            {loading ? <div className="grid gap-2 rounded-2xl border border-border bg-muted/50 p-4"><div className="flex items-center justify-between text-sm"><span>{uploadStage === "reserving" ? "Reserving private storage" : uploadStage === "uploading" ? "Uploading APK to R2" : "Validating archive and Android manifest"}</span><span>{uploadStage === "uploading" ? `${uploadProgress}%` : ""}</span></div><div className="h-2 overflow-hidden rounded-full bg-card"><div className="h-full bg-brand transition-[width]" style={{ width: uploadStage === "uploading" ? `${uploadProgress}%` : uploadStage === "validating" ? "100%" : "8%" }} /></div></div> : null}
            {error ? <div className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div> : null}
          </div>

          <Button type="submit" size="lg" disabled={loading}>
            {loading ? <Loader2 className="size-4 animate-spin" /> : <UploadCloud className="size-4" />}
            {loading ? "Publishing release..." : "4 - Confirm and publish release"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
