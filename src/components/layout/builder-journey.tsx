import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { cn } from "@/src/lib/utils";

type BuilderJourneyStep = "project" | "release" | "invite" | "test" | "review";

export function BuilderJourney({
  projectSlug,
  current,
  releaseCount,
  inviteCount,
  downloadCount = 0,
}: {
  projectSlug: string;
  current: BuilderJourneyStep;
  releaseCount: number;
  inviteCount: number;
  downloadCount?: number;
}) {
  const steps: Array<{
    id: BuilderJourneyStep;
    label: string;
    detail: string;
    href: string;
    complete: boolean;
  }> = [
    {
      id: "project",
      label: "App details",
      detail: "Name and package",
      href: `/builder/apps/${projectSlug}`,
      complete: true,
    },
    {
      id: "release",
      label: "Build and access",
      detail: "Upload APK and choose who can test",
      href: `/builder/apps/${projectSlug}/releases/new`,
      complete: releaseCount > 0,
    },
    {
      id: "invite",
      label: "Share access",
      detail: "Create a controlled invite link",
      href: `/builder/apps/${projectSlug}/invites`,
      complete: inviteCount > 0,
    },
    {
      id: "test",
      label: "Tester installs",
      detail: "A tester claims and downloads",
      href: `/builder/apps/${projectSlug}`,
      complete: downloadCount > 0,
    },
    {
      id: "review",
      label: "Review results",
      detail: "Inspect downloads and feedback",
      href: `/builder/apps/${projectSlug}`,
      complete: false,
    },
  ];

  return (
    <nav aria-label="Beta release workflow" className="mb-6 overflow-hidden rounded-[1.75rem] border border-brand/25 bg-brand/5 p-4 sm:p-5">
      <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="section-eyebrow">Beta workflow</div>
          <div className="mt-1 font-semibold text-foreground">Follow the release from APK to feedback</div>
        </div>
        <div className="text-xs text-muted-foreground">You can return to any completed step.</div>
      </div>
      <div className="grid gap-2 lg:grid-cols-5">
        {steps.map((step, index) => {
          const isCurrent = step.id === current;
          return (
            <Link
              key={step.id}
              href={step.href}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "group flex min-w-0 items-center gap-3 rounded-2xl border p-3 transition",
                isCurrent
                  ? "border-brand bg-card shadow-sm ring-2 ring-brand/15"
                  : "border-border bg-card/70 hover:border-brand/40 hover:bg-card",
              )}
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold",
                  step.complete ? "bg-success text-white" : isCurrent ? "bg-brand text-white" : "bg-muted text-muted-foreground",
                )}
              >
                {step.complete ? <Check className="size-4" aria-hidden="true" /> : index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-foreground">{step.label}</span>
                <span className="mt-0.5 block text-xs leading-4 text-muted-foreground">{step.detail}</span>
              </span>
              {isCurrent ? <ChevronRight className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
