import { afterEach, describe, expect, it, vi } from "vitest";
import bs58 from "bs58";
import { requestWalletAction } from "./wallet-request";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ challengeId: "challenge-1", message: "Sign this challenge" }))
    .mockResolvedValueOnce(Response.json({ success: true, user: { id: "tester-1" } }));
  vi.stubGlobal("fetch", fetchMock);
  const signMessage = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]));
  const signer = { address: "wallet-1", getAddress: () => "wallet-1", signMessage, purpose: "SIGN_IN" as const };
  return { fetchMock, signer, signMessage };
}

describe("unified wallet requests", () => {
  it("uses one explicit signature for combined sign-in with validated invitation context", async () => {
    const { fetchMock, signer, signMessage } = setup();
    const sgtContext = { inviteToken: "invite-token" };
    await requestWalletAction({ ...signer, purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext });
    expect(fetchMock.mock.calls[1][0]).toBe("/api/auth/sign-in/solana-wallet");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).purpose).toBe("SIGN_IN_AND_VERIFY_SGT");
    expect(signMessage).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each(["unavailable", "not_found", "conflict", "rate_limited"])("preserves authentication on SGT %s without another prompt", async (status) => {
    const { fetchMock, signer, signMessage } = setup();
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "c", message: "Sign in and check SGT" }))
      .mockResolvedValueOnce(Response.json({ success: true, sgt: { verified: false, status } }));
    await expect(requestWalletAction({ ...signer, purpose: "SIGN_IN_AND_VERIFY_SGT", sgtContext: { releaseId: "release" } }))
      .resolves.toMatchObject({ success: true, sgt: { verified: false, status } });
    expect(signMessage).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not ask for combined proof without policy context", async () => {
    const { fetchMock, signer, signMessage } = setup();
    await expect(requestWalletAction({ ...signer, purpose: "SIGN_IN_AND_VERIFY_SGT" })).rejects.toThrow("requiring an SGT check");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("uses SIGN_IN and cookie credentials for both new and returning wallets, never LINK", async () => {
    const { fetchMock, signer, signMessage } = setup();
    await requestWalletAction(signer);
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/wallet/challenge", expect.objectContaining({
      credentials: "same-origin", body: JSON.stringify({ address: "wallet-1", purpose: "SIGN_IN" }),
    }));
    expect(signMessage).toHaveBeenCalledWith(new TextEncoder().encode("Sign this challenge"));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/auth/sign-in/solana-wallet", expect.objectContaining({
      credentials: "same-origin", body: JSON.stringify({ challengeId: "challenge-1", address: "wallet-1", signature: bs58.encode(new Uint8Array([1, 2, 3])) }),
    }));
  });

  it("waits for authentication to finish before callers can claim an invitation", async () => {
    const { fetchMock, signer } = setup();
    let complete!: (response: Response) => void;
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "id", message: "message" }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { complete = resolve; }));
    const claim = vi.fn();
    const action = requestWalletAction(signer).then(claim);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(claim).not.toHaveBeenCalled();
    complete(Response.json({ success: true, user: { id: "recovered" } }));
    await action;
    expect(claim).toHaveBeenCalledOnce();
  });

  it("keeps SGT verification separate from sign-in", async () => {
    const { fetchMock, signer } = setup();
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "sgt", message: "SGT message" }))
      .mockResolvedValueOnce(Response.json({ verified: true, expiresAt: "2026-11-01T10:00:00Z" }));
    await requestWalletAction({ ...signer, purpose: "VERIFY_SGT" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).purpose).toBe("VERIFY_SGT");
    expect(fetchMock.mock.calls[1][0]).toBe("/api/wallet/verify-seeker");
  });

  it("explains an account conflict without switching accounts or falling back to a guest", async () => {
    const { fetchMock, signer } = setup();
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "id", message: "message" }))
      .mockResolvedValueOnce(Response.json({ code: "ACCOUNT_SWITCH_REQUIRED", message: "Conflict" }, { status: 409 }));
    await expect(requestWalletAction(signer)).rejects.toMatchObject({ code: "ACCOUNT_SWITCH_REQUIRED", message: expect.stringContaining("Sign out") });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves challenge errors and does not ask for a signature", async () => {
    const { fetchMock, signer, signMessage } = setup();
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ error: "Slow down" }, { status: 429 }));
    await expect(requestWalletAction(signer)).rejects.toThrow("Slow down");
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("does not submit a rejected signature and allows a fresh retry", async () => {
    const { fetchMock, signer, signMessage } = setup();
    signMessage.mockRejectedValueOnce(new Error("Signature declined"));
    await expect(requestWalletAction(signer)).rejects.toThrow("Signature declined");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "retry", message: "New message" }))
      .mockResolvedValueOnce(Response.json({ success: true }));
    await expect(requestWalletAction(signer)).resolves.toMatchObject({ success: true });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).challengeId).toBe("retry");
  });

  it("rejects a wallet changed while the challenge was loading", async () => {
    const { signer, signMessage } = setup();
    let reads = 0;
    await expect(requestWalletAction({ ...signer, getAddress: () => ++reads === 1 ? "wallet-1" : "wallet-2" })).rejects.toThrow("Wallet changed");
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("never submits a signature after the wallet changes or disconnects", async () => {
    const { signer, fetchMock } = setup();
    let current: string | undefined = "wallet-1";
    await expect(requestWalletAction({ ...signer, getAddress: () => current, signMessage: async () => {
      current = undefined;
      return new Uint8Array([1]);
    } })).rejects.toThrow("Wallet changed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed challenges before signing", async () => {
    const { fetchMock, signer, signMessage } = setup();
    fetchMock.mockReset().mockResolvedValueOnce(Response.json({ challengeId: "id" }));
    await expect(requestWalletAction(signer)).rejects.toThrow("Invalid wallet challenge");
    expect(signMessage).not.toHaveBeenCalled();
  });

  it("treats a negative SGT result as a retryable failure, not verification success", async () => {
    const { fetchMock, signer } = setup();
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "sgt", message: "message" }))
      .mockResolvedValueOnce(Response.json({ verified: false }));
    await expect(requestWalletAction({ ...signer, purpose: "VERIFY_SGT" })).rejects.toThrow("No Seeker Genesis Token");
  });

  it("preserves an SGT outage error", async () => {
    const { fetchMock, signer } = setup();
    fetchMock.mockReset()
      .mockResolvedValueOnce(Response.json({ challengeId: "sgt", message: "message" }))
      .mockResolvedValueOnce(Response.json({ error: "Verification temporarily unavailable", code: "SGT_RPC_UNAVAILABLE" }, { status: 503 }));
    await expect(requestWalletAction({ ...signer, purpose: "VERIFY_SGT" })).rejects.toMatchObject({ code: "SGT_RPC_UNAVAILABLE" });
  });
});
