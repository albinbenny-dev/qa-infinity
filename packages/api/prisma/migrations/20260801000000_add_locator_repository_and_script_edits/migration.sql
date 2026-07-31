-- CreateTable
CREATE TABLE "LocatorEntry" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "page" TEXT,
    "selector" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "domContext" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.6,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "sourceRunId" TEXT,
    "lastVerifiedRunId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocatorEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScriptEdit" (
    "id" TEXT NOT NULL,
    "scriptId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "previousContent" TEXT NOT NULL,
    "newContent" TEXT NOT NULL,
    "diffSummary" TEXT,
    "classification" TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "editedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScriptEdit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LocatorEntry_projectId_name_key" ON "LocatorEntry"("projectId", "name");

-- CreateIndex
CREATE INDEX "LocatorEntry_projectId_page_idx" ON "LocatorEntry"("projectId", "page");

-- CreateIndex
CREATE INDEX "LocatorEntry_projectId_selector_idx" ON "LocatorEntry"("projectId", "selector");

-- CreateIndex
CREATE INDEX "ScriptEdit_projectId_idx" ON "ScriptEdit"("projectId");

-- CreateIndex
CREATE INDEX "ScriptEdit_scriptId_idx" ON "ScriptEdit"("scriptId");

-- CreateIndex
CREATE INDEX "ScriptEdit_projectId_classification_idx" ON "ScriptEdit"("projectId", "classification");

-- AddForeignKey
ALTER TABLE "LocatorEntry" ADD CONSTRAINT "LocatorEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptEdit" ADD CONSTRAINT "ScriptEdit_scriptId_fkey" FOREIGN KEY ("scriptId") REFERENCES "Script"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScriptEdit" ADD CONSTRAINT "ScriptEdit_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
