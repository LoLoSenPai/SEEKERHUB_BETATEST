export function getWalletErrorCode(error: unknown): string | undefined {
  let current = error;
  const visited = new Set<unknown>();
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const details = current as { code?: unknown; error?: unknown; cause?: unknown };
    if (typeof details.code === "string") return details.code;
    // Wallet Standard's adapter wraps SDK errors in WalletError.error.
    current = details.error ?? details.cause;
  }
}

export function getWalletErrorMessage(error: unknown, fallback = "Wallet request failed. Please try again."): string | null {
  switch (getWalletErrorCode(error)) {
    case "cancelled": return null;
    case "session-closed": return "The wallet session closed before the request completed. Return here and retry manually when ready. No automatic retry was made.";
    case "association-failed": return "Seeker Connect could not reach your wallet. Open this HTTPS site on your Seeker, check connectivity, then retry or choose another wallet.";
    default: return error instanceof Error ? error.message : fallback;
  }
}
