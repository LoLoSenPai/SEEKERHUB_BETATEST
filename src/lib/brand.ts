import type { Metadata } from "next";

export const BRAND_NAME = "SeekerHub";
export const BRAND_ICON_PATH = "/brand/seekerhub-icon.png";

export const BRAND_ICONS = {
  icon: [
    { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
    { url: BRAND_ICON_PATH, sizes: "512x512", type: "image/png" },
  ],
  apple: [{ url: "/brand/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
} satisfies NonNullable<Metadata["icons"]>;

export function getWalletAppIdentity(appOrigin: string) {
  return { name: BRAND_NAME, uri: appOrigin, icon: BRAND_ICON_PATH };
}
