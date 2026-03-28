import { cn } from "@/src/lib/utils";

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-32 w-full rounded-3xl border border-input bg-card px-4 py-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-ring",
        className,
      )}
      {...props}
    />
  );
}
