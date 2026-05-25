-- AlterTable: add videoPath to RunResult for headed-mode video recording
ALTER TABLE "RunResult" ADD COLUMN "videoPath" TEXT;
