-- Add createdBy (userId) to ScriptJob for per-user job isolation
ALTER TABLE "ScriptJob" ADD COLUMN "createdBy" TEXT;
CREATE INDEX "ScriptJob_projectId_createdBy_idx" ON "ScriptJob"("projectId", "createdBy");
