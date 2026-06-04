import { prisma } from '../lib/prisma.js';
import type { RecordedAction, AgentLearning } from '../types/scanner.js';

export async function saveAgentLearnings(
  projectId: string,
  menuContext: string,
  targetUrl: string,
  actions: RecordedAction[],
): Promise<void> {
  const verifiedLocators = actions
    .filter(a => a.success && a.selector)
    .map(a => ({
      semanticName: a.stepDescription ?? a.toolName,
      selector: `${a.selectorType ?? 'css'}=${a.selector}`,
      type: a.selectorType ?? 'css',
    }));

  const verifiedFlow = actions
    .filter(a => a.success && a.stepDescription)
    .map(a => a.stepDescription as string);

  const existing = await prisma.projectContext.findUnique({ where: { projectId } });
  const currentLearnings: AgentLearning[] = existing?.agentLearnings
    ? (JSON.parse(existing.agentLearnings) as AgentLearning[])
    : [];

  const newLearning: AgentLearning = {
    menuContext,
    targetUrl,
    verifiedLocators,
    verifiedFlow,
    tracedAt: new Date().toISOString(),
  };

  const existingIdx = currentLearnings.findIndex(
    l => l.targetUrl === targetUrl || l.menuContext === menuContext,
  );

  if (existingIdx >= 0) {
    currentLearnings[existingIdx] = newLearning;
  } else {
    currentLearnings.push(newLearning);
  }

  // Cap at 50 learnings (remove oldest first)
  const trimmed = currentLearnings.slice(-50);

  await prisma.projectContext.upsert({
    where: { projectId },
    update: { agentLearnings: JSON.stringify(trimmed) },
    create: { projectId, agentLearnings: JSON.stringify(trimmed) },
  });
}
