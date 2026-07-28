-- Add linkedScriptId to TestCase for N TCs → 1 Script linking (TC Library feature)
ALTER TABLE "TestCase" ADD COLUMN IF NOT EXISTS "linkedScriptId" TEXT;
ALTER TABLE "TestCase" DROP CONSTRAINT IF EXISTS "TestCase_linkedScriptId_fkey";
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_linkedScriptId_fkey"
  FOREIGN KEY ("linkedScriptId") REFERENCES "Script"(id)
  ON DELETE SET NULL ON UPDATE CASCADE;
