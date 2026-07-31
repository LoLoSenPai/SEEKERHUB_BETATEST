import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";
import { getServerEnv } from "@/src/lib/env";

declare global {
  var prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const adapter = new PrismaNeon({
    connectionString: getServerEnv().DATABASE_URL,
  });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = global.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  global.prisma = prisma;
}
