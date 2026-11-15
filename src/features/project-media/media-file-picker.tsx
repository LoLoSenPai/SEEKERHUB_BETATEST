"use client";

import { useRef, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function MediaFilePicker({ label, disabled, onFile, className, children }: {
  label: string; disabled: boolean; onFile: (file: File) => void; className?: string; children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className={cn("min-w-0", className)}>
    <input ref={input} type="file" hidden aria-label={label} disabled={disabled}
      accept="image/jpeg,image/png,image/webp" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = "";
        if (file && !disabled) onFile(file);
      }} />
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={() => input.current?.click()}
      className={cn("group/picker relative flex size-full cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait",
        children ? "bg-surface" : "min-h-24 border border-dashed border-brand/40 bg-panel text-muted-foreground transition-colors hover:border-brand hover:text-foreground")}>
      {children ?? <><Plus className="size-5" aria-hidden="true" /><span>{label}</span></>}
    </button>
  </div>;
}
