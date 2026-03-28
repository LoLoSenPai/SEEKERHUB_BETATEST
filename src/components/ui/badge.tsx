import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/src/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-3 py-1 font-mono text-[11px] uppercase tracking-[0.18em]", {
  variants: {
    variant: {
      neutral: "bg-secondary text-secondary-foreground",
      brand: "bg-brand-soft text-brand",
      success: "bg-emerald-50 text-emerald-700",
      danger: "bg-rose-50 text-rose-700",
    },
  },
  defaultVariants: {
    variant: "neutral",
  },
});

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
