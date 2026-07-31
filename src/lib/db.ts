import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/src/lib/env";

declare global {
  var prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const connectionString = getServerEnv().DATABASE_URL;
  const hostname = new URL(connectionString).hostname;
  const adapter = hostname.endsWith(".neon.tech")
    ? new PrismaNeon({ connectionString })
    : new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = global.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
