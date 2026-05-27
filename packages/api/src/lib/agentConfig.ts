import { prisma } from './prisma.js';

// All known agents with their labels — used to seed the config list.
export const KNOWN_AGENTS = [
  { agentName: 'healing-agent',    label: 'Healing Agent',     description: 'Auto-patches failing scripts after a run' },
  { agentName: 'writer-agent',     label: 'Writer Agent',      description: 'Generates test cases from UI scans and requirement docs' },
  { agentName: 'ui-context-agent', label: 'UI Context Agent',  description: 'Analyses scanned pages to suggest use cases and locators' },
  { agentName: 'ui-scanner',       label: 'UI Scanner LLM',    description: 'Guides the scanner to the right page via a single LLM call per scan' },
  { agentName: 'browser-agent',    label: 'Browser Agent',     description: 'Autonomous browser agent that records actions and generates test cases' },
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
  'browser-agent',
  'reports-agent',
];

export async function isAgentEnabled(agentName: string): Promise<boolean> {
  const row = await prisma.agentConfig.findUnique({ where: { agentName } });
  return row?.enabled ?? true; // default: enabled if not yet configured
}

// ── Healing Agent settings ─────────────────────────────────────────────────

export interface HealingAgentSettings {
  // SELECTOR heals whose classifier confidence is below this value will trigger
  // a live browser trace instead of relying on a static DOM snapshot.
  selectorTraceThreshold: number; // 0–100, default 60
}

export const DEFAULT_HEALING_SETTINGS: HealingAgentSettings = {
  selectorTraceThreshold: 60,
};

export async function getHealingAgentSettings(): Promise<HealingAgentSettings> {
  const row = await prisma.agentConfig.findUnique({ where: { agentName: 'healing-agent' } });
  if (!row?.settings) return DEFAULT_HEALING_SETTINGS;
  try {
    const parsed = JSON.parse(row.settings) as Partial<HealingAgentSettings>;
    return {
      selectorTraceThreshold:
        typeof parsed.selectorTraceThreshold === 'number'
          ? Math.min(100, Math.max(0, Math.round(parsed.selectorTraceThreshold)))
          : DEFAULT_HEALING_SETTINGS.selectorTraceThreshold,
    };
  } catch {
    return DEFAULT_HEALING_SETTINGS;
  }
}
