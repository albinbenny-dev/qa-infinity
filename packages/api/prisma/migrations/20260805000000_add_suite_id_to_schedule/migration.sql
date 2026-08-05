-- AlterTable: add suiteId to Schedule (nullable — existing rows keep testCaseIds)
ALTER TABLE "Schedule" ADD COLUMN "suiteId" TEXT;
