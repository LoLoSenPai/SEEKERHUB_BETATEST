import { randomBytes, randomUUID } from "node:crypto";
import bs58 from "bs58";
import { getAddressEncoder, getProgramDerivedAddress } from "@solana/kit";
import { ANS_PROGRAM_ADDRESS, getSkrNameAddress, SKR_PARENT, TLD_HOUSE_PROGRAM_ADDRESS } from "@solana-mobile/skr-domain";
import { vi } from "vitest";

export function randomWalletAddress() { return bs58.encode(randomBytes(32)); }

export async function skrRpcFixture(endpoint = "http://127.0.0.1:8899") {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)) {
    throw new Error("SKR tests require the loopback RPC from scripts/with-review-env.mjs.");
  }
  const encoder = getAddressEncoder();
  const records = new Map<string, { data: [string, "base64"]; owner: string; executable: boolean; lamports: number; rentEpoch: number; space: number }>();
  const requests: { method: string; params: unknown[] }[] = [];
  let mode: "healthy" | "error" | "hang" = "healthy";

  async function addPrimary(wallet: string, options: { label?: string; owner?: string; expired?: boolean; tld?: string } = {}) {
    const label = options.label ?? `qa-${randomUUID()}`;
    const nameAccount = await getSkrNameAddress(label);
    const [mainAccount] = await getProgramDerivedAddress({ programAddress: TLD_HOUSE_PROGRAM_ADDRESS,
      seeds: ["main_domain", encoder.encode(wallet as Parameters<typeof encoder.encode>[0])] });
    const tld = Buffer.from(options.tld ?? ".skr");
    const name = Buffer.from(label);
    const main = Buffer.alloc(40 + 4 + tld.length + 4 + name.length);
    main.set([109, 239, 227, 199, 98, 226, 66, 175]);
    main.set(encoder.encode(nameAccount), 8);
    main.writeUInt32LE(tld.length, 40);
    main.set(tld, 44);
    main.writeUInt32LE(name.length, 44 + tld.length);
    main.set(name, 48 + tld.length);
    const record = Buffer.alloc(200);
    record.set(encoder.encode(SKR_PARENT), 8);
    record.set(bs58.decode(options.owner ?? wallet), 40);
    record.writeBigUInt64LE(BigInt(Math.floor(Date.now() / 1_000) + (options.expired ? -60 : 86_400)), 104);
    const account = (bytes: Buffer, owner: string) => ({ data: [bytes.toString("base64"), "base64"] as [string, "base64"],
      owner, executable: false, lamports: 1_000_000, rentEpoch: 0, space: bytes.length });
    records.set(mainAccount, account(main, TLD_HOUSE_PROGRAM_ADDRESS));
    records.set(nameAccount, account(record, ANS_PROGRAM_ADDRESS));
    return `${label}.skr`;
  }

  // This is the only mocked boundary: the official SDK, HTTP transport and codecs all run.
  const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== endpoint) throw new Error("Unexpected network request in SKR tests.");
    const payload = JSON.parse(String(init?.body)) as { id: string; method: string; params: unknown[] };
    requests.push(payload);
    if (payload.method !== "getAccountInfo") throw new Error("Only two bounded account reads are allowed; never list arbitrary names.");
    if (mode === "hang") return new Promise<Response>((_, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (init?.signal?.aborted) abort();
      else init?.signal?.addEventListener("abort", abort, { once: true });
    });
    return Response.json({ jsonrpc: "2.0", id: payload.id, ...(mode === "error"
      ? { error: { code: -32000, message: "private-rpc.example/?api-key=DO-NOT-LEAK" } }
      : { result: { context: { slot: 1 }, value: records.get(String(payload.params[0])) ?? null } }) });
  });
  return { endpoint, addPrimary, requests, fetch, setMode: (value: typeof mode) => { mode = value; } };
}
