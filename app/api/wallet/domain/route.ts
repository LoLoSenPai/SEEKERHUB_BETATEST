import { NextResponse } from "next/server";
import { auth } from "@/src/lib/auth";
import { getServerEnv } from "@/src/lib/env";
import { apiError, AppError } from "@/src/lib/errors";
import { consumeRateLimit } from "@/src/lib/rate-limit";
import { resolveLinkedWalletDomain, validateWalletDomainAddress } from "@/src/lib/solana/wallet-domain";

export const runtime = "nodejs";
const MAX_BODY_BYTES = 512;

async function readAddress(request: Request) {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
    throw new AppError("Use a JSON request body.", 415, "JSON_REQUIRED");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > MAX_BODY_BYTES)) {
    throw new AppError("Wallet name request is too large.", 413, "BODY_TOO_LARGE");
  }
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("A wallet address is required.", 400, "INVALID_WALLET_ADDRESS");
  let timer: ReturnType<typeof setTimeout>;
  try {
    const body = (async () => {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) throw new AppError("Wallet name request is too large.", 413, "BODY_TOO_LARGE");
        chunks.push(value);
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).some((key) => key !== "address")) {
          throw new Error("Invalid body");
        }
        return validateWalletDomainAddress((parsed as { address?: unknown }).address);
      } catch {
        throw new AppError("A valid wallet address is required.", 400, "INVALID_WALLET_ADDRESS");
      }
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AppError("Wallet name request timed out.", 408, "REQUEST_TIMEOUT")), 2_000);
    });
    return await Promise.race([body, timeout]);
  } finally {
    clearTimeout(timer!);
    await reader.cancel().catch(() => undefined);
  }
}

export async function POST(request: Request) {
  let response: Response;
  try {
    const allowedOrigin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
    if (request.headers.get("origin") !== allowedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new AppError("Request origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED");
    }
    // Both budgets run before the resolver/cache. The IP budget also covers anonymous probes.
    await consumeRateLimit({ request, action: "wallet.domain.ip", limit: 60, windowMs: 60_000 });
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) throw new AppError("Authentication required.", 401, "AUTH_REQUIRED");
    await consumeRateLimit({ request, action: "wallet.domain.user", userId: session.user.id, limit: 30, windowMs: 60_000 });
    const result = await resolveLinkedWalletDomain({ userId: session.user.id, address: await readAddress(request) });
    response = NextResponse.json(result, { status: result.domain ? 200 : 404 });
  } catch (error) {
    response = apiError(error, "Unable to look up this wallet name.");
  }
  // A CDN/browser cache must never bypass the session-wallet authorization check.
  response.headers.set("cache-control", "private, no-store");
  response.headers.set("vary", "Cookie, Origin");
  if (response.status === 503) response.headers.set("retry-after", "5");
  if (response.status === 429) response.headers.set("retry-after", "60");
  return response;
}
