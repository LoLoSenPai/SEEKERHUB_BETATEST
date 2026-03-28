import { describe, expect, it } from "vitest";
import { buildInviteShareUrl, createInviteToken, decryptInviteToken, encryptInviteToken, hashInviteToken } from "@/src/lib/invite";

describe("invite helpers", () => {
  it("encrypts and decrypts invite tokens", () => {
    const token = createInviteToken();
    const encrypted = encryptInviteToken(token);

    expect(encrypted).not.toBe(token);
    expect(decryptInviteToken(encrypted)).toBe(token);
  });

  it("builds a share URL without duplicating slashes", () => {
    const token = "invite-token";

    expect(buildInviteShareUrl(token, "http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000/invite/invite-token");
  });

  it("hashes tokens deterministically", () => {
    expect(hashInviteToken("abc")).toBe(hashInviteToken("abc"));
    expect(hashInviteToken("abc")).not.toBe(hashInviteToken("abcd"));
  });
});
