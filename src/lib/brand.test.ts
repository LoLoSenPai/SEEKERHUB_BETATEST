import { describe, expect, it } from "vitest";
import { BRAND_ICON_PATH, BRAND_NAME, getWalletAppIdentity } from "./brand";

describe("wallet brand identity", () => {
  it.each(["https://seekerhub.example", "https://preview.example.test", "http://127.0.0.1:3100"])("uses the actual app origin %s and a relative PNG icon", (origin) => {
    const identity = getWalletAppIdentity(origin);
    expect(identity).toEqual({ name: "SeekerHub", uri: origin, icon: "/brand/seekerhub-icon.png" });
    expect(new URL(identity.icon, identity.uri).href).toBe(`${origin}/brand/seekerhub-icon.png`);
    expect(identity.name).toBe(BRAND_NAME);
    expect(identity.icon).toBe(BRAND_ICON_PATH);
    expect(identity.icon).not.toMatch(/^(?:https?:|data:)/);
  });
});
