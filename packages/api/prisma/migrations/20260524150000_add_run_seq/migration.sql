-- Add global sequential run number to Run table
ALTER TABLE "Run" ADD COLUMN "runSeq" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows with sequential numbers ordered by createdAt
UPDATE "Run" SET "runSeq" = (
  SELECT COUNT(*)
  FROM "Run" r2
  WHERE r2."createdAt" < "Run"."createdAt"
     OR (r2."createdAt" = "Run"."createdAt" AND r2."id" < "Run"."id")
) + 1;
