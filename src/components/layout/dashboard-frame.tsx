import Link from "next/link";
import { AppWindow, Boxes, Smartphone } from "lucide-react";
import { Badge } from "@/src/components/ui/badge";
import { cn } from "@/src/lib/utils";
import { SignOutButton } from "@/src/components/layout/sign-out-button";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const builderItems: NavItem[] = [
  { href: "/builder", label: "Overview", icon: AppWindow },
  { href: "/builder/apps/new", label: "New app", icon: Boxes },
];

const testerItems: NavItem[] = [{ href: "/tester", label: "My releases", icon: Smartphone }];

export function DashboardFrame({
  kind,
  currentPath,
  title,
  subtitle,
  children,
}: {
  kind: "builder" | "tester";
  currentPath: string;
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  const items = kind === "builder" ? builderItems : testerItems;

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted">
      <div className="page-shell">
        <div className="flex flex-col gap-4 rounded-[1.75rem] border border-border bg-surface p-5 shadow-sm backdrop-blur lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="section-eyebrow">{kind === "builder" ? "Builder workspace" : "Tester dashboard"}</div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">{title}</h1>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{subtitle}</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="brand">{kind === "builder" ? "PRIVATE RELEASES" : "MOBILE FIRST"}</Badge>
            <SignOutButton />
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
          <aside className="glass-panel h-fit p-4">
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
          </aside>
          <section className="min-w-0">{children}</section>
        </div>
      </div>
    </div>
  );
}
