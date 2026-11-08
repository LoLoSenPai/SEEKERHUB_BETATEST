"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChevronDown, UserRound } from "lucide-react";
import { SignOutButton } from "@/src/components/layout/sign-out-button";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";
import { WalletName } from "@/src/features/wallet/wallet-name";

export function AccountMenu({ kind, isGuest, identityLabel, walletAddress }: {
  kind: "builder" | "tester"; isGuest: boolean; identityLabel: string; walletAddress?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div ref={root} className="relative min-w-0" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" aria-label="Account and appearance" aria-expanded={open} onClick={() => setOpen(!open)} className="flex w-full cursor-pointer items-center gap-2 rounded-xl p-2 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand"><UserRound className="size-4" aria-hidden="true" /></span>
      <span className="hidden min-w-0 flex-1 lg:block"><span className="block truncate text-xs font-semibold" title={walletAddress ?? identityLabel}>{walletAddress && !isGuest ? <WalletName address={walletAddress} /> : identityLabel}</span><span className="mt-1 block text-[10px] opacity-65">{isGuest ? "Saved in this browser" : "Account & appearance"}</span></span><ChevronDown className="hidden size-3.5 shrink-0 lg:block" aria-hidden="true" />
    </button>
    {open ? <div className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] space-y-3 rounded-2xl border border-border bg-card p-4 text-foreground shadow-xl lg:bottom-full lg:left-0 lg:top-auto lg:mb-2 lg:mt-0">
      <p className="break-words text-sm font-semibold">{isGuest ? "Guest tester" : identityLabel}</p>
      {isGuest ? <p className="text-xs leading-5 text-muted-foreground">Your access is saved in this browser. Add an email or wallet to find your apps on another device.</p> : null}
      {kind === "tester" ? <Link className="block text-sm font-semibold underline underline-offset-4" href={isGuest ? "/tester/upgrade" : "/tester/account"}>{isGuest ? "Save your access" : "Manage account"}</Link> : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3"><ThemeToggle />{!isGuest ? <SignOutButton /> : null}</div>
    </div> : null}
  </div>;
}
