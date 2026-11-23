import { createServer } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import { Connection } from "@solana/web3.js";
import { expect, it } from "vitest";

const browser = createRequire(import.meta.url)("@solana/web3.js/lib/index.browser.cjs.js") as typeof import("@solana/web3.js");

it.each([["Node", Connection], ["browser bundle", browser.Connection]] as const)("%s preserves web3.js HTTP request IDs, results and errors", async (_name, Client) => {
  const requests: Array<{ id: string; method: string; params: unknown[]; jsonrpc: string }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    requests.push(body);
    if (requests.length === 3) {
      response.writeHead(503);
      response.end("Temporarily unavailable");
      return;
    }
    const reply = requests.length === 1 ? { result: 42 } : { error: { code: -32005, message: "Node is behind", data: { slots: 8 } } };
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, ...reply }));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const connection = new Client(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, "confirmed");
    await expect(connection.getSlot()).resolves.toBe(42);
    await expect(connection.getSlot()).rejects.toMatchObject({ code: -32005, message: expect.stringContaining("Node is behind"), data: { slots: 8 } });
    await expect(connection.getSlot()).rejects.toThrow(/503.*Temporarily unavailable/);
    expect(requests).toHaveLength(3);
    for (const request of requests) {
      expect(request).toMatchObject({ jsonrpc: "2.0", method: "getSlot", params: [{ commitment: "confirmed" }] });
      expect(request.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
    expect(new Set(requests.map(({ id }) => id)).size).toBe(3);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
