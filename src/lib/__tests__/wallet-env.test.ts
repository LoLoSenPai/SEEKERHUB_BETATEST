import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("experimental Seeker Connect opt-in", () => {
  it.each([undefined, "false", "true"])("requires an explicit true flag, not just a relay (%s)", async (flag) => {
    vi.resetModules();
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://review.example.test");
    vi.stubEnv("NEXT_PUBLIC_SOLANA_RPC_URL", "http://127.0.0.1:8899");
    vi.stubEnv("NEXT_PUBLIC_SEEKER_RELAY_DOMAIN", "relay.solanamobile.com");
    vi.stubEnv("NEXT_PUBLIC_ENABLE_SEEKER_CONNECT", flag);
    const { getClientEnv } = await import("@/src/lib/env");
    expect(getClientEnv().NEXT_PUBLIC_ENABLE_SEEKER_CONNECT).toBe(flag === "true");
  });
});
