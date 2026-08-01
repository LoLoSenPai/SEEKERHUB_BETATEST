"use client";

import { useState } from "react";
import { ArrowRight, Check, Link2, ShieldCheck, Users, WalletCards } from "lucide-react";
import { FieldHelp, FieldLabel } from "@/src/components/ui/field-help";
import { Input } from "@/src/components/ui/input";
import { Select } from "@/src/components/ui/select";
import { Textarea } from "@/src/components/ui/textarea";
import { cn } from "@/src/lib/utils";

type AccessPreset = "invite" | "group" | "wallet" | "seeker";

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
    title: "Limited invite link",
    description: "Share one link, then choose its tester limit when you create the invitation.",
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
    title: "Verified Seeker invite",
    description: "A shared invite works only after the tester proves current Seeker Genesis Token ownership.",
    icon: ShieldCheck,
  },
];

function inferPreset(defaults: PolicyDefaults): AccessPreset {
  if (defaults.requireVerifiedSeeker && defaults.requireInviteAcceptance) return "seeker";
  if (defaults.testerGroupId) return "group";
  if (!defaults.requireInviteAcceptance && defaults.requireLinkedWallet) return "wallet";
  return "invite";
}

export function AccessPolicyFields({
  groups,
  defaults = {},
}: {
  groups: Array<{ id: string; name: string }>;
  defaults?: PolicyDefaults;
}) {
  const [preset, setPreset] = useState<AccessPreset>(() => inferPreset(defaults));
  const [requireInvite, setRequireInvite] = useState(defaults.requireInviteAcceptance ?? true);
  const [groupId, setGroupId] = useState(defaults.testerGroupId ?? "");
  const [requireWallet, setRequireWallet] = useState(defaults.requireLinkedWallet ?? false);
  const [requireSeeker, setRequireSeeker] = useState(defaults.requireVerifiedSeeker ?? false);
  const [recommendMobile, setRecommendMobile] = useState(defaults.requireSolanaMobile ?? true);
  const [allowPrevious, setAllowPrevious] = useState(defaults.allowPreviousReleases ?? false);
  const [allowlist, setAllowlist] = useState(defaults.walletAllowlist ?? "");

  function applyPreset(nextPreset: AccessPreset) {
    setPreset(nextPreset);
    setGroupId(nextPreset === "group" ? groupId : "");
    setRequireInvite(nextPreset !== "wallet");
    setRequireWallet(nextPreset === "wallet" || nextPreset === "seeker");
    setRequireSeeker(nextPreset === "seeker");
  }

  const accessSteps = preset === "wallet"
    ? ["Tester signs in", "Links an allowlisted wallet", "Downloads the APK"]
    : preset === "seeker"
      ? ["Claims the invite", "Links a wallet", "Verifies Seeker ownership", "Downloads the APK"]
      : preset === "group"
        ? ["Claims the group invite", "Receives a group place", "Downloads the APK"]
        : ["Claims the invite", "Receives an eligible tester place", "Downloads the APK"];

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
                  "relative flex cursor-pointer gap-3 rounded-2xl border p-4 transition",
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

      {preset === "group" ? (
        <div className="grid gap-2">
          <FieldLabel
            htmlFor="testerGroupId"
            helpTitle="Tester group"
            help="Groups are reusable cohorts. Create one first, then use an invite scoped to that same group."
          >
            Tester group
          </FieldLabel>
          <Select id="testerGroupId" name="testerGroupId" value={groupId} onChange={(event) => setGroupId(event.target.value)} required>
            <option value="">Select a tester group</option>
            {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
          </Select>
          {!groups.length ? <p className="text-xs text-danger">Create a tester group before using this preset.</p> : null}
        </div>
      ) : <input type="hidden" name="testerGroupId" value="" />}

      {(preset === "wallet" || (requireWallet && preset !== "seeker")) ? (
        <div className="grid gap-2">
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
            onChange={(event) => setAllowlist(event.target.value)}
            placeholder={"9x...abc\n7Q...def"}
            required={preset === "wallet"}
          />
        </div>
      ) : <input type="hidden" name="walletAllowlist" value="" />}

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
          {preset === "wallet"
            ? "Share your tester dashboard URL. The release appears only after an allowed wallet is linked."
            : "After publishing, create an invite link and choose its Tester limit. Ineligible wallet or SGT claims do not consume a tester place."}
        </p>
      </div>

      <div className="grid gap-3 rounded-2xl border border-border bg-card p-4 sm:grid-cols-2">
        <PolicyCheckbox
          name="requireInviteAcceptance"
          checked={requireInvite}
          onChange={setRequireInvite}
          disabled
          label="Require an invite link"
          help="Enabled for limited-link, group, and Seeker presets. You choose the number of eligible testers later, when creating the share link."
        />
        <PolicyCheckbox
          name="requireLinkedWallet"
          checked={requireWallet}
          onChange={setRequireWallet}
          disabled={preset === "wallet" || preset === "seeker"}
          label="Require wallet verification"
          help="The tester must connect a compatible Solana wallet and sign a challenge to prove control. Merely having Phantom, Solflare, or Seed Vault installed is not enough."
        />
        <PolicyCheckbox
          name="requireVerifiedSeeker"
          checked={requireSeeker}
          onChange={(checked) => {
            setRequireSeeker(checked);
            if (checked) setRequireWallet(true);
          }}
          disabled={preset === "seeker"}
          label="Require verified Seeker (SGT)"
          help="Blocks download until the linked wallet has a recent server-side Seeker Genesis Token verification."
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
    </div>
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
