import Link from "next/link";

type BuilderJourneyStep = "project" | "release" | "invite" | "test" | "review";

export function BuilderJourney({ projectSlug }: {
  projectSlug: string;
  current: BuilderJourneyStep;
  releaseCount: number;
  inviteCount: number;
  downloadCount?: number;
}) {
  const base = `/builder/apps/${projectSlug}`;
  const items = [
    { label: "Releases", href: `${base}#releases` },
    { label: "Testers", href: `${base}/groups` },
    { label: "Invite links", href: `${base}/invites` },
    { label: "Settings", href: `${base}#settings` },
  ];
  return (
    <nav aria-label="Project navigation" className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-2">
      {items.map((item) => <Link key={item.label} href={item.href} className="rounded-xl px-4 py-2 text-sm font-semibold transition hover:bg-muted">{item.label}</Link>)}
    </nav>
  );
}
