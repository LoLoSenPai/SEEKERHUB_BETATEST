"use client";

import { useFormStatus } from "react-dom";
import { Upload, Smartphone, LoaderCircle } from "lucide-react";
import { switchWorkspaceAction } from "@/src/features/workspace/actions";
import type { Workspace } from "@/src/lib/workspace";
import { cn } from "@/src/lib/utils";

function WorkspaceOptions({ current, dark }: { current?: Workspace; dark: boolean }) {
  const { pending } = useFormStatus();
  return <>
    {([{ value: "publishing", label: "Publishing", icon: Upload }, { value: "testing", label: "Testing", icon: Smartphone }] as const).map(({ value, label, icon: Icon }) =>
      <button key={value} name="workspace" value={value} type="submit" disabled={pending || current === value}
        aria-pressed={current === value}
        className={cn("flex min-h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg px-2 py-2 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-default",
          current === value ? (dark ? "bg-white text-[#111214]" : "bg-primary text-primary-foreground") : (dark ? "text-white/80 hover:bg-white/10" : "text-muted-foreground hover:bg-card"), pending && "opacity-60")}>
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />{label}
      </button>)}
    <span role="status" className="sr-only">{pending ? "Opening workspace..." : ""}</span>
    {pending ? <LoaderCircle className="absolute right-2 top-full mt-1 size-3 animate-spin" aria-hidden="true" /> : null}
  </>;
}

export function WorkspaceSwitcher({ current, dark = false }: { current?: Workspace; dark?: boolean }) {
  return <form action={switchWorkspaceAction} aria-label="Switch workspace" className={cn("relative flex min-w-0 gap-1 rounded-xl p-1", dark ? "bg-white/10" : "bg-muted")}>
    <WorkspaceOptions current={current} dark={dark} />
  </form>;
}
