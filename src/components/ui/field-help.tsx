import { CircleHelp } from "lucide-react";
import { Label } from "@/src/components/ui/label";
import { cn } from "@/src/lib/utils";

export function FieldHelp({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <details className={cn("group relative inline-flex", className)}>
      <summary
        aria-label={`Help: ${title}`}
        className="flex size-6 cursor-help list-none items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        <CircleHelp className="size-4" aria-hidden="true" />
      </summary>
      <div className="fixed inset-x-4 bottom-4 z-50 rounded-2xl border border-border bg-card p-4 text-xs font-normal leading-5 text-card-foreground shadow-xl sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-7 sm:w-72 sm:p-3">
        <div className="font-semibold">{title}</div>
        <div className="mt-1 text-muted-foreground">{children}</div>
      </div>
    </details>
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
