import { describe, expect, it, vi } from "vitest";
import { metadata } from "@/app/layout";
import { BRAND_ICON_PATH, BRAND_NAME } from "./brand";

vi.mock("next/font/google", () => ({
  Manrope: () => ({ variable: "font-manrope" }),
  IBM_Plex_Mono: () => ({ variable: "font-plex-mono" }),
}));
vi.mock("@/app/providers", () => ({ Providers: () => null }));

describe("root brand metadata", () => {
  it("keeps the application identity and description", () => {
    expect(metadata.title).toBe(BRAND_NAME);
    expect(metadata.applicationName).toBe(BRAND_NAME);
    expect(metadata.description).toBe("Private Android beta distribution for Solana Seeker and Android builders.");
  });

  it("declares the packaged PNG and Apple icons with explicit sizes", () => {
    expect(metadata.icons).toEqual({
      icon: [
        { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
        { url: BRAND_ICON_PATH, sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    });
  });
});
