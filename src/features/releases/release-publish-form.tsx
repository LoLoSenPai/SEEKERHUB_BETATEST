"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Send } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { AccessPolicyFields } from "./access-policy-fields";
import type { PublishReleaseInput } from "./publish-input";

type PolicyDefaults = React.ComponentProps<typeof AccessPolicyFields>["defaults"];

export function ReleasePublishForm({ releaseId, version, packageName, groups, initialNotes = "", defaults }: {
  releaseId: string;
  version: string;
  packageName: string;
  groups: Array<{ id: string; name: string }>;
  initialNotes?: string;
  defaults?: PolicyDefaults;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [review, setReview] = useState<PublishReleaseInput | null>(null);

  useEffect(() => { headingRef.current?.focus(); }, [step]);

  function collect(): PublishReleaseInput {
    const data = new FormData(formRef.current!);
    const groupId = String(data.get("testerGroupId") ?? "").trim();
    const allowlist = String(data.get("walletAllowlist") ?? "").split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    const preset = data.get("accessPreset");
    if (preset === "group" && !groupId) throw new Error("Select a tester group, or choose an invite link instead.");
    if (preset === "wallet" && !allowlist.length) throw new Error("Add an allowed Solana wallet before continuing.");
    const needsInvite = data.get("requireInviteAcceptance") === "on";
    if (!needsInvite && !allowlist.length) throw new Error("Use an invite link, or add at least one allowed wallet.");
    const expiry = needsInvite ? String(data.get("inviteExpiresAt") ?? "") : "";
    const maxUses = needsInvite ? String(data.get("inviteMaxUses") ?? "").trim() : "";
    if (maxUses && (!Number.isSafeInteger(Number(maxUses)) || Number(maxUses) < 1 || Number(maxUses) > 10_000)) throw new Error("Tester limit must be between 1 and 10,000, or empty for unlimited.");
    if (expiry && (Number.isNaN(new Date(expiry).getTime()) || new Date(expiry) <= new Date())) throw new Error("Choose an expiration in the future.");
    return {
      changelog: String(data.get("changelog") ?? "").trim(),
      accessPolicy: {
        requireInviteAcceptance: data.get("requireInviteAcceptance") === "on",
        testerGroupId: groupId || null,
        requireLinkedWallet: data.get("requireLinkedWallet") === "on" || allowlist.length > 0 || data.get("requireVerifiedSeeker") === "on",
        requireVerifiedSeeker: data.get("requireVerifiedSeeker") === "on",
        requireSolanaMobile: data.get("requireSolanaMobile") === "on",
        allowPreviousReleases: data.get("allowPreviousReleases") === "on",
        walletAllowlist: allowlist,
      },
      invitation: { scope: data.get("inviteScope") === "project" ? "project" : "release", maxUses: maxUses ? Number(maxUses) : null, expiresAt: expiry ? new Date(expiry).toISOString() : null },
    };
  }

  function next() {
    setError("");
    try {
      if (step === 1) {
        const notes = String(new FormData(formRef.current!).get("changelog") ?? "").trim();
        if (!notes || notes.length > 8_000) throw new Error("Add release notes (up to 8,000 characters).");
      } else setReview(collect());
      setStep(step + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the release details."); }
  }

  return <form ref={formRef} noValidate className="space-y-6 [&_input]:scroll-mb-28 [&_select]:scroll-mb-28 [&_textarea]:scroll-mb-28 [&_summary]:scroll-mb-28" onSubmit={async (event) => {
    event.preventDefault();
    if (step !== 3) { next(); return; }
    if (busy || !review) return;
    setError(""); setBusy(true);
    try {
      const response = await fetch(`/api/releases/${releaseId}/publish`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(review) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.issues?.[0]?.message ?? result.error ?? "Publication failed. Your draft is still saved.");
      router.push(result.redirectTo);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Publication failed. Please try again."); }
    finally { setBusy(false); }
  }}>
    <ol className="grid grid-cols-4 gap-2 border-b border-border pb-5 text-xs sm:text-sm" aria-label="Release preparation">
      {["APK checked", "Release notes", "Audience", "Publish"].map((label, index) => <li key={label} aria-current={index === step ? "step" : undefined} className={index <= step ? "font-semibold text-foreground" : "text-muted-foreground"}>
        <span className="mb-2 flex size-7 items-center justify-center rounded-full border border-border bg-muted">{index < step ? <Check className="size-3.5" /> : index + 1}</span>{label}
      </li>)}
    </ol>
    <h2 ref={headingRef} tabIndex={-1} className="text-xl font-semibold focus:outline-none">{step === 1 ? "Write your release notes" : step === 2 ? "Choose who can test" : "Review before publishing"}</h2>
    <p className="text-sm text-muted-foreground">APK saved privately. It will not be available to testers until you publish.</p>
    <fieldset disabled={busy} hidden={step !== 1} className="space-y-3">
      <Label htmlFor="release-notes">What should testers try in v{version}?</Label>
      <p className="text-sm text-muted-foreground">Mention what changed, what to test, and any known issues.</p>
      <Textarea id="release-notes" name="changelog" maxLength={8000} required defaultValue={initialNotes === "Draft release" ? "" : initialNotes} placeholder={"What's new\n\nPlease test\n\nKnown issues"} className="min-h-48" />
    </fieldset>
    <fieldset disabled={busy} hidden={step !== 2} className="space-y-6">
      <AccessPolicyFields groups={groups} defaults={defaults} confirmBroaderAudience={false} />
      <div className="space-y-4 border-t border-border pt-5">
        <h3 className="font-semibold">Your share link</h3>
        <p className="text-sm text-muted-foreground">For invite audiences, a link is created when you publish. Wallet allowlists use the tester dashboard instead; these link settings are then ignored.</p>
        <div className="grid gap-2"><Label htmlFor="invite-scope">What does this link unlock?</Label><Select id="invite-scope" name="inviteScope" defaultValue="release"><option value="release">This version only</option><option value="project">This app, including future eligible versions</option></Select></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2"><Label htmlFor="invite-limit">Tester places (optional)</Label><Input id="invite-limit" name="inviteMaxUses" type="number" min={1} max={10000} placeholder="Unlimited" /></div>
          <div className="grid gap-2"><Label htmlFor="invite-expiry">Link expires (optional)</Label><Input id="invite-expiry" name="inviteExpiresAt" type="datetime-local" /></div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Only eligible tester identities use a place. A guest is identified by this browser, not by a unique person.</p>
      </div>
    </fieldset>
    {step === 3 && review ? <section className="space-y-5" aria-label="Review before publication">
      <div><h2 className="text-xl font-semibold">Ready to share v{version}?</h2><p className="mt-1 break-all font-mono text-xs text-muted-foreground">{packageName}</p></div>
      <dl className="grid gap-3 rounded-2xl border border-border bg-muted/40 p-4 text-sm">
        <div><dt className="text-muted-foreground">Access</dt><dd className="mt-1 font-semibold">{review.accessPolicy.requireInviteAcceptance ? "Private invite link" : "Wallet allowlist"}{review.accessPolicy.testerGroupId ? ` + ${groups.find((group) => group.id === review.accessPolicy.testerGroupId)?.name ?? "selected group"}` : ""}{review.accessPolicy.requireVerifiedSeeker ? " + verified Seeker wallet" : review.accessPolicy.requireLinkedWallet ? " + linked wallet" : ""}</dd></div>
        {review.accessPolicy.walletAllowlist.length ? <div><dt className="text-muted-foreground">Allowed wallets</dt><dd>{review.accessPolicy.walletAllowlist.length} addresses</dd></div> : null}
        <div><dt className="text-muted-foreground">Older versions</dt><dd>{review.accessPolicy.allowPreviousReleases ? "Earlier builds may be accessed if their own requirements are met" : "Not granted by this release"}</dd></div>
        {review.accessPolicy.requireSolanaMobile ? <div><dt className="text-muted-foreground">Device recommendation</dt><dd>Solana Mobile recommended, never required</dd></div> : null}
        {review.accessPolicy.requireInviteAcceptance ? <><div><dt className="text-muted-foreground">Link scope</dt><dd>{review.invitation.scope === "release" ? "This release only" : "Current and future eligible releases"}</dd></div><div><dt className="text-muted-foreground">Places</dt><dd>{review.invitation.maxUses ?? "Unlimited"}</dd></div><div><dt className="text-muted-foreground">Expires</dt><dd>{review.invitation.expiresAt ? new Date(review.invitation.expiresAt).toLocaleString() : "No expiration"}</dd></div></> : null}
      </dl>
      <div className="whitespace-pre-wrap break-words text-sm leading-7">{review.changelog}</div>
    </section> : null}
    {error ? <p role="alert" className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</p> : null}
    <div className="sticky bottom-3 z-10 flex flex-wrap justify-between gap-3 rounded-2xl border border-border bg-card p-3 shadow-lg">
      {step > 1 ? <Button type="button" variant="secondary" disabled={busy} onClick={() => { setStep(step - 1); setError(""); }}><ArrowLeft className="size-4" />Back</Button> : <span />}
      {step < 3 ? <Button key="continue" type="button" onClick={(event) => { event.preventDefault(); next(); }}>Continue<ArrowRight className="size-4" /></Button> : <Button key="publish" type="submit" disabled={busy}><Send className="size-4" />{busy ? "Publishing..." : review?.accessPolicy.requireInviteAcceptance ? "Publish and create link" : "Publish for allowed wallets"}</Button>}
    </div>
    <p className="text-xs text-muted-foreground" aria-live="polite">{busy ? "Publishing your release. Please keep this page open." : "Your APK is saved. Unsubmitted notes and audience changes are not saved if you leave this page."}</p>
  </form>;
}
