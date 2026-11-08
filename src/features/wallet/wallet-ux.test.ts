import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ButtonHTMLAttributes } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ContinueWithWallet } from "./continue-with-wallet";
import { WalletSignIn } from "./wallet-sign-in";
import { WalletLinkCard } from "./wallet-link-card";
import { InviteClaimCard } from "@/src/features/invites/invite-claim-card";
import type { WalletAction } from "./use-wallet-action";

const mocks = vi.hoisted(() => ({
  wallet: { connected: true, publicKey: { toBase58: () => "wallet-address" }, wallets: [], wallet: { adapter: { publicKey: { toBase58: () => "wallet-address" } } }, signMessage: vi.fn() as (() => Promise<Uint8Array>) | undefined },
  buttons: [] as ButtonHTMLAttributes<HTMLButtonElement>[],
  connect: vi.fn(),
  anonymous: vi.fn(),
  getSession: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  persistDeviceProfile: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useTransition: () => [false, (callback: () => void) => callback()],
}));
vi.mock("@solana/wallet-adapter-react", () => ({ useWallet: () => mocks.wallet }));
vi.mock("@solana/wallet-adapter-react-ui", () => ({ useWalletModal: () => ({ setVisible: vi.fn() }) }));
vi.mock("./wallet-name", () => ({ WalletName: ({ address }: { address: string }) => createElement("span", null, address) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }));
vi.mock("@/src/features/wallet/wallet-connect-button", () => ({
  WalletConnectButton: (props: { disabled: boolean }) => {
    mocks.connect(props);
    return createElement("button", { disabled: props.disabled }, "Connect wallet");
  },
}));
vi.mock("@/src/components/ui/button", () => ({
  Button: (props: ButtonHTMLAttributes<HTMLButtonElement>) => {
    mocks.buttons.push(props);
    return createElement("button", { disabled: props.disabled }, props.children);
  },
}));
vi.mock("@/src/lib/auth-client", () => ({ authClient: { $store: { notify: mocks.notify }, getSession: mocks.getSession, signIn: { anonymous: mocks.anonymous } } }));
vi.mock("@/src/features/seeker/use-device-context", () => ({ useDeviceContext: () => ({ persistDeviceProfile: mocks.persistDeviceProfile }) }));

function action(overrides: Partial<WalletAction> = {}): WalletAction {
  return { run: vi.fn(), pending: false, refreshing: false, operation: null, error: null, ...overrides };
}

function button(label: string) {
  const found = mocks.buttons.find((props) => props.children === label);
  expect(found).toBeDefined();
  return found!;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.buttons.length = 0;
  mocks.wallet.connected = true;
  mocks.wallet.signMessage = vi.fn();
});

afterEach(() => vi.unstubAllGlobals());

describe("wallet UI", () => {
  it("offers combined consent only with explicit SGT context and only on click", () => {
    const controller = action();
    const sgtContext = { releaseId: "release-id" };
    const callback = vi.fn();
    const markup = renderToStaticMarkup(createElement(ContinueWithWallet, { action: controller, sgtContext, onAuthenticated: callback }));
    expect(markup).toContain("One signature authorizes both");
    expect(markup).toContain("does not prove your current device is a Seeker");
    expect(controller.run).not.toHaveBeenCalled();
    button("Continue with wallet + check SGT").onClick?.({} as never);
    expect(controller.run).toHaveBeenCalledExactlyOnceWith("SIGN_IN_AND_VERIFY_SGT", callback, sgtContext);
  });

  it("keeps already linked wallets on the explicit single SGT action even with combined context", () => {
    const markup = renderToStaticMarkup(createElement(WalletLinkCard, { linkedWallets: [{
      id: "w", address: "wallet-address", isPrimary: true, seekerGenesisVerificationExpiresAt: null,
    }], sgtContext: { releaseId: "release" } }));
    expect(markup).not.toContain("Continue with wallet + check SGT");
    expect(button("Verify Seeker Genesis Token").disabled).toBe(false);
    expect(mocks.wallet.signMessage).not.toHaveBeenCalled();
  });

  it("notifies and calls back on partial combined success without an automatic second signature", async () => {
    const sgt = { verified: false, status: "unavailable", code: "SGT_RPC_UNAVAILABLE" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ challengeId: "c", message: "Combined consent" }))
      .mockResolvedValueOnce(Response.json({ success: true, user: { id: "tester" }, sgt }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.wallet.signMessage = vi.fn().mockResolvedValue(new Uint8Array([1]));
    // WalletSignIn owns the real action hook and refreshes the authenticated session.
    renderToStaticMarkup(createElement(WalletSignIn, { sgtContext: { releaseId: "release" }, returnTo: "/tester" }));
    button("Continue with wallet + check SGT").onClick?.({} as never);
    await vi.waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("$sessionSignal");
    expect(mocks.wallet.signMessage).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("requires an explicit sign click after autoConnect, with no passive signing", () => {
    const controller = action();
    renderToStaticMarkup(createElement(ContinueWithWallet, { action: controller }));
    expect(button("Continue with wallet").disabled).toBe(false);
    expect(controller.run).not.toHaveBeenCalled();
    expect(mocks.wallet.signMessage).not.toHaveBeenCalled();
    button("Continue with wallet").onClick?.({} as never);
    expect(controller.run).toHaveBeenCalledWith("SIGN_IN", undefined);
  });

  it("connects before offering a sign action", () => {
    mocks.wallet.connected = false;
    const markup = renderToStaticMarkup(createElement(ContinueWithWallet, { action: action() }));
    expect(markup).toContain("Connect your wallet");
    expect(markup).not.toContain("Use Seeker Connect");
    expect(markup).not.toContain("Choose another wallet");
    expect(mocks.buttons).toHaveLength(0);
  });

  it("disables connection changes and signing until refreshed server props arrive", () => {
    renderToStaticMarkup(createElement(ContinueWithWallet, { action: action({ pending: true, refreshing: true }) }));
    expect(button("Updating access...").disabled).toBe(true);
    expect(mocks.connect).toHaveBeenCalledWith(expect.objectContaining({ disabled: true }));
  });

  it("explains unsupported message signing", () => {
    mocks.wallet.signMessage = undefined;
    const markup = renderToStaticMarkup(createElement(ContinueWithWallet, { action: action() }));
    expect(button("Continue with wallet").disabled).toBe(true);
    expect(markup).toContain("does not support message signing");
  });

  it("retains errors inline while offering retry", () => {
    const markup = renderToStaticMarkup(createElement(ContinueWithWallet, { action: action({ error: "Sign out before using this wallet." }) }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain("Sign out before using this wallet.");
    expect(button("Continue with wallet").disabled).toBe(false);
  });

  it("offers new-wallet creation and recovery with the same action", () => {
    const markup = renderToStaticMarkup(createElement(WalletSignIn));
    expect(markup).toContain("New wallet? Create tester access");
    expect(markup).toContain("Recover your apps and feedback");
    expect(mocks.wallet.signMessage).not.toHaveBeenCalled();
  });

  it("notifies BetterAuth's session store after raw SIGN_IN, before the invite claim and refresh", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ challengeId: "c", message: "message" }))
      .mockResolvedValueOnce(Response.json({ success: true, user: { id: "durable" } }))
      .mockImplementationOnce(() => {
        expect(mocks.notify).toHaveBeenCalledWith("$sessionSignal");
        return Promise.resolve(Response.json({ ok: true, redirectTo: "/tester" }));
      });
    vi.stubGlobal("fetch", fetchMock);
    mocks.wallet.signMessage = vi.fn().mockResolvedValue(new Uint8Array([1]));
    renderToStaticMarkup(createElement(InviteClaimCard, { token: "token", projectName: "Beta", walletRequired: true }));
    button("Continue with wallet").onClick?.({} as never);
    await vi.waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/tester"));
    expect(mocks.notify).toHaveBeenCalledOnce();
    expect(mocks.notify.mock.invocationCallOrder[0]).toBeLessThan(mocks.refresh.mock.invocationCallOrder[0]);
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("does not notify or claim after a cancelled signing request", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ challengeId: "c", message: "message" }));
    vi.stubGlobal("fetch", fetchMock);
    mocks.wallet.signMessage = vi.fn().mockRejectedValue({ error: { code: "cancelled" } });
    renderToStaticMarkup(createElement(InviteClaimCard, { token: "token", projectName: "Beta", walletRequired: true }));
    button("Continue with wallet").onClick?.({} as never);
    await vi.waitFor(() => expect(mocks.wallet.signMessage).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.notify).not.toHaveBeenCalled();
    expect(mocks.anonymous).not.toHaveBeenCalled();
  });

  it("keeps the standard invitation guest path and never creates a guest during render", () => {
    renderToStaticMarkup(createElement(InviteClaimCard, { token: "token", projectName: "Beta" }));
    expect(button("Open beta access as guest").disabled).toBe(false);
    expect(mocks.anonymous).not.toHaveBeenCalled();
    expect(mocks.wallet.signMessage).not.toHaveBeenCalled();
  });

  it("recommends wallet for mixed policies without hiding guest access", () => {
    const markup = renderToStaticMarkup(createElement(InviteClaimCard, { token: "token", projectName: "Beta", walletRecommended: true, seekerRecommended: true }));
    expect(markup).toContain("Some builds require a wallet");
    expect(button("Open beta access as guest").disabled).toBe(false);
    expect(markup).toContain("Some builds also require Seeker Genesis Token verification");
    expect(markup).not.toContain("separate signature after sign-in");
  });

  it("hides guest access only when wallet is required", () => {
    const markup = renderToStaticMarkup(createElement(InviteClaimCard, { token: "token", projectName: "Beta", walletRequired: true }));
    expect(markup).not.toContain("Open beta access as guest");
    expect(markup).toContain("Wallet access is required");
  });

  it("offers the durable tester direct access without another signature, even for wallet/SGT-required invites", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ ok: true, redirectTo: "/tester/releases/release-1" }));
    vi.stubGlobal("fetch", fetchMock);
    const markup = renderToStaticMarkup(createElement(InviteClaimCard, {
      token: "token", projectName: "Beta", walletRequired: true, seekerRequired: true, currentIdentity: "Wallet wall...ress",
    }));
    expect(markup).toContain("Signed in as");
    expect(markup).toContain("Wallet wall...ress");
    expect(markup).not.toContain("Open beta access as guest");
    expect(button("Open beta access").disabled).toBe(false);
    await button("Open beta access").onClick?.({} as never);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith("/api/invites/token/claim", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
    expect(mocks.push).toHaveBeenCalledWith("/tester/releases/release-1");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.anonymous).not.toHaveBeenCalled();
    expect(mocks.wallet.signMessage).not.toHaveBeenCalled();
  });

  it("refreshes expired durable access without silently creating a guest or navigating", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Unauthorized", { status: 401 })));
    renderToStaticMarkup(createElement(InviteClaimCard, { token: "token", projectName: "Beta", currentIdentity: "tester@example.test" }));
    await button("Open beta access").onClick?.({} as never);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.getSession).not.toHaveBeenCalled();
    expect(mocks.anonymous).not.toHaveBeenCalled();
    expect(mocks.wallet.signMessage).not.toHaveBeenCalled();
  });

  it("requires wallet authentication before SGT verification", () => {
    renderToStaticMarkup(createElement(WalletLinkCard, { linkedWallets: [], requiredSeeker: true }));
    expect(button("Verify Seeker Genesis Token").disabled).toBe(true);
    expect(button("Continue with wallet").disabled).toBe(false);
  });

  it("preserves current 24h SGT verification without claiming hardware trust", () => {
    const markup = renderToStaticMarkup(createElement(WalletLinkCard, { linkedWallets: [{
      id: "w", address: "wallet-address", isPrimary: true, seekerGenesisVerificationExpiresAt: new Date(Date.now() + 60_000),
    }] }));
    expect(button("SGT already verified (24h)").disabled).toBe(true);
    expect(markup).not.toContain("Continue with wallet");
    expect(markup).toContain("does not prove device hardware trust");
  });

  it("allows an expired SGT verification to be renewed", () => {
    renderToStaticMarkup(createElement(WalletLinkCard, { linkedWallets: [{
      id: "w", address: "wallet-address", isPrimary: true, seekerGenesisVerificationExpiresAt: new Date(0),
    }] }));
    expect(button("Verify Seeker Genesis Token").disabled).toBe(false);
    expect(mocks.buttons.some((props) => props.children === "Continue with wallet")).toBe(false);
  });

  it("still requires authentication when the connected wallet differs from the account wallet", () => {
    renderToStaticMarkup(createElement(WalletLinkCard, { linkedWallets: [{
      id: "w", address: "different-address", isPrimary: true, seekerGenesisVerificationExpiresAt: null,
    }], requiredSeeker: true }));
    expect(button("Continue with wallet").disabled).toBe(false);
    expect(button("Verify Seeker Genesis Token").disabled).toBe(true);
  });
});
