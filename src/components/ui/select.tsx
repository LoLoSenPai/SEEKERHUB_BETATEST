import { cn } from "@/src/lib/utils";

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-ring",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
