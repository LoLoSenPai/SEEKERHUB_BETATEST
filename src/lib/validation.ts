import { z } from "zod";
import { PublicKey } from "@solana/web3.js";

const MAX_APK_BYTES = 250 * 1024 * 1024;

function isSolanaAddress(value: string) {
  try {
    return new PublicKey(value).toBase58() === value;
  } catch {
    return false;
  }
}

export const solanaAddressSchema = z.string().trim().refine(isSolanaAddress, "Invalid Solana address.");

function normalizeOptionalDateTimeInput(value: unknown) {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const parsedDate = new Date(trimmed);

  if (Number.isNaN(parsedDate.getTime())) {
    return trimmed;
  }

  return parsedDate.toISOString();
}

export const projectInputSchema = z.object({
  name: z.string().min(2).max(80),
  description: z.string().max(500).optional().or(z.literal("")),
});

export const accessPolicyInputSchema = z.object({
  requireInviteAcceptance: z.boolean().default(true),
  testerGroupId: z.string().optional().nullable(),
  requireLinkedWallet: z.boolean().default(false),
  requireSolanaMobile: z.boolean().default(false),
  requireVerifiedSeeker: z.boolean().default(false),
  allowPreviousReleases: z.boolean().default(false),
  walletAllowlist: z.array(solanaAddressSchema).max(1_000).default([]),
}).transform((policy) => {
  const walletAllowlist = [...new Set(policy.walletAllowlist)];
  return {
    ...policy,
    walletAllowlist,
    requireLinkedWallet: policy.requireLinkedWallet || walletAllowlist.length > 0 || policy.requireVerifiedSeeker,
  };
});

export const releaseDraftInputSchema = z.object({
  projectId: z.string().cuid(),
  versionName: z.string().min(1).max(32),
  versionCode: z.coerce.number().int().positive().max(1_000_000_000),
  changelog: z.string().min(1).max(8_000),
  accessPolicy: accessPolicyInputSchema,
});

export const inviteInputSchema = z.object({
  projectId: z.string().cuid(),
  releaseId: z.string().cuid().optional().nullable(),
  testerGroupId: z.string().cuid().optional().nullable(),
  label: z.string().min(2).max(80),
  maxUses: z.coerce.number().int().positive().max(10_000).optional().nullable(),
  expiresAt: z.preprocess(normalizeOptionalDateTimeInput, z.string().datetime().optional().nullable()),
});

export const feedbackInputSchema = z.object({
  releaseId: z.string().cuid(),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(5_000),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  deviceProfileId: z.string().cuid().optional().nullable(),
  deviceContext: z
    .object({
      isSeeker: z.boolean(),
      isSolanaMobileCapable: z.boolean(),
      hasMobileWalletAdapterContext: z.boolean(),
      recognitionSource: z.enum(["NONE", "USER_AGENT", "WALLET_CONTEXT"]),
      browserName: z.string().optional(),
      browserVersion: z.string().optional(),
      osName: z.string().optional(),
      osVersion: z.string().optional(),
      deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP", "UNKNOWN"]).optional(),
      platformLabel: z.string().optional(),
    })
    .optional(),
});

export const deviceContextInputSchema = z.object({
  browserName: z.string().optional(),
  browserVersion: z.string().optional(),
  osName: z.string().optional(),
  osVersion: z.string().optional(),
  deviceClass: z.enum(["MOBILE", "TABLET", "DESKTOP", "UNKNOWN"]),
  platformLabel: z.string().optional(),
  isSeeker: z.boolean(),
  isSolanaMobileCapable: z.boolean(),
  hasMobileWalletAdapterContext: z.boolean(),
  recognitionSource: z.enum(["NONE", "USER_AGENT", "WALLET_CONTEXT"]),
});

export const createUploadSessionSchema = z.object({
  projectId: z.string().cuid(),
  fileName: z.string().min(1),
  contentType: z.string().min(1),
  fileSize: z.coerce.number().int().positive().max(MAX_APK_BYTES),
  draft: releaseDraftInputSchema,
});

export const finalizeUploadSchema = z.object({
  sessionId: z.string().cuid(),
});

export const claimInviteSchema = z.object({
  token: z.string().min(20),
});

export const walletChallengeSchema = z.object({
  address: solanaAddressSchema,
  purpose: z.enum(["LINK", "VERIFY_SGT", "SIGN_IN"]).default("LINK"),
});

export const walletLinkSchema = z.object({
  challengeId: z.string().cuid(),
  address: solanaAddressSchema,
  signature: z.string().min(40),
});

export const verifySeekerSchema = walletLinkSchema;
