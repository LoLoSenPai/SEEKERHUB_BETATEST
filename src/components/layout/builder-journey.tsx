import Link from "next/link";
import { cn } from "@/src/lib/utils";

type BuilderJourneyStep = "project" | "release" | "invite" | "test" | "review";

export function BuilderJourney({ projectSlug, current }: {
  projectSlug: string; current: BuilderJourneyStep; releaseCount: number; inviteCount: number; downloadCount?: number;
}) {
  const base = `/builder/apps/${projectSlug}`;
  const items = [
    { label: "Builds", href: `${base}#releases`, active: current === "release" || current === "review" },
    { label: "Invite links", href: `${base}/invites`, active: current === "invite" },
    { label: "Testers", href: `${base}/groups`, active: current === "test" },
    { label: "Feedback", href: `/builder/feedback?app=${encodeURIComponent(projectSlug)}`, active: false },
    { label: "App profile", href: `${base}#settings`, active: current === "project" },
  ];
  return <nav aria-label="Project navigation" className="mb-6 flex flex-wrap gap-1 border-b border-border pb-3">
    {items.map(item => <Link key={item.label} href={item.href} aria-current={item.active ? "page" : undefined}
      className={cn("rounded-full px-4 py-2.5 text-xs font-semibold transition sm:text-sm", item.active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{item.label}</Link>)}
  </nav>;
}
