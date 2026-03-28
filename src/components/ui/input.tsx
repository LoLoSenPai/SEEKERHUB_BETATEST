import { cn } from "@/src/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const isFileInput = props.type === "file";

  return (
    <input
      className={cn(
        "h-11 w-full rounded-2xl border border-input bg-card px-4 text-sm text-foreground outline-none transition focus:border-brand focus:ring-4 focus:ring-ring",
        isFileInput &&
          "cursor-pointer py-1 file:mr-3 file:cursor-pointer file:rounded-full file:border-0 file:bg-secondary file:px-4 file:py-2 file:text-sm file:font-medium file:text-secondary-foreground hover:bg-muted/60",
        className,
      )}
      {...props}
    />
  );
}
