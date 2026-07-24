-- CreateTable
CREATE TABLE "ProjectSkill" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "skillType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT,
    "content" TEXT NOT NULL,
    "captureMethod" TEXT NOT NULL DEFAULT 'MANUALLY_ENTERED',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.8,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectSkill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProjectSkill_projectId_skillType_idx" ON "ProjectSkill"("projectId", "skillType");

-- CreateIndex
CREATE INDEX "ProjectSkill_projectId_isActive_idx" ON "ProjectSkill"("projectId", "isActive");

-- AddForeignKey
ALTER TABLE "ProjectSkill" ADD CONSTRAINT "ProjectSkill_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
