-- CreateTable
CREATE TABLE "ProjectResource" (
    "id"           TEXT NOT NULL PRIMARY KEY,
    "projectId"    TEXT NOT NULL,
    "filename"     TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "size"         INTEGER NOT NULL,
    "uploadedAt"   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectResource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectResource_projectId_filename_key" ON "ProjectResource"("projectId", "filename");

-- CreateIndex
CREATE INDEX "ProjectResource_projectId_idx" ON "ProjectResource"("projectId");
