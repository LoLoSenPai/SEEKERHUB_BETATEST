"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";

export function FieldHelp({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLSpanElement>(null);
  const helpId = useId();

  useEffect(() => {
    if (!open) return;

    function closeOnOutsidePress(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <span
      ref={containerRef}
      className={cn("relative inline-flex", className)}
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") setOpen(true);
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !containerRef.current?.contains(document.activeElement)) setOpen(false);
      }}
    >
      <button
        type="button"
        aria-label={`Help: ${title}`}
        aria-expanded={open}
        aria-describedby={open ? helpId : undefined}
        onClick={() => setOpen(true)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="flex size-6 cursor-help items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </button>
      {open ? (
        <span
          id={helpId}
          role="tooltip"
          className="fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-border bg-card p-4 text-xs font-normal leading-5 text-card-foreground shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-7 sm:w-72 sm:p-3"
        >
          <span className="block font-semibold">{title}</span>
          <span className="mt-1 block text-muted-foreground">{children}</span>
        </span>
      ) : null}
    </span>
  );
}

export function FieldLabel({
  htmlFor,
  children,
  helpTitle,
  help,
  className,
}: {
  htmlFor: string;
  children: React.ReactNode;
  helpTitle: string;
  help: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Label htmlFor={htmlFor}>{children}</Label>
      <FieldHelp title={helpTitle}>{help}</FieldHelp>
    </div>
  );
}
