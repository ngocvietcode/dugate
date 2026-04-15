-- AlterTable
ALTER TABLE "ExternalApiConnection" ADD COLUMN     "fileUrlFieldName" TEXT;

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "password" SET DEFAULT '';

-- CreateTable
CREATE TABLE "FileCache" (
    "id" TEXT NOT NULL,
    "md5Hash" TEXT NOT NULL,
    "s3Key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "refCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAccessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileCache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FileCache_md5Hash_key" ON "FileCache"("md5Hash");

-- CreateIndex
CREATE INDEX "FileCache_refCount_idx" ON "FileCache"("refCount");

-- CreateIndex
CREATE INDEX "FileCache_lastAccessedAt_idx" ON "FileCache"("lastAccessedAt");
