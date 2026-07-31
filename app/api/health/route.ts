import { NextResponse } from "next/server";
import { prisma } from "@/src/lib/db";
import { getServerEnv } from "@/src/lib/env";
import { checkStorageConnection } from "@/src/lib/storage/s3";

export const dynamic = "force-dynamic";

export async function GET() {
  const env = getServerEnv();
  const services = {
    database: false,
    storage: false,
    email: Boolean(env.RESEND_API_KEY && env.EMAIL_FROM),
    cron: Boolean(env.CRON_SECRET),
    inviteEncryption: Boolean(env.INVITE_ENCRYPTION_KEY),
  };
  await Promise.all([
    prisma.$queryRaw`SELECT 1`.then(() => { services.database = true; }).catch(() => undefined),
    checkStorageConnection().then(() => { services.storage = true; }).catch(() => undefined),
  ]);
  const ready =
    services.database &&
    services.storage &&
    (process.env.NODE_ENV !== "production" || (services.email && services.cron && services.inviteEncryption));
  return NextResponse.json({ status: ready ? "ready" : "degraded", services, timestamp: new Date().toISOString() }, { status: ready ? 200 : 503 });
}
