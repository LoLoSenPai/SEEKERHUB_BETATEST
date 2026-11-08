import Image from "next/image";
import { BRAND_ICON_PATH } from "@/src/lib/brand";
import { cn } from "@/src/lib/utils";

export function BrandIcon({ size = 32, className }: { size?: number; className?: string }) {
  return <Image src={BRAND_ICON_PATH} alt="" aria-hidden="true" width={size} height={size} className={cn("shrink-0", className)} />;
}
