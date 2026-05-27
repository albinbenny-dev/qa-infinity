-- Add agentTraceId to Heal (links to the diagnostic browser trace that informed the patch)
ALTER TABLE "Heal" ADD COLUMN "agentTraceId" TEXT;

-- Unique index so Prisma treats this as a one-to-one relation (one trace → one heal)
-- SQLite allows multiple NULLs in a unique index, so untraced heals (NULL) are fine.
CREATE UNIQUE INDEX "Heal_agentTraceId_key" ON "Heal"("agentTraceId");
