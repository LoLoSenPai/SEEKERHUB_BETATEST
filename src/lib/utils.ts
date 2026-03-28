import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: bigint | number) {
  const value = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let unitIndex = -1;
  let normalized = value;

  do {
    normalized /= 1024;
    unitIndex += 1;
  } while (normalized >= 1024 && unitIndex < units.length - 1);

  return `${normalized.toFixed(normalized < 10 ? 1 : 0)} ${units[unitIndex]}`;
}

export function formatRelativeCount(value: number, noun: string) {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

export function toSlug(input: string) {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function compactChecksum(checksum: string) {
  return checksum.length <= 12 ? checksum : `${checksum.slice(0, 8)}...${checksum.slice(-4)}`;
}
