-- CreateTable
CREATE TABLE "AgentConfig" (
    "agentName" TEXT NOT NULL PRIMARY KEY,
    "enabled"   INTEGER NOT NULL DEFAULT 1,
    "updatedAt" DATETIME NOT NULL
);
