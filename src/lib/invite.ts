import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { getServerEnv } from "@/src/lib/env";

export function createInviteToken() {
  return randomBytes(24).toString("base64url");
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function getInviteEncryptionKey() {
  const env = getServerEnv();
  return createHash("sha256").update(`invite-link-token:${env.BETTER_AUTH_SECRET}`).digest();
}

export function encryptInviteToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getInviteEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptInviteToken(ciphertext: string) {
  const [ivPart, authTagPart, encryptedPart] = ciphertext.split(".");

  if (!ivPart || !authTagPart || !encryptedPart) {
    throw new Error("Invalid invite token ciphertext.");
  }

  const decipher = createDecipheriv("aes-256-gcm", getInviteEncryptionKey(), Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagPart, "base64url"));

  return Buffer.concat([decipher.update(Buffer.from(encryptedPart, "base64url")), decipher.final()]).toString("utf8");
}

export function buildInviteShareUrl(token: string, appUrl: string) {
  return `${appUrl.replace(/\/$/, "")}/invite/${token}`;
}
