import { describe, expect, it } from "vitest";
import { getInviteWalletRequirements } from "./invite-wallet-requirements";

const standard = { requireLinkedWallet: false, requireVerifiedSeeker: false, _count: { walletEntries: 0 } };
const wallet = { ...standard, requireLinkedWallet: true };
const seeker = { ...standard, requireVerifiedSeeker: true };
const allowlisted = { ...standard, _count: { walletEntries: 1 } };

describe("invitation wallet requirements", () => {
  it("permits guests when no published policies apply", () => {
    expect(getInviteWalletRequirements([])).toEqual({ walletRecommended: false, walletRequired: false, seekerRecommended: false, seekerRequired: false });
  });
  it("permits guests for standard and missing policies", () => {
    expect(getInviteWalletRequirements([standard, null, undefined]).walletRequired).toBe(false);
  });
  it.each([wallet, seeker, allowlisted])("requires wallet for a scoped wallet/SGT/allowlist policy: %j", (policy) => {
    expect(getInviteWalletRequirements([policy])).toMatchObject({ walletRequired: true, walletRecommended: true });
  });
  it("does not turn mixed app-wide policies into a mandatory wallet gate", () => {
    expect(getInviteWalletRequirements([wallet, seeker, standard])).toMatchObject({ walletRecommended: true, walletRequired: false, seekerRecommended: true, seekerRequired: false });
  });
  it("does not force a wallet when one applicable release has no policy", () => {
    expect(getInviteWalletRequirements([wallet, null]).walletRequired).toBe(false);
  });
  it("requires wallet if every release requires wallet by any supported rule", () => {
    expect(getInviteWalletRequirements([wallet, seeker, allowlisted])).toMatchObject({ walletRequired: true, seekerRequired: false });
  });
  it("requires SGT only when every applicable release requires it", () => {
    expect(getInviteWalletRequirements([seeker, seeker])).toMatchObject({ walletRequired: true, seekerRequired: true });
  });
});
