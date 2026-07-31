import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { logger } from "@/src/lib/logger";

export class AppError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code = "BAD_REQUEST",
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function apiError(error: unknown, fallback = "Unable to complete this request.") {
  if (error instanceof AppError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }

  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Some submitted fields are invalid.", code: "VALIDATION_ERROR", issues: error.issues },
      { status: 400 },
    );
  }

  logger.error("api.unhandled_error", { error });
  return NextResponse.json({ error: fallback, code: "INTERNAL_ERROR" }, { status: 500 });
}
