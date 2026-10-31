"use client";

import { Toaster } from "sonner";
import type { CSSProperties } from "react";
import { ThemeProvider } from "@/src/components/theme/theme-provider";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <Toaster richColors position="top-right" style={{
        "--normal-bg": "var(--card)", "--normal-text": "var(--foreground)", "--normal-border": "var(--border)",
        "--success-bg": "var(--accent)", "--success-text": "var(--accent-foreground)", "--success-border": "var(--border)",
        "--error-bg": "var(--card)", "--error-text": "var(--danger)", "--error-border": "var(--border)",
        "--info-bg": "var(--brand-soft)", "--info-text": "var(--brand)", "--info-border": "var(--border)",
        "--warning-bg": "var(--muted)", "--warning-text": "var(--foreground)", "--warning-border": "var(--border)",
      } as CSSProperties} />
    </ThemeProvider>
  );
}
