import { prisma } from './prisma.js';

// All known agents with their labels — used to seed the config list.
export const KNOWN_AGENTS = [
  { agentName: 'healing-agent',    label: 'Healing Agent',     description: 'Auto-patches failing scripts after a run' },
  { agentName: 'writer-agent',     label: 'Writer Agent',      description: 'Generates test cases from UI scans and requirement docs' },
  { agentName: 'ui-context-agent', label: 'UI Context Agent',  description: 'Analyses scanned pages to suggest use cases and locators' },
  { agentName: 'ui-scanner',       label: 'UI Scanner LLM',    description: 'Guides the scanner to the right page via a single LLM call per scan' },
  { agentName: 'reports-agent',    label: 'Reports Agent',     description: 'Generates AI failure analysis after each run' },
  { agentName: 'script-agent',     label: 'Script Agent',      description: 'Generates Playwright TypeScript scripts from test cases' },
  { agentName: 'chat-agent',       label: 'Chat Agent',        description: 'Powers the in-app QA assistant chat' },
] as const;

export type KnownAgentName = typeof KNOWN_AGENTS[number]['agentName'];

// Agents disabled in Standard Mode — routine execution phase; Writer + Script Agents stay ON.
// Standard Mode: seed TCs (manual + Excel) → Writer Agent → Script Agent only.
// Full Mode: all agents enabled (Jira stories, UI scans, document uploads all work).
export const STANDARD_MODE_DISABLED: KnownAgentName[] = [
  'healing-agent',
  'ui-context-agent',
  'ui-scanner',
  'reports-agent',
];

export async function isAgentEnabled(agentName: string): Promise<boolean> {
  const row = await prisma.agentConfig.findUnique({ where: { agentName } });
  return row?.enabled ?? true; // default: enabled if not yet configured
}
