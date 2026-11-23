import { TOKEN_2022_PROGRAM_ADDRESS } from "@solana-program/token-2022";
import { Connection, PublicKey, type AccountInfo } from "@solana/web3.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeekerVerificationUnavailableError, verifySeekerGenesisOwnership } from "./sgt";

vi.mock("@/src/lib/env", () => ({ getServerEnv: () => ({ SOLANA_RPC_URL: "http://localhost:8899" }) }));
vi.mock("@/src/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));

// Mainnet captures from solana-mobile/skr-js, packages/skr-genesis-token/test/fixtures.
const SGT_MINT = "5mXbkqKz883aufhAsx3p5Z1NcvD2ppZbdTTznM6oUKLj";
const SGT_DATA = Buffer.from(
  "AQAAAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9AQAAAAAAAAAAAQEAAADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojR" +
  "oIG0IUwpvQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAARIAQADliqoXQL8nYdi6Lh6tJSsI62jSZGtIZojRoIG0IUwpveWJkm0XmBofiHcH5IkGhI6YGUP+gVGT" +
  "mnUrqnPiEJ7pDAAgAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9AwAgAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGg" +
  "gbQhTCm9FgBAAOWKqhdAvydh2LouHq0lKwjraNJka0hmiNGggbQhTCm9Rtbm56e2Wpp6IcN4mzsGGaAfQo0zuMd+o6vhmFUcUrgX" +
  "AEgARtbm56e2Wpp6IcN4mzsGGaAfQo0zuMd+o6vhmFUcUrjliZJtF5gaH4h3B+SJBoSOmBlD/oFRk5p1K6pz4hCe6RQAAAAAAAAA",
  "base64",
);
const PYUSD_MINT = "2b1kV6DkPAnxd5ixfnxCpjxmKwqjjaYmCZfHsFu24GXo";
const PYUSD_DATA = Buffer.from(
  "AQAAAJPkMU4Y+uEbsZMeeiiX9ljfNXCarVZ7fbwaCVSmePpU0jWzly5+AgAGAQEAAAAXhTJh72q4Uypn8FOGWq0xKT/PB88SCrW5" +
  "oVcGVI3AKwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAQMAIAAXhTJh72q4Uypn8FOGWq0xKT/PB88SCrW5oVcGVI3AKwwAIAAXhTJh72q4Uypn8FOGWq0xKT/P" +
  "B88SCrW5oVcGVI3AKwEAbAAXhTJh72q4Uypn8FOGWq0xKT/PB88SCrW5oVcGVI3AKxeFMmHvarhTKmfwU4ZarTEpP88HzxIKtbmh" +
  "VwZUjcArAAAAAAAAAABdAgAAAAAAAAAAAAAAAAAAAABdAgAAAAAAAAAAAAAAAAAAAAAEAEEAF4UyYe9quFMqZ/BThlqtMSk/zwfP" +
  "Egq1uaFXBlSNwCsAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAIEAF4UyYe9quFMqZ/BThlqtMSk/zwfPEgq1uaFX" +
  "BlSNwCscN+ZDO3ME3YJzeuQNm4vzxJ9bDmxJqNUzKLPlBpAcVwEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgBAABeFMmHvarhTKmfwU4ZarTEpP88HzxIKtbmhVwZUjcArAAAAAAAAAAAAAAAA" +
  "AAAAAAAAAAAAAAAAAAAAAAAAAAASAEAAF4UyYe9quFMqZ/BThlqtMSk/zwfPEgq1uaFXBlSNwCsXkkg7bIoqh7dHHYFPlZH5OVyE" +
  "Cpzj2fTVun06S4p0nhMArgAXhTJh72q4Uypn8FOGWq0xKT/PB88SCrW5oVcGVI3AKxeSSDtsiiqHt0cdgU+Vkfk5XIQKnOPZ9NW6" +
  "fTpLinSeCgAAAFBheVBhbCBVU0QFAAAAUFlVU0RPAAAAaHR0cHM6Ly90b2tlbi1tZXRhZGF0YS5wYXhvcy5jb20vcHl1c2RfbWV0" +
  "YWRhdGEvcHJvZC9zb2xhbmEvcHl1c2RfbWV0YWRhdGEuanNvbgAAAAA=",
  "base64",
);

const TOKEN_2022 = new PublicKey(TOKEN_2022_PROGRAM_ADDRESS);
const WALLET = new PublicKey(Buffer.alloc(32, 7));
const NOT_VERIFIED = { verified: false, mintAddress: null };
const VERIFIED = { verified: true, mintAddress: SGT_MINT };

function mintAccount(data: Buffer, owner = TOKEN_2022): AccountInfo<Buffer> {
  return { data, owner, executable: false, lamports: 1 };
}

function holding(mint: string, amount = "1") {
  return {
    pubkey: new PublicKey(Buffer.alloc(32, 8)),
    account: {
      owner: TOKEN_2022, executable: false, lamports: 1,
      data: { program: "spl-token-2022", parsed: { type: "account", info: { mint, owner: WALLET.toBase58(), tokenAmount: { amount } } }, space: 165 },
    },
  };
}

function checkWallet() {
  return verifySeekerGenesisOwnership(WALLET.toBase58());
}

function changeByte(offset: number, value: number) {
  const data = Buffer.from(SGT_DATA);
  data[offset] = value;
  return data;
}

function absentAddress(offset: number) {
  return Buffer.from(SGT_DATA).fill(0, offset, offset + 32);
}

beforeEach(() => {
  vi.spyOn(Connection.prototype, "getParsedTokenAccountsByOwner")
    .mockResolvedValue({ context: { slot: 1 }, value: [holding(SGT_MINT)] });
  vi.spyOn(Connection.prototype, "getMultipleAccountsInfo").mockResolvedValue([mintAccount(SGT_DATA)]);
});

afterEach(() => vi.restoreAllMocks());

describe("legacy parity", () => {
  it("recognizes the public mainnet SGT capture with other extensions", async () => {
    await expect(checkWallet()).resolves.toEqual(VERIFIED);
    expect(Connection.prototype.getParsedTokenAccountsByOwner).toHaveBeenCalledWith(WALLET, { programId: TOKEN_2022 });
  });

  it("skips a non-SGT Token-2022 mint and keeps the first verified positive holding", async () => {
    vi.mocked(Connection.prototype.getParsedTokenAccountsByOwner).mockResolvedValue({
      context: { slot: 1 }, value: [holding(WALLET.toBase58(), "0"), holding(PYUSD_MINT), holding(SGT_MINT), holding(SGT_MINT)],
    });
    vi.mocked(Connection.prototype.getMultipleAccountsInfo).mockResolvedValue([mintAccount(PYUSD_DATA), mintAccount(SGT_DATA)]);
    await expect(checkWallet()).resolves.toEqual(VERIFIED);
    expect(Connection.prototype.getMultipleAccountsInfo).toHaveBeenCalledExactlyOnceWith([new PublicKey(PYUSD_MINT), new PublicKey(SGT_MINT)]);
  });

  it("rejects the public mainnet PYUSD capture", async () => {
    vi.mocked(Connection.prototype.getParsedTokenAccountsByOwner).mockResolvedValue({ context: { slot: 1 }, value: [holding(PYUSD_MINT)] });
    vi.mocked(Connection.prototype.getMultipleAccountsInfo).mockResolvedValue([mintAccount(PYUSD_DATA)]);
    await expect(checkWallet()).resolves.toEqual(NOT_VERIFIED);
  });

  it.each([
    ["wrong program owner", mintAccount(SGT_DATA, PublicKey.default)],
    ["wrong account type", mintAccount(changeByte(165, 2))],
    ["no mint authority", mintAccount(changeByte(0, 0))],
    ["no metadata authority", mintAccount(absentAddress(170))],
    ["wrong metadata address", mintAccount(absentAddress(202))],
    ["wrong group address", mintAccount(absentAddress(410))],
    ["missing group member extension", mintAccount(SGT_DATA.subarray(0, 374))],
    ["no extensions", mintAccount(SGT_DATA.subarray(0, 82))],
    ["missing account", null],
  ] as const)("rejects %s", async (_name, account) => {
    vi.mocked(Connection.prototype.getMultipleAccountsInfo).mockResolvedValue([account]);
    await expect(checkWallet()).resolves.toEqual(NOT_VERIFIED);
  });

  it.each(["getParsedTokenAccountsByOwner", "getMultipleAccountsInfo"] as const)("preserves unavailable on %s failure", async (method) => {
    vi.mocked(Connection.prototype[method]).mockRejectedValue(new Error("RPC unavailable"));
    await expect(checkWallet()).rejects.toBeInstanceOf(SeekerVerificationUnavailableError);
  });
});

describe("strict Token-2022 layout", () => {
  it.each([
    ["uninitialized mint", () => changeByte(45, 0)],
    ["invalid initialized flag", () => changeByte(45, 2)],
    ["invalid authority option", () => changeByte(0, 2)],
    ["wrong member mint", () => absentAddress(378)],
    ["nonzero base padding", () => changeByte(82, 1)],
    ["wrong extension length", () => changeByte(168, 63)],
    ["truncated extension", () => SGT_DATA.subarray(0, -1)],
    ["partial TLV header", () => Buffer.concat([SGT_DATA, Buffer.from([32, 0, 1])])],
    ["duplicate TLV type", () => Buffer.concat([SGT_DATA, SGT_DATA.subarray(166, 234)])],
  ] as const)("rejects %s", async (_name, bytes) => {
    vi.mocked(Connection.prototype.getMultipleAccountsInfo).mockResolvedValue([mintAccount(bytes())]);
    await expect(checkWallet()).resolves.toEqual(NOT_VERIFIED);
  });

  it("accepts zero padding and an unrelated, well-framed future extension", async () => {
    const data = Buffer.concat([SGT_DATA, Buffer.from([255, 255, 1, 0, 1, 0, 0, 0, 0])]);
    vi.mocked(Connection.prototype.getMultipleAccountsInfo).mockResolvedValue([mintAccount(data)]);
    await expect(checkWallet()).resolves.toEqual(VERIFIED);
  });
});
