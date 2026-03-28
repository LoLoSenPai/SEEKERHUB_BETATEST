"use client";

import { useSyncExternalStore } from "react";
import { MoonStar, SunMedium } from "lucide-react";
import { useTheme } from "@/src/components/theme/theme-provider";
import { cn } from "@/src/lib/utils";

function subscribe() {
  return () => {};
}

export function ThemeToggle() {
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
        "fixed bottom-5 right-5 z-50 inline-flex h-12 items-center gap-2 rounded-full border px-4 shadow-[0_18px_45px_rgba(15,23,42,0.18)] backdrop-blur transition",
        "border-border bg-surface text-foreground hover:translate-y-[-1px] hover:bg-card",
      )}
    >
      {isDark ? <SunMedium className="size-4" /> : <MoonStar className="size-4" />}
      <span className="text-sm font-semibold">{isDark ? "Light" : "Dark"}</span>
    </button>
  );
}
