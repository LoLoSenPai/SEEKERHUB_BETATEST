import Link from "next/link";
import { AppWindow, Boxes, CircleUserRound, Trash2 } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";
import { SignOutButton } from "@/src/components/layout/sign-out-button";
import { ThemeToggle } from "@/src/components/theme/theme-toggle";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const builderItems: NavItem[] = [
  { href: "/builder", label: "Overview", icon: AppWindow },
  { href: "/builder/apps/new", label: "New app", icon: Boxes },
  { href: "/builder/trash", label: "Trash", icon: Trash2 },
];

export function DashboardFrame({
  kind,
  currentPath,
  title,
  subtitle,
  canBuild = false,
  isGuest = false,
  identityLabel = "Signed in",
  children,
}: {
  kind: "builder" | "tester";
  currentPath: string;
  title: string;
  subtitle: string;
  canBuild?: boolean;
  isGuest?: boolean;
  identityLabel?: string;
  children: React.ReactNode;
}) {
  const items = builderItems;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="page-shell">
        <div className="grid min-w-0 gap-5 rounded-[1.75rem] border border-border bg-surface p-5 shadow-sm backdrop-blur lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
          <div className="min-w-0">
            <div className="section-eyebrow">{kind === "builder" ? "Builder workspace" : "Tester dashboard"}</div>
            <h1 className="mt-2 break-words text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{subtitle}</p>
          </div>
          <div className="grid min-w-0 gap-3 lg:justify-items-end">
            <div className="flex flex-wrap items-center gap-2">
              {kind === "builder" || canBuild ? <div className="flex items-center rounded-full border border-border bg-card p-1">
                <Link href="/builder" className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", kind === "builder" && "bg-primary text-primary-foreground")}>Builder workspace</Link>
                <Link href="/tester" className={cn("rounded-full px-3 py-1.5 text-xs font-semibold", kind === "tester" && "bg-primary text-primary-foreground")}>Testing</Link>
              </div> : null}
              <Badge variant="brand" className="hidden sm:inline-flex">{kind === "builder" ? "PRIVATE RELEASES" : "MOBILE FIRST"}</Badge>
              <ThemeToggle />
            </div>
            <div className="flex min-w-0 max-w-full items-center rounded-full border border-border bg-card p-1 pl-3 shadow-sm">
              <CircleUserRound className="size-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0 truncate px-2 text-xs font-semibold" title={identityLabel}>{identityLabel}</span>
              {isGuest ? (
                <span className="hidden border-l border-border px-3 text-xs text-muted-foreground sm:inline">Saved in this browser</span>
              ) : (
                <SignOutButton />
              )}
            </div>
          </div>
        </div>

        <div className={cn("grid min-w-0 gap-6", kind === "builder" && "lg:grid-cols-[250px_minmax(0,1fr)]")}>
          {kind === "builder" ? <aside className="glass-panel h-fit p-4">
            <div className="px-3 py-2">
              <div className="font-mono text-xs uppercase tracking-[0.22em] text-muted-foreground">Navigate</div>
            </div>
            <nav className="mt-2 grid gap-2">
              {items.map((item) => {
                const active = currentPath === item.href;
                const Icon = item.icon;

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-medium transition",
                      active ? "bg-primary text-primary-foreground" : "bg-card text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="size-4" />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </aside> : null}
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </div>
  );
}
