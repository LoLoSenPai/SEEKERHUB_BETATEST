import { NextResponse } from "next/server";
import { getServerEnv } from "@/src/lib/env";
import { apiError, AppError } from "@/src/lib/errors";
import { runStorageCleanup } from "@/src/lib/storage/cleanup";

export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const secret = getServerEnv().CRON_SECRET;
    if (!secret)
      throw new AppError(
        "Cleanup cron is not configured.",
        503,
        "CRON_NOT_CONFIGURED",
      );
    if (request.headers.get("authorization") !== "Bearer " + secret) {
      throw new AppError("Unauthorized.", 401, "UNAUTHORIZED");
    }
    return NextResponse.json(await runStorageCleanup());
  } catch (error) {
    return apiError(error, "Cleanup failed.");
  }
}
