"use client";

import { useRef } from "react";
import { ImagePlus, Upload } from "lucide-react";
import { cn } from "@/src/lib/utils";

export function MediaFilePicker({ label, disabled, onFile, compact = false, className, hint }: {
  label: string;
  disabled: boolean;
  onFile: (file: File) => void;
  compact?: boolean;
  className?: string;
  hint?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return <div className={cn("min-w-0", className)}>
    <input ref={input} type="file" hidden aria-label={label} disabled={disabled}
      accept="image/jpeg,image/png,image/webp" onChange={(event) => {
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = "";
        if (file && !disabled) onFile(file);
      }} />
    <button type="button" disabled={disabled} onClick={() => input.current?.click()}
      className={cn("flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-55",
        compact ? "min-h-10 border border-border bg-secondary px-3 py-2 text-secondary-foreground hover:bg-muted" : "h-full min-h-28 flex-col border-2 border-dashed border-brand/30 bg-panel p-4 text-foreground hover:border-brand hover:bg-brand-soft") }>
      {compact ? <Upload className="size-4 shrink-0" aria-hidden="true" /> : <span className="flex size-10 items-center justify-center rounded-xl bg-brand-soft"><ImagePlus className="size-5 text-brand" aria-hidden="true" /></span>}
      <span>{label}</span>
      {!compact && hint ? <span className="text-center text-xs font-normal text-muted-foreground">{hint}</span> : null}
    </button>
  </div>;
}
