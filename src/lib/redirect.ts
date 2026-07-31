export function safeReturnTo(value: string | null | undefined, fallback: string) {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return fallback;
  return value;
}
