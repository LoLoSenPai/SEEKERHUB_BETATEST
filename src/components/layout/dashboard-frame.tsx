import Link from "next/link";
import { ArrowLeftRight, Grid2X2, MessageSquare, Plus, Square, Trash2, UserRound } from "lucide-react";
import { AccountMenu } from "@/src/components/layout/account-menu";
import { cn } from "@/src/lib/utils";

const builderItems = [
  { href: "/builder", label: "My apps", icon: Grid2X2 },
  { href: "/builder/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/builder/trash", label: "Trash", icon: Trash2 },
];
const testerItems = [
  { href: "/tester", label: "My apps", icon: Grid2X2 },
  { href: "/tester/feedback", label: "Feedback", icon: MessageSquare },
  { href: "/tester/account", label: "Account", icon: UserRound },
];

export function DashboardFrame({ kind, currentPath, title, subtitle, canBuild = false, isGuest = false,
  identityLabel = "Signed in", identityWalletAddress, projectLinks = [], compactHeader = false, children,
}: {
  kind: "builder" | "tester"; currentPath: string; title: string; subtitle: string;
  canBuild?: boolean; isGuest?: boolean; identityLabel?: string; identityWalletAddress?: string;
  projectLinks?: Array<{ slug: string; name: string }>; compactHeader?: boolean; children: React.ReactNode;
}) {
  const items = kind === "builder" ? builderItems : testerItems;
  const active = (href: string) => currentPath === href ||
    (href === "/builder" && currentPath.startsWith("/builder/apps/")) ||
    (href === "/tester" && currentPath.startsWith("/tester/releases/")) ||
    (href === "/tester/account" && currentPath === "/tester/upgrade");
  const account = <AccountMenu kind={kind} isGuest={isGuest} identityLabel={identityLabel} walletAddress={identityWalletAddress} />;
  return (
    <div className="workspace min-h-screen min-w-0 bg-background">
      <a href="#workspace-content" className="sr-only z-[80] rounded-lg bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4">Skip to content</a>
      <aside className="workspace-sidebar fixed inset-y-0 left-0 z-40 hidden w-60 flex-col px-4 py-7 lg:flex">
        <Link href={kind === "builder" ? "/builder" : "/tester"} className="mb-10 flex items-center gap-2.5 px-3 text-2xl font-bold tracking-tight"><Square className="size-7" aria-hidden="true" />SeekerHub</Link>
        <p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">{kind === "builder" ? "Publishing workspace" : "Your beta library"}</p>
        <nav aria-label="Workspace" className="mt-4 grid gap-1.5">
          {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={cn("sidebar-link flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold", active(href) && "sidebar-link-active")}><Icon className="size-5" aria-hidden="true" />{label}</Link>)}
        </nav>
        {kind === "builder" ? <Link href="/builder/apps/new" className="sidebar-link mt-4 flex items-center gap-3 rounded-xl border border-white/20 px-4 py-3 text-sm font-semibold"><Plus className="size-5" aria-hidden="true" />New app</Link> : null}
        {projectLinks.length ? <div className="mt-7 min-h-0 overflow-y-auto border-t border-white/15 pt-6"><p className="px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">My apps</p><div className="mt-3 grid gap-1">{projectLinks.map(project => <Link key={project.slug} href={`/builder/apps/${project.slug}`} className="sidebar-link flex min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-sm"><Grid2X2 className="size-4 shrink-0" aria-hidden="true" /><span className="truncate">{project.name}</span></Link>)}</div></div> : null}
        <div className="mt-auto space-y-4 pt-8">
          {kind === "builder" || canBuild ? <Link href={kind === "builder" ? "/tester" : "/builder"} className="sidebar-link flex items-center gap-2 rounded-lg px-3 py-2 text-xs"><ArrowLeftRight className="size-4" aria-hidden="true" />{kind === "builder" ? "Switch to testing" : "Builder workspace"}</Link> : null}
          {account}
        </div>
      </aside>
      <div className="lg:pl-60">
        <header className="flex min-w-0 items-center justify-between gap-4 border-b border-border bg-card px-4 py-3 lg:hidden">
          <Link href={kind === "builder" ? "/builder" : "/tester"} className="flex items-center gap-2 font-bold tracking-tight"><Square className="size-5" aria-hidden="true" />SeekerHub</Link>
          <div className="flex min-w-0 items-center gap-2">{kind === "builder" || canBuild ? <Link href={kind === "builder" ? "/tester" : "/builder"} className="rounded-lg border border-border px-3 py-2 text-xs font-semibold">{kind === "builder" ? "Testing" : "Builder"}</Link> : null}{account}</div>
        </header>
        <div className="mx-auto w-full min-w-0 max-w-[1500px] px-4 pb-28 pt-6 sm:px-7 lg:px-10 lg:pb-12 lg:pt-8">
          <main id="workspace-content" tabIndex={-1} className="min-w-0 outline-none">
          <div className={cn("min-w-0", compactHeader ? "hidden lg:mb-4 lg:block" : "mb-6")}>
            <p className="mb-2 hidden text-xs font-medium text-muted-foreground lg:block">{kind === "builder" ? "Publishing workspace" : "Testing"}<span className="mx-2" aria-hidden="true">/</span>{title}</p>
            {!compactHeader ? <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1> : null}
            {!compactHeader && subtitle ? <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{subtitle}</p> : null}
          </div>
          {children}
          </main>
        </div>
      </div>
      <nav aria-label="Mobile workspace" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-3 gap-2 border-t border-border bg-card px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] lg:hidden">
        {items.map(({ href, label, icon: Icon }) => <Link key={href} href={href} aria-current={active(href) ? "page" : undefined} className={cn("flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-semibold", active(href) ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted")}><Icon className="size-5" aria-hidden="true" />{label}</Link>)}
      </nav>
    </div>
  );
}
