-- CreateEnum
CREATE TYPE "BuilderStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "StorageDeletionStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "AppProject" ADD COLUMN     "androidPackageName" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "purgeAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Release" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "minSdk" INTEGER,
ADD COLUMN     "purgeAfter" TIMESTAMP(3),
ADD COLUMN     "targetSdk" INTEGER;

-- AlterTable
ALTER TABLE "BuildAsset" ADD COLUMN     "hasApkSignature" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "InviteClaim" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "TesterMembership" ADD COLUMN     "revokedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Wallet" ADD COLUMN     "seekerGenesisVerificationExpiresAt" TIMESTAMP(3);

-- Wallet sign-in challenges can be issued before an authenticated session exists.
ALTER TABLE "WalletChallenge" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "WalletChallenge" ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'LINK';

-- AlterTable
ALTER TABLE "ReleaseUploadSession" ADD COLUMN     "reservationReleasedAt" TIMESTAMP(3),
ADD COLUMN     "finalizingAt" TIMESTAMP(3),
ADD COLUMN     "reservedBytes" BIGINT NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuilderProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "BuilderStatus" NOT NULL DEFAULT 'ACTIVE',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "maxProjects" INTEGER NOT NULL DEFAULT 1,
    "maxStoredReleases" INTEGER NOT NULL DEFAULT 5,
    "maxApkBytes" BIGINT NOT NULL DEFAULT 262144000,
    "maxStorageBytes" BIGINT NOT NULL DEFAULT 524288000,
    "usedStorageBytes" BIGINT NOT NULL DEFAULT 0,
    "reservedStorageBytes" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BuilderProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimitBucket" (
    "id" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "windowStartedAt" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RateLimitBucket_pkey" PRIMARY KEY ("id")
);

-- Project-level tester access makes revocation persistent across invite links.
CREATE TABLE "TesterAccess" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TesterAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StorageDeletionTask" (
    "id" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "status" "StorageDeletionStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StorageDeletionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "metadataJson" JSONB,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "BuilderProfile_userId_key" ON "BuilderProfile"("userId");

-- CreateIndex
CREATE INDEX "BuilderProfile_status_idx" ON "BuilderProfile"("status");

-- CreateIndex
CREATE INDEX "BuilderProfile_isAdmin_idx" ON "BuilderProfile"("isAdmin");

-- CreateIndex
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimitBucket_keyHash_action_windowStartedAt_key" ON "RateLimitBucket"("keyHash", "action", "windowStartedAt");

CREATE UNIQUE INDEX "TesterAccess_projectId_userId_key" ON "TesterAccess"("projectId", "userId");

CREATE INDEX "TesterAccess_userId_idx" ON "TesterAccess"("userId");

CREATE INDEX "TesterAccess_projectId_revokedAt_idx" ON "TesterAccess"("projectId", "revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StorageDeletionTask_storageKey_key" ON "StorageDeletionTask"("storageKey");

-- CreateIndex
CREATE INDEX "StorageDeletionTask_status_scheduledFor_idx" ON "StorageDeletionTask"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_createdAt_idx" ON "AuditLog"("targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "User_isAnonymous_idx" ON "User"("isAnonymous");

-- CreateIndex
CREATE INDEX "User_emailVerified_idx" ON "User"("emailVerified");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_expiresAt_idx" ON "Verification"("expiresAt");

-- CreateIndex
CREATE INDEX "AppProject_ownerId_idx" ON "AppProject"("ownerId");

-- CreateIndex
CREATE INDEX "AppProject_deletedAt_purgeAfter_idx" ON "AppProject"("deletedAt", "purgeAfter");

-- CreateIndex
CREATE INDEX "Release_projectId_status_idx" ON "Release"("projectId", "status");

-- CreateIndex
CREATE INDEX "Release_deletedAt_purgeAfter_idx" ON "Release"("deletedAt", "purgeAfter");

-- CreateIndex
CREATE INDEX "BuildAsset_uploadedAt_idx" ON "BuildAsset"("uploadedAt");

-- CreateIndex
CREATE INDEX "InviteLink_projectId_idx" ON "InviteLink"("projectId");

-- CreateIndex
CREATE INDEX "InviteLink_releaseId_idx" ON "InviteLink"("releaseId");

-- CreateIndex
CREATE INDEX "InviteLink_testerGroupId_idx" ON "InviteLink"("testerGroupId");

-- CreateIndex
CREATE INDEX "InviteLink_createdById_idx" ON "InviteLink"("createdById");

-- CreateIndex
CREATE INDEX "InviteLink_revokedAt_expiresAt_idx" ON "InviteLink"("revokedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "InviteClaim_userId_idx" ON "InviteClaim"("userId");

-- CreateIndex
CREATE INDEX "InviteClaim_grantedAt_revokedAt_idx" ON "InviteClaim"("grantedAt", "revokedAt");

-- CreateIndex
CREATE INDEX "TesterGroup_projectId_idx" ON "TesterGroup"("projectId");

-- CreateIndex
CREATE INDEX "TesterMembership_projectId_userId_revokedAt_idx" ON "TesterMembership"("projectId", "userId", "revokedAt");

-- CreateIndex
CREATE INDEX "TesterMembership_testerGroupId_idx" ON "TesterMembership"("testerGroupId");

-- CreateIndex
CREATE INDEX "TesterMembership_inviteLinkId_idx" ON "TesterMembership"("inviteLinkId");

-- CreateIndex
CREATE INDEX "AccessPolicy_testerGroupId_idx" ON "AccessPolicy"("testerGroupId");

-- CreateIndex
CREATE INDEX "AccessPolicyWalletEntry_address_idx" ON "AccessPolicyWalletEntry"("address");

-- CreateIndex
CREATE INDEX "Wallet_userId_idx" ON "Wallet"("userId");

-- CreateIndex
CREATE INDEX "Wallet_seekerGenesisVerificationExpiresAt_idx" ON "Wallet"("seekerGenesisVerificationExpiresAt");

-- A single Genesis Token cannot back multiple tester accounts concurrently.
WITH duplicate_sgt AS (
    SELECT "id", ROW_NUMBER() OVER (PARTITION BY "seekerGenesisMintAddress" ORDER BY "seekerGenesisVerifiedAt" DESC NULLS LAST, "id") AS rank
    FROM "Wallet"
    WHERE "seekerGenesisMintAddress" IS NOT NULL
)
UPDATE "Wallet"
SET "seekerGenesisMintAddress" = NULL,
    "seekerGenesisVerifiedAt" = NULL,
    "seekerGenesisVerificationExpiresAt" = NULL
WHERE "id" IN (SELECT "id" FROM duplicate_sgt WHERE rank > 1);

CREATE UNIQUE INDEX "Wallet_seekerGenesisMintAddress_key" ON "Wallet"("seekerGenesisMintAddress");

-- CreateIndex
CREATE INDEX "DeviceProfile_userId_capturedAt_idx" ON "DeviceProfile"("userId", "capturedAt");

-- CreateIndex
CREATE INDEX "DownloadEvent_releaseId_createdAt_idx" ON "DownloadEvent"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "DownloadEvent_userId_createdAt_idx" ON "DownloadEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseViewEvent_releaseId_createdAt_idx" ON "ReleaseViewEvent"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "ReleaseViewEvent_userId_createdAt_idx" ON "ReleaseViewEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackReport_releaseId_createdAt_idx" ON "FeedbackReport"("releaseId", "createdAt");

-- CreateIndex
CREATE INDEX "FeedbackReport_userId_idx" ON "FeedbackReport"("userId");

-- CreateIndex
CREATE INDEX "ReleaseUploadSession_userId_completedAt_expiresAt_idx" ON "ReleaseUploadSession"("userId", "completedAt", "expiresAt");

-- CreateIndex
CREATE INDEX "ReleaseUploadSession_projectId_idx" ON "ReleaseUploadSession"("projectId");

-- CreateIndex
CREATE INDEX "WalletChallenge_userId_expiresAt_idx" ON "WalletChallenge"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "WalletChallenge_address_idx" ON "WalletChallenge"("address");

-- AddForeignKey
ALTER TABLE "BuilderProfile" ADD CONSTRAINT "BuilderProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TesterAccess" ADD CONSTRAINT "TesterAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AppProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TesterAccess" ADD CONSTRAINT "TesterAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Existing project owners become active builders. Only the oldest owner is
-- bootstrapped as administrator; later admins are configured explicitly.
WITH owner_usage AS (
    SELECT
        u."id" AS "userId",
        u."createdAt",
        COALESCE(SUM(ba."fileSizeBytes"), 0)::BIGINT AS used_bytes
    FROM "User" u
    INNER JOIN "AppProject" p ON p."ownerId" = u."id"
    LEFT JOIN "Release" r ON r."projectId" = p."id"
    LEFT JOIN "BuildAsset" ba ON ba."releaseId" = r."id"
    GROUP BY u."id", u."createdAt"
), existing_builders AS (
    SELECT
        "userId",
        used_bytes,
        ROW_NUMBER() OVER (ORDER BY "createdAt", "userId") AS admin_rank
    FROM owner_usage
)
INSERT INTO "BuilderProfile" (
    "id", "userId", "status", "isAdmin", "usedStorageBytes", "createdAt", "updatedAt"
)
SELECT
    'bp_' || md5(random()::text || "userId"),
    "userId",
    'ACTIVE'::"BuilderStatus",
    admin_rank = 1,
    used_bytes,
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM existing_builders
ON CONFLICT ("userId") DO NOTHING;

-- Backfill a durable tester access row for every existing project/user pair.
INSERT INTO "TesterAccess" ("id", "projectId", "userId", "createdAt", "updatedAt")
SELECT
    'ta_' || md5(random()::text || tester_pairs."projectId" || tester_pairs."userId"),
    tester_pairs."projectId",
    tester_pairs."userId",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM (
    SELECT il."projectId", ic."userId"
    FROM "InviteClaim" ic
    INNER JOIN "InviteLink" il ON il."id" = ic."inviteLinkId"
    UNION
    SELECT tm."projectId", tm."userId"
    FROM "TesterMembership" tm
) tester_pairs
ON CONFLICT ("projectId", "userId") DO NOTHING;

-- Legacy SGT checks had no expiry and therefore cannot satisfy the new policy.
UPDATE "Wallet"
SET "seekerGenesisVerificationExpiresAt" = "seekerGenesisVerifiedAt"
WHERE "seekerGenesisVerifiedAt" IS NOT NULL;
