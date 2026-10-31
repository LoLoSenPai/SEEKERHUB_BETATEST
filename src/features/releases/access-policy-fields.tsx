"use client";

import { useActionState, useState } from "react";
import { ArrowRight, Check, Link2, ShieldCheck, Users, WalletCards } from "lucide-react";
import { FieldHelp, FieldLabel } from "@/src/components/ui/field-help";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";
import { isPolicyAudienceBroadened } from "@/src/lib/access";
import { updateReleasePolicyAction, type ReleasePolicyFormState } from "@/src/features/releases/actions";

type AccessPreset = "invite" | "group" | "wallet" | "seeker" | "custom";

type PolicyDefaults = {
  requireInviteAcceptance?: boolean;
  testerGroupId?: string | null;
  requireLinkedWallet?: boolean;
  requireSolanaMobile?: boolean;
  requireVerifiedSeeker?: boolean;
  allowPreviousReleases?: boolean;
  walletAllowlist?: string;
};

const presets: Array<{
  id: AccessPreset;
  title: string;
  description: string;
  icon: typeof Link2;
}> = [
  {
    id: "invite",
    title: "Private invite link",
    description: "Share one link. Choose a tester limit or keep it unlimited.",
    icon: Link2,
  },
  {
    id: "group",
    title: "Tester group",
    description: "The invite grants access only through a reusable QA or community cohort.",
    icon: Users,
  },
  {
    id: "wallet",
    title: "Wallet allowlist",
    description: "Only the exact Solana addresses you list can discover and download the build.",
    icon: WalletCards,
  },
  {
    id: "seeker",
    title: "Seeker holders (SGT)",
    description: "Verify the wallet holds a Seeker Genesis Token, not which phone the tester is using.",
    icon: ShieldCheck,
  },
  {
    id: "custom",
    title: "Combined requirements",
    description: "Combine invite, group, wallet and SGT rules. All selected requirements apply.",
    icon: ShieldCheck,
  },
];

function inferPreset(defaults: PolicyDefaults): AccessPreset {
  if ((defaults.testerGroupId && (defaults.requireVerifiedSeeker || defaults.walletAllowlist?.trim())) ||
    (defaults.requireVerifiedSeeker && defaults.walletAllowlist?.trim()) ||
    (defaults.requireInviteAcceptance === false && (!defaults.requireLinkedWallet || !defaults.walletAllowlist?.trim())) ||
    (defaults.testerGroupId && defaults.requireInviteAcceptance === false)) return "custom";
  if (defaults.requireVerifiedSeeker && defaults.requireInviteAcceptance) return "seeker";
  if (defaults.testerGroupId) return "group";
  if (!defaults.requireInviteAcceptance && defaults.requireLinkedWallet) return "wallet";
  return "invite";
}

export type AccessPolicyFieldsProps = {
  groups: Array<{ id: string; name: string }>;
  defaults?: PolicyDefaults;
  confirmBroaderAudience?: boolean;
};

export function AccessPolicyFields({ groups, defaults = {}, confirmBroaderAudience = true }: AccessPolicyFieldsProps) {
  const [preset, setPreset] = useState<AccessPreset>(() => inferPreset(defaults));
  const [requireInvite, setRequireInvite] = useState(defaults.requireInviteAcceptance ?? true);
  const [groupId, setGroupId] = useState(defaults.testerGroupId ?? "");
  const [requireWallet, setRequireWallet] = useState(Boolean(defaults.requireLinkedWallet || defaults.requireVerifiedSeeker || defaults.walletAllowlist?.trim()));
  const [requireSeeker, setRequireSeeker] = useState(defaults.requireVerifiedSeeker ?? false);
  const [recommendMobile, setRecommendMobile] = useState(defaults.requireSolanaMobile ?? true);
  const [allowPrevious, setAllowPrevious] = useState(defaults.allowPreviousReleases ?? false);
  const [allowlist, setAllowlist] = useState(defaults.walletAllowlist ?? "");
  const audienceBroadened = isPolicyAudienceBroadened(
    { ...defaults, walletAllowlist: splitAllowlist(defaults.walletAllowlist ?? "") },
    { requireInviteAcceptance: requireInvite, testerGroupId: groupId, requireLinkedWallet: requireWallet,
      requireVerifiedSeeker: requireSeeker, allowPreviousReleases: allowPrevious, walletAllowlist: splitAllowlist(allowlist) },
  );

  function applyPreset(nextPreset: AccessPreset) {
    setPreset(nextPreset);
    if (nextPreset === "custom") return;
    setGroupId(nextPreset === "group" ? groupId : "");
    setRequireInvite(nextPreset !== "wallet");
    setRequireWallet(nextPreset === "wallet" || nextPreset === "seeker");
    setRequireSeeker(nextPreset === "seeker");
    setAllowlist(nextPreset === "wallet" ? allowlist : "");
  }

  const accessSteps = [
    requireInvite ? "Claims the invite" : "Tester signs in",
    ...(groupId ? ["Joins the required tester group"] : []),
    ...(requireWallet || allowlist.trim() ? [allowlist.trim() ? "Links an allowlisted wallet" : "Links a wallet"] : []),
    ...(requireSeeker ? ["Verifies SGT ownership"] : []),
    "Downloads the APK",
  ];

  return (
    <div className="grid min-w-0 gap-6">
      <fieldset className="grid gap-3">
        <legend className="flex items-center gap-1 text-sm font-semibold text-foreground">
          Who should get access?
          <FieldHelp title="Audience preset">
            Start with the closest sharing model. You can still change the policy later without uploading the APK again.
          </FieldHelp>
        </legend>
        <div className="grid gap-3 md:grid-cols-2">
          {presets.map((option) => {
            const Icon = option.icon;
            const selected = preset === option.id;
            return (
              <label
                key={option.id}
                className={cn(
                  "relative flex cursor-pointer gap-3 rounded-2xl border p-4 transition focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
                  selected ? "border-brand bg-brand/10 shadow-sm" : "border-border bg-card hover:bg-muted/50",
                )}
              >
                <input
                  type="radio"
                  name="accessPreset"
                  value={option.id}
                  checked={selected}
                  onChange={() => applyPreset(option.id)}
                  className="sr-only"
                />
                <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", selected ? "bg-brand text-white" : "bg-muted text-muted-foreground")}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 font-semibold text-foreground">
                    {option.title}
                    {selected ? <Check className="size-4 text-brand" aria-hidden="true" /> : null}
                  </span>
                  <span className="mt-1 block text-sm leading-6 text-muted-foreground">{option.description}</span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <div hidden={preset !== "group" && preset !== "custom" && !groupId} className="space-y-2">
        <FieldLabel
          htmlFor="testerGroupId"
          helpTitle="Tester group"
          help="Groups are reusable cohorts. Create one first, then use an invite scoped to that same group."
        >
          Tester group
        </FieldLabel>
        <Select id="testerGroupId" name="testerGroupId" value={groupId} onChange={(event) => { setGroupId(event.target.value); setPreset("custom"); }} required={preset === "group"}>
          <option value="">No tester group requirement</option>
          {groupId && !groups.some((group) => group.id === groupId) ? <option value={groupId}>Current group (unavailable)</option> : null}
          {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
        </Select>
        {!groups.length && preset === "group" ? <p className="text-xs text-danger">Create a tester group before using this preset.</p> : null}
      </div>

      <div hidden={preset !== "wallet" && preset !== "custom" && !allowlist.trim()} className="space-y-2">
        <FieldLabel
          htmlFor="walletAllowlist"
          helpTitle="Wallet allowlist"
          help="Enter one Solana address per line to restrict access to exact wallets. Leave it empty to accept any linked wallet."
        >
          Allowed Solana wallets
        </FieldLabel>
        <Textarea
          id="walletAllowlist"
          name="walletAllowlist"
          value={allowlist}
          onChange={(event) => { setAllowlist(event.target.value); setPreset("custom"); }}
          placeholder={"9x...abc\n7Q...def"}
          required={preset === "wallet"}
        />
      </div>

      <div className="rounded-2xl border border-brand/20 bg-brand/5 p-4">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Tester journey</div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-foreground">
          {accessSteps.map((step, index) => (
            <span key={step} className="contents">
              <span className="rounded-full border border-border bg-card px-3 py-1.5">{step}</span>
              {index < accessSteps.length - 1 ? <ArrowRight className="size-4 text-muted-foreground" aria-hidden="true" /> : null}
            </span>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {!requireInvite
            ? "Share your tester dashboard URL. The release appears only after an allowed wallet is linked."
            : "The invite's tester limit applies only to eligible claims. A wallet or SGT requirement must be met before a place is granted."}
        </p>
        {requireSeeker ? <p className="mt-2 text-xs leading-5 text-muted-foreground">This checks the wallet, not the current phone. The same SGT wallet imported into another wallet app can qualify on a different device.</p> : null}
      </div>

      <details open={preset === "custom" ? true : undefined} className="rounded-2xl border border-border bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Additional requirements and older versions</summary>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">Optional refinements. Your selected audience already sets the required access rules.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <PolicyCheckbox
          name="requireInviteAcceptance"
          checked={requireInvite}
          onChange={(checked) => { setRequireInvite(checked); setPreset("custom"); }}
          label="Require an invite link"
          help="Enabled for invite, group, and Seeker presets. Set the number of eligible testers in the share-link settings."
        />
        <PolicyCheckbox
          name="requireLinkedWallet"
          checked={requireWallet || requireSeeker || Boolean(allowlist.trim())}
          onChange={(checked) => { setRequireWallet(checked); setPreset("custom"); }}
          disabled={requireSeeker || Boolean(allowlist.trim())}
          label="Require wallet verification"
          help="The tester must connect a compatible Solana wallet and sign a challenge to prove control. Merely having Phantom, Solflare, or Seed Vault installed is not enough."
        />
        <PolicyCheckbox
          name="requireVerifiedSeeker"
          checked={requireSeeker}
          onChange={(checked) => {
            setRequireSeeker(checked);
            setPreset("custom");
            if (checked) setRequireWallet(true);
          }}
          label="Require Seeker Genesis Token (SGT)"
          help="Requires a recent server-verified SGT in the linked wallet. It does not restrict the current phone: the same wallet imported into Phantom or another wallet app can pass on a non-Seeker device."
        />
        <PolicyCheckbox
          name="requireSolanaMobile"
          checked={recommendMobile}
          onChange={setRecommendMobile}
          label="Recommend Solana Mobile"
          help="Shows device guidance but never blocks access. Device detection alone is not proof of Seeker ownership."
        />
        <PolicyCheckbox
          name="allowPreviousReleases"
          checked={allowPrevious}
          onChange={setAllowPrevious}
          label="Let testers access older versions"
          help="Lets an eligible tester browse earlier published builds of this app. It does not grant access to future releases, which keep their own access rules."
        />
        </div>
      </details>
      {confirmBroaderAudience && audienceBroadened ? (
        <label className="flex items-start gap-3 rounded-xl border border-danger/30 p-4 text-sm">
          <input type="checkbox" name="confirmAudienceBroadening" required className="mt-1" />
          <span>I confirm this change may give more testers access, including by removing requirements or allowing older builds.</span>
        </label>
      ) : null}
    </div>
  );
}

function splitAllowlist(value: string) {
  return value.split(/\r?\n/).map((address) => address.trim()).filter(Boolean);
}

const initialPolicyState: ReleasePolicyFormState = { status: "idle", message: "" };

export function ReleasePolicyEditor({ releaseId, projectSlug, groups, defaults }: AccessPolicyFieldsProps & {
  releaseId: string;
  projectSlug: string;
}) {
  const [state, action, pending] = useActionState(updateReleasePolicyAction, initialPolicyState);
  return (
    <form action={action} className="grid gap-5" aria-busy={pending}>
      <input type="hidden" name="releaseId" value={releaseId} />
      <input type="hidden" name="projectSlug" value={projectSlug} />
      <AccessPolicyFields groups={groups} defaults={defaults} />
      {state.message ? <p role={state.status === "error" ? "alert" : "status"}>{state.message}</p> : null}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save access policy"}
      </Button>
    </form>
  );
}

function PolicyCheckbox({
  name,
  checked,
  onChange,
  label,
  help,
  disabled = false,
}: {
  name: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  help: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-w-0 items-start gap-2">
      <label className={cn("flex min-w-0 flex-1 items-start gap-3 text-sm text-foreground", disabled ? "cursor-default" : "cursor-pointer")}>
        {disabled && checked ? <input type="hidden" name={name} value="on" /> : null}
        <Input
          type="checkbox"
          name={name}
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 size-4 shrink-0"
          disabled={disabled}
        />
        <span>{label}</span>
      </label>
      <FieldHelp title={label}>{help}</FieldHelp>
    </div>
  );
}
