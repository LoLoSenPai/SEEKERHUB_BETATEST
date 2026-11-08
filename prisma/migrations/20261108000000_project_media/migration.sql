CREATE TYPE "ProjectMediaKind" AS ENUM ('ICON', 'BANNER', 'SCREENSHOT');
CREATE TYPE "ProjectMediaStatus" AS ENUM ('PENDING', 'READY', 'DELETING');

CREATE TABLE "ProjectMedia" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "kind" "ProjectMediaKind" NOT NULL,
    "status" "ProjectMediaStatus" NOT NULL DEFAULT 'PENDING',
    "storageKey" TEXT NOT NULL,
    "fileSizeBytes" BIGINT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "position" INTEGER NOT NULL,
    "replacesId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "readyAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProjectMedia_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ProjectMedia_positive_size" CHECK ("fileSizeBytes" > 0 AND "fileSizeBytes" <= 1048576),
    CONSTRAINT "ProjectMedia_dimensions" CHECK ("width" > 0 AND "height" > 0 AND "width" <= 1920 AND "height" <= 1920),
    CONSTRAINT "ProjectMedia_slot" CHECK (("kind" IN ('ICON', 'BANNER') AND "position" = 0) OR ("kind" = 'SCREENSHOT' AND "position" BETWEEN 0 AND 4))
);
CREATE UNIQUE INDEX "ProjectMedia_storageKey_key" ON "ProjectMedia"("storageKey");
CREATE INDEX "ProjectMedia_projectId_status_kind_position_idx" ON "ProjectMedia"("projectId", "status", "kind", "position");
CREATE INDEX "ProjectMedia_status_expiresAt_idx" ON "ProjectMedia"("status", "expiresAt");
-- Pending replacements coexist with the visible original until their commit succeeds.
CREATE UNIQUE INDEX "ProjectMedia_ready_slot_key" ON "ProjectMedia"("projectId", "kind", "position") WHERE "status" = 'READY';
CREATE UNIQUE INDEX "ProjectMedia_pending_slot_key" ON "ProjectMedia"("projectId", "kind", "position") WHERE "status" = 'PENDING';
ALTER TABLE "ProjectMedia" ADD CONSTRAINT "ProjectMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "AppProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
