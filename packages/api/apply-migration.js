const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  // Add agentLearnings to ProjectContext
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "ProjectContext" ADD COLUMN "agentLearnings" TEXT`
  ).catch(e => {
    if (e.message && e.message.includes('duplicate column')) {
      console.log('agentLearnings: already exists');
    } else {
      throw e;
    }
  });
  console.log('agentLearnings column: OK');

  // Create AgentTrace table
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AgentTrace" (
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
    )
  `);
  console.log('AgentTrace table: OK');

  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AgentTrace_projectId_idx" ON "AgentTrace"("projectId")`
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "AgentTrace_projectId_status_idx" ON "AgentTrace"("projectId", "status")`
  );
  console.log('AgentTrace indexes: OK');
}

main()
  .then(() => { console.log('Migration complete.'); process.exit(0); })
  .catch(e => { console.error('Migration failed:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
