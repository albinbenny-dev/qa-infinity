-- AlterTable: add verification fields to Script
ALTER TABLE "Script" ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_VERIFIED';
ALTER TABLE "Script" ADD COLUMN "suspectedIssue" TEXT;

-- CreateTable
CREATE TABLE "ScriptJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "testCaseId" TEXT NOT NULL,
    "scriptId" TEXT,
    "phase" TEXT NOT NULL DEFAULT 'QUEUED',
    "withHeal" BOOLEAN NOT NULL DEFAULT false,
    "healAttempts" INTEGER NOT NULL DEFAULT 0,
    "maxHealAttempts" INTEGER NOT NULL DEFAULT 2,
    "lastError" TEXT,
    "suspectedIssue" TEXT,
    "healType" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ScriptJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ScriptJob_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ScriptJob_projectId_idx" ON "ScriptJob"("projectId");
CREATE INDEX "ScriptJob_projectId_phase_idx" ON "ScriptJob"("projectId", "phase");
CREATE INDEX "ScriptJob_projectId_createdAt_idx" ON "ScriptJob"("projectId", "createdAt");
