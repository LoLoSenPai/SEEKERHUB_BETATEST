import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { AppError, apiError } from "@/src/lib/errors";
import { consumeRateLimit } from "@/src/lib/rate-limit";
import { requireBuilderApiSession } from "@/src/lib/session";

export function assertMediaOrigin(request: Request) {
  const origin = new URL(getServerEnv().BETTER_AUTH_URL).origin;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new AppError("Request origin is not allowed.", 403, "ORIGIN_NOT_ALLOWED");
  }
}

export async function authorizeMediaOwner(request: Request, projectId: string, mutation = true) {
  if (mutation) assertMediaOrigin(request);
  const session = await requireBuilderApiSession(request);
  await consumeRateLimit({ request, userId: session.user.id, action: mutation ? "project-media.write" : "project-media.read", limit: mutation ? 30 : 120, windowMs: 10 * 60_000 });
  const project = await prisma.appProject.findFirst({ where: { id: projectId, ownerId: session.user.id, deletedAt: null }, select: { id: true } });
  if (!project) throw new AppError("Project not found.", 404, "PROJECT_NOT_FOUND");
  return session.user.id;
}

export function mediaJson(data: unknown) {
  return NextResponse.json(data, { headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
}

export function mediaApiError(error: unknown) {
  const response = apiError(error, "Unable to update project media.");
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
