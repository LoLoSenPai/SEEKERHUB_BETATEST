import { Prisma } from "@prisma/client";

type AdapterError = {
  name?: unknown;
  code?: unknown;
  cause?: {
    kind?: unknown;
    originalCode?: unknown;
  };
};

export function isTransactionConflict(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034" ||
      (error.code === "P2010" && (
        ["40001", "40P01"].includes(String(error.meta?.code)) ||
        isTransactionConflict(error.meta?.driverAdapterError)
      ));
  }

  if (!error || typeof error !== "object") return false;
  const adapterError = error as AdapterError;

  return (
    adapterError.code === "P2034" ||
    (adapterError.name === "DriverAdapterError" &&
      (adapterError.cause?.kind === "TransactionWriteConflict" ||
        ["40001", "40P01"].includes(String(adapterError.cause?.originalCode))))
  );
}

export function isUniqueConstraintError(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2002";
  }

  if (!error || typeof error !== "object") return false;
  const adapterError = error as AdapterError;

  return (
    adapterError.code === "P2002" ||
    (adapterError.name === "DriverAdapterError" &&
      (adapterError.cause?.kind === "UniqueConstraintViolation" || adapterError.cause?.originalCode === "23505"))
  );
}
