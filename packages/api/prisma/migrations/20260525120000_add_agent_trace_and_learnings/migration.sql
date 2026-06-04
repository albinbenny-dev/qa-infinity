-- Add agentLearnings to ProjectContext
ALTER TABLE "ProjectContext" ADD COLUMN "agentLearnings" TEXT;

-- CreateTable AgentTrace
CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "projectId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "testGoal" TEXT NOT NULL,
    "menuContext" TEXT,
    "targetUrl" TEXT,
    "stepCount" INTEGER NOT NULL DEFAULT 0,
    "currentStep" TEXT,
    "actionLog" TEXT,
    "errorMessage" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" DATETIME,
    CONSTRAINT "AgentTrace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "AgentTrace_projectId_idx" ON "AgentTrace"("projectId");

-- CreateIndex
CREATE INDEX "AgentTrace_projectId_status_idx" ON "AgentTrace"("projectId", "status");
