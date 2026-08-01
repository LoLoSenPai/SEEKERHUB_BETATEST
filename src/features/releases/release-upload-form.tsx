"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, UploadCloud } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/src/components/ui/card";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { FieldLabel } from "@/src/components/ui/field-help";
import { Textarea } from "@/src/components/ui/textarea";
import { AccessPolicyFields } from "@/src/features/releases/access-policy-fields";

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
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadStage, setUploadStage] = useState<"idle" | "reserving" | "uploading" | "validating">("idle");

  return (
    <Card className="rounded-[2rem]">
      <CardHeader>
        <div className="section-eyebrow">New release</div>
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

            const selectedAccessMode = String(formData.get("accessPreset") ?? "invite");
            const selectedTesterGroupId = String(formData.get("testerGroupId") ?? "").trim();
            const selectedWalletAllowlist = String(formData.get("walletAllowlist") ?? "")
              .split(/\r?\n/)
              .map((item) => item.trim())
              .filter(Boolean);

            if (selectedAccessMode === "group" && !selectedTesterGroupId) {
              setError("Select a tester group for the group-restricted preset.");
              setLoading(false);
              return;
            }

            if (selectedAccessMode === "wallet" && selectedWalletAllowlist.length === 0) {
              setError("Add at least one Solana address for the wallet allowlist preset.");
              setLoading(false);
              return;
            }

            const draft = {
              projectId,
              versionName: "manifest-source-of-truth",
              versionCode: 1,
              changelog: String(formData.get("changelog") ?? ""),
              accessPolicy: {
                requireInviteAcceptance: formData.get("requireInviteAcceptance") === "on",
                testerGroupId: selectedTesterGroupId || null,
                requireLinkedWallet: formData.get("requireLinkedWallet") === "on",
                requireSolanaMobile: formData.get("requireSolanaMobile") === "on",
                requireVerifiedSeeker: formData.get("requireVerifiedSeeker") === "on",
                allowPreviousReleases: formData.get("allowPreviousReleases") === "on",
                walletAllowlist: selectedWalletAllowlist,
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
          <div className="grid gap-4 rounded-[1.5rem] border border-border bg-muted/60 p-5">
            <div className="section-eyebrow">1 - APK</div>
            <div>
              <h3 className="font-semibold text-foreground">Select the Android build</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Package, version, and SDK metadata are read from AndroidManifest.xml. Use a signed release APK, not an AAB or debug bundle.</p>
            </div>
            <div className="grid gap-2">
              <FieldLabel
                htmlFor="apk"
                helpTitle="Signed release APK"
                help="Upload the .apk produced by your release build, for example app-release.apk. SeekerHub checks its archive, manifest, size, checksum, and APK signature marker."
              >
                Signed APK (max 250 MiB)
              </FieldLabel>
              <Input id="apk" name="apk" type="file" accept=".apk,application/vnd.android.package-archive,application/octet-stream" required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="changelog">2 - Release notes</Label>
            <Textarea id="changelog" name="changelog" placeholder="What changed in this release?" required />
          </div>

          <div className="grid gap-5 rounded-[1.5rem] border border-border bg-muted/60 p-5">
            <div>
              <div className="section-eyebrow">3 - Audience</div>
              <h3 className="mt-2 font-semibold text-foreground">Choose how testers get this build</h3>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Pick the closest sharing model. You can change it later without uploading the APK again.
              </p>
            </div>
            <AccessPolicyFields groups={groups} />
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
