-- CreateTable
CREATE TABLE "UserProfileAssignment" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserProfileAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserProfileAssignment_userId_idx" ON "UserProfileAssignment"("userId");

-- CreateIndex
CREATE INDEX "UserProfileAssignment_apiKeyId_idx" ON "UserProfileAssignment"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "UserProfileAssignment_userId_apiKeyId_key" ON "UserProfileAssignment"("userId", "apiKeyId");

-- AddForeignKey
ALTER TABLE "UserProfileAssignment" ADD CONSTRAINT "UserProfileAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserProfileAssignment" ADD CONSTRAINT "UserProfileAssignment_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
