export function latestApps<T extends { projectId: string }>(releases: T[]): T[] {
  const seen = new Set<string>();
  return releases.filter((release) => {
    if (seen.has(release.projectId)) return false;
    seen.add(release.projectId);
    return true;
  });
}
