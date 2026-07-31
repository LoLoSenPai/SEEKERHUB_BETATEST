import { Prisma } from "@prisma/client";

type AdapterError = {
  name?: unknown;
  code?: unknown;
  cause?: {
    kind?: unknown;
    originalCode?: unknown;
  };
};

export function isTransactionConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return error.code === "P2034";
  }

  if (!error || typeof error !== "object") return false;
  const adapterError = error as AdapterError;

  return (
    adapterError.code === "P2034" ||
    (adapterError.name === "DriverAdapterError" &&
      (adapterError.cause?.kind === "TransactionWriteConflict" || adapterError.cause?.originalCode === "40001"))
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
