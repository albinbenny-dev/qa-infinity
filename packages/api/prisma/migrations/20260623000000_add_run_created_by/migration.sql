-- AlterTable: add createdByUserId to Run for session-scoped execution isolation
ALTER TABLE "Run" ADD COLUMN "createdByUserId" TEXT;
