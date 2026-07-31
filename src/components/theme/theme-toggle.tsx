"use client";

import { useSyncExternalStore } from "react";
import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "@/src/components/theme/theme-provider";
import { cn } from "@/src/lib/utils";

function subscribe() {
  return () => {};
}

export function ThemeToggle({ className }: { className?: string }) {
  const isHydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  if (!isHydrated) {
    return null;
  }

  return (
    <button
      type="button"
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      onClick={toggleTheme}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-3 backdrop-blur transition",
        "border-border bg-surface text-foreground hover:bg-card",
        className,
      )}
    >
      {isDark ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
      <span className="text-sm font-semibold">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
