import { describe, expect, it } from "vitest";
import { detectDeviceContextFromUserAgent } from "@/src/lib/device/detect";

describe("detectDeviceContextFromUserAgent", () => {
  it("marks Android Chrome as Solana Mobile capable", () => {
    const result = detectDeviceContextFromUserAgent({
      userAgent:
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Mobile Safari/537.36",
      platformLabel: "Android",
    });

    expect(result.isSolanaMobileCapable).toBe(true);
    expect(result.deviceClass).toBe("MOBILE");
  });

  it("keeps desktop device detection advisory", () => {
    const result = detectDeviceContextFromUserAgent({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
    });

    expect(result.isSeeker).toBe(false);
    expect(result.recognitionSource).toBe("NONE");
  });
});
