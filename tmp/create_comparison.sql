CREATE TABLE IF NOT EXISTS "Comparison" (
  id TEXT PRIMARY KEY,
  "file1Name" TEXT NOT NULL,
  "file2Name" TEXT NOT NULL,
  "file1Path" TEXT NOT NULL,
  "file2Path" TEXT NOT NULL,
  "file1Md" TEXT,
  "file2Md" TEXT,
  "resultJson" TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  "errorMessage" TEXT,
  "docxFormat" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_comparison_status ON "Comparison"(status);
CREATE INDEX IF NOT EXISTS idx_comparison_created_at ON "Comparison"("createdAt" DESC);
