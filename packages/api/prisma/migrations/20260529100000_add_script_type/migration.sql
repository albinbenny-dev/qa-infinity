-- Add scriptType to Script table
-- Valid values: "PLAYWRIGHT" (default) | "ROBOT"
ALTER TABLE "Script" ADD COLUMN "scriptType" TEXT NOT NULL DEFAULT 'PLAYWRIGHT';
