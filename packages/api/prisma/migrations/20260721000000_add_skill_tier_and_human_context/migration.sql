-- Add tier (injection scope) and humanContext (QA correction text) to ProjectSkill
ALTER TABLE "ProjectSkill" ADD COLUMN "tier" TEXT NOT NULL DEFAULT 'FEATURE';
ALTER TABLE "ProjectSkill" ADD COLUMN "humanContext" TEXT;

-- Back-fill: Login and Navigation skills are GLOBAL; everything else stays FEATURE
UPDATE "ProjectSkill"
SET "tier" = 'GLOBAL'
WHERE
  "skillType" = 'UI_FLOW' AND (
    LOWER("name") LIKE '%login%' OR
    LOWER("scope") LIKE '%login%' OR
    LOWER("name") LIKE '%navigation%' OR
    LOWER("name") LIKE '%nav helper%'
  );

-- HISTORICAL skills keep tier = HISTORICAL for display separation
UPDATE "ProjectSkill"
SET "tier" = 'HISTORICAL'
WHERE "skillType" = 'HISTORICAL';
