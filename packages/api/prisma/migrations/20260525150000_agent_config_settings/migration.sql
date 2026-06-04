-- Add settings column to AgentConfig for per-agent tunable parameters
ALTER TABLE "AgentConfig" ADD COLUMN "settings" TEXT;
