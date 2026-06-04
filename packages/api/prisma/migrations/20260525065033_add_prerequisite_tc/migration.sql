-- AlterTable: add optional self-referencing FK for prerequisite TC
-- This column stores the id of another TestCase whose script handles the
-- login + navigation setup steps, allowing the script generator to reuse
-- a verified script instead of regenerating common setup steps.
ALTER TABLE "TestCase" ADD COLUMN "prerequisiteTcId" TEXT;
