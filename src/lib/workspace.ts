export type Workspace = "publishing" | "testing";
export const WORKSPACE_COOKIE = "seekerhub-workspace";

export function workspacePreference(value: string | undefined, userId: string): Workspace | null {
  const [workspace, owner, ...extra] = (value ?? "").split(":");
  return !extra.length && owner === userId && (workspace === "publishing" || workspace === "testing") ? workspace : null;
}

// A navigation preference never grants permissions; destination pages enforce them.
export function dashboardDestination(input: {
  isGuest: boolean;
  builderStatus: "ACTIVE" | "SUSPENDED" | null;
  hasTestingActivity: boolean;
  preference: Workspace | null;
}): "/builder" | "/tester" | null {
  if (input.isGuest) return "/tester";
  if (input.preference === "testing") return "/tester";
  if (input.preference === "publishing" && input.builderStatus !== "SUSPENDED") return "/builder";
  if (input.builderStatus === "ACTIVE") return "/builder";
  if (input.hasTestingActivity || input.builderStatus === "SUSPENDED") return "/tester";
  return null;
}

export function needsAccountEmail(email: string) {
  return email.toLowerCase().endsWith("@seekerhub.local");
}
