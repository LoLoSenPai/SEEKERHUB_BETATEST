export function safeReturnTo(value: string | null | undefined, fallback: string) {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return fallback;
  if (/[\\\x00-\x20\x7f]/.test(value)) return fallback;

  // Query values stay encoded until their own navigation boundary validates them.
  const pathname = value.split(/[?#]/, 1)[0];
  if (/%(?:2f|5c|0[0-9a-f]|1[0-9a-f]|7f|25)/i.test(pathname)) return fallback;

  try {
    const base = "https://redirect.invalid";
    const target = new URL(value, base);
    if (target.origin !== base || target.pathname.startsWith("//")) return fallback;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return fallback;
  }
}
