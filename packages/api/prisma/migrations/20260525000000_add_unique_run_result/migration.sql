-- Remove duplicate RunResult rows, keeping only the most recently created one per (runId, testCaseId)
DELETE FROM "RunResult"
WHERE id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY "runId", "testCaseId" ORDER BY "createdAt" DESC) AS rn
    FROM "RunResult"
  ) ranked
  WHERE rn = 1
);

-- Add unique constraint
CREATE UNIQUE INDEX "RunResult_runId_testCaseId_key" ON "RunResult"("runId", "testCaseId");
