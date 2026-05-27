-- AlterTable: add isGolden flag to Script for few-shot example marking
ALTER TABLE "Script" ADD COLUMN "isGolden" BOOLEAN NOT NULL DEFAULT false;

-- Index for fast golden-script lookups by project
CREATE INDEX "Script_projectId_isGolden_idx" ON "Script"("projectId", "isGolden");
