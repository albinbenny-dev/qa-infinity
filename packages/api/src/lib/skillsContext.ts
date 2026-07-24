import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createAnthropicDirectClient, createLLM } from './llm.js';
import { prisma } from './prisma.js';
import { appendAuditLog } from './llmAudit.js';
import { listSkillFiles, readSkillFile, type SkillFileData } from '../services/scriptFileService.js';

// ── Skill loading ──────────────────────────────────────────────────────────

export function loadActiveSkills(slug: string): SkillFileData[] {
  const files = listSkillFiles(slug);
  const skills: SkillFileData[] = [];
  for (const f of files) {
    try { skills.push(readSkillFile(slug, f)); } catch {}
  }
  return skills
    .filter((s) => s.isActive)
    .sort((a, b) => {
      const aLogin = isLoginSkill(a);
      const bLogin = isLoginSkill(b);
      if (aLogin && !bLogin) return -1;
      if (!aLogin && bLogin) return 1;
      return b.confidence - a.confidence;
    });
}

function isLoginSkill(s: SkillFileData): boolean {
  return s.skillType === 'UI_FLOW' &&
    (s.name.toLowerCase().includes('login') ||
     (s.scope?.toLowerCase().includes('login') ?? false));
}

// ── Skills text formatter ──────────────────────────────────────────────────

export function buildSkillsText(skills: SkillFileData[]): string {
  if (skills.length === 0) return '';
  const lines: string[] = [
    '### PRODUCT SKILLS — verified app knowledge (use EXACTLY, do not guess or invent)',
    '',
  ];

  for (const skill of skills) {
    try {
      let content: Record<string, unknown> | null = null;
      try {
        content = JSON.parse(skill.content) as Record<string, unknown>;
      } catch { /* plain text — handled below */ }

      // Plain text skill — emit verbatim and skip structured parsing
      if (content === null) {
        const login = isLoginSkill(skill);
        if (login) {
          lines.push('╔════════════════════════════════════════════════════════════════════════╗');
          lines.push('║  MANDATORY LOGIN SKILL — HIGHEST PRIORITY                             ║');
          lines.push('║  Use EXACTLY these selectors and credentials for all authentication.  ║');
          lines.push('╚════════════════════════════════════════════════════════════════════════╝');
          lines.push('');
        }
        lines.push(`#### [${skill.skillType}] ${skill.name}${skill.scope ? ` — ${skill.scope}` : ''}`);
        lines.push(skill.content);
        lines.push('');
        continue;
      }
      const login = isLoginSkill(skill);
      const recorded = skill.captureMethod === 'USER_RECORDED' || skill.captureMethod === 'BROWSER_AGENT';

      if (login) {
        lines.push('╔════════════════════════════════════════════════════════════════════════╗');
        lines.push('║  MANDATORY LOGIN SKILL — HIGHEST PRIORITY                             ║');
        lines.push('║  Use EXACTLY these selectors and credentials for all authentication.  ║');
        lines.push('╚════════════════════════════════════════════════════════════════════════╝');
        lines.push('');
      }

      lines.push(
        `#### [${skill.skillType}] ${skill.name}` +
        `${skill.scope ? ` — ${skill.scope}` : ''}` +
        `${recorded ? ' [LIVE BROWSER RECORDING]' : ''}`,
      );

      switch (skill.skillType) {
        case 'UI_FLOW': {
          if (content.targetUrl) lines.push(`  URL: ${content.targetUrl}`);
          if (Array.isArray(content.navigationPath) && content.navigationPath.length) {
            lines.push(`  Navigation: ${(content.navigationPath as string[]).join(' → ')}`);
          }
          if (Array.isArray(content.locators) && content.locators.length) {
            lines.push(recorded ? '  RECORDED locators (copy verbatim):' : '  Locators (use exactly):');
            for (const loc of (content.locators as Array<{
              semanticName: string; selector: string; locatorType: string; interactionNote?: string;
            }>).slice(0, 40)) {
              lines.push(`    - ${loc.semanticName}: "${loc.selector}" [${loc.locatorType}]${loc.interactionNote ? ` — ${loc.interactionNote}` : ''}`);
            }
          }
          if (typeof content.rawPlaywrightCode === 'string' && content.rawPlaywrightCode.trim()) {
            lines.push('  Recorded Playwright code (confirmed selectors — use these):');
            lines.push('  ---');
            for (const l of content.rawPlaywrightCode.trim().slice(0, 3000).split('\n')) lines.push(`  ${l}`);
            lines.push('  ---');
          }
          if (Array.isArray(content.stateTransitions) && content.stateTransitions.length) {
            lines.push('  State transitions:');
            for (const st of (content.stateTransitions as Array<{
              trigger: string; resultState: string; waitCondition?: string;
            }>).slice(0, 5)) {
              lines.push(`    - ${st.trigger} → ${st.resultState}${st.waitCondition ? ` (wait: ${st.waitCondition})` : ''}`);
            }
          }
          if (Array.isArray(content.validations) && content.validations.length) {
            lines.push('  Validations:');
            for (const v of (content.validations as Array<{
              field: string; rule: string; errorText: string;
            }>).slice(0, 5)) {
              lines.push(`    - ${v.field}: "${v.errorText}" (rule: ${v.rule})`);
            }
          }
          break;
        }
        case 'USER_ROLE': {
          if (content.roleName) lines.push(`  Role: ${content.roleName}`);
          const creds = content.testCredentials as { username?: string; password?: string } | undefined;
          if (creds?.username) lines.push(`  TC_USERNAME: ${creds.username}`);
          if (creds?.password) lines.push(`  TC_PASSWORD: ${creds.password}`);
          if (Array.isArray(content.permissions)) lines.push(`  Permissions: ${(content.permissions as string[]).join(', ')}`);
          if (Array.isArray(content.restrictions)) lines.push(`  Restrictions: ${(content.restrictions as string[]).join(', ')}`);
          break;
        }
        case 'BUSINESS_USE_CASE': {
          if (Array.isArray(content.actors) && content.actors.length) lines.push(`  Actors: ${(content.actors as string[]).join(', ')}`);
          if (Array.isArray(content.businessRules) && content.businessRules.length) {
            lines.push('  Business Rules:');
            for (const r of content.businessRules as string[]) lines.push(`    - ${r}`);
          }
          if (Array.isArray(content.successCriteria) && content.successCriteria.length) {
            lines.push(`  Success criteria: ${(content.successCriteria as string[]).join('; ')}`);
          }
          if (Array.isArray(content.edgeCases) && content.edgeCases.length) {
            lines.push('  Edge cases (generate TCs for each):');
            for (const e of content.edgeCases as string[]) lines.push(`    - ${e}`);
          }
          break;
        }
        case 'TEST_DATA': {
          if (content.validData) lines.push(`  Valid data: ${JSON.stringify(content.validData).slice(0, 600)}`);
          if (content.invalidData) lines.push(`  Invalid data: ${JSON.stringify(content.invalidData).slice(0, 400)}`);
          if (content.referenceData) lines.push(`  Reference data (exact values): ${JSON.stringify(content.referenceData).slice(0, 400)}`);
          if (content.boundaryValues) lines.push(`  Boundary values: ${JSON.stringify(content.boundaryValues).slice(0, 300)}`);
          break;
        }
        case 'API_CONTRACT': {
          if (content.endpoint) lines.push(`  Endpoint: ${content.method ?? 'GET'} ${content.endpoint}`);
          if (content.purpose) lines.push(`  Purpose: ${content.purpose}`);
          if (content.requestSchema) lines.push(`  Request schema: ${JSON.stringify(content.requestSchema).slice(0, 400)}`);
          if (content.responses) lines.push(`  Responses: ${JSON.stringify(content.responses).slice(0, 400)}`);
          break;
        }
        case 'UX_DESIGN': {
          if (Array.isArray(content.components) && content.components.length) {
            lines.push('  Components:');
            for (const c of (content.components as Array<{
              name: string; componentType: string; interaction?: string; required?: boolean;
            }>)) {
              lines.push(`    - ${c.name} (${c.componentType})${c.interaction ? `: ${c.interaction}` : ''}${c.required ? ' [REQUIRED]' : ''}`);
            }
          }
          if (content.exactCopy) lines.push(`  Exact UI text (use verbatim): ${JSON.stringify(content.exactCopy).slice(0, 400)}`);
          if (Array.isArray(content.requiredFields)) lines.push(`  Required fields: ${(content.requiredFields as string[]).join(', ')}`);
          break;
        }
        case 'HLD': {
          if (content.description) lines.push(`  ${String(content.description).slice(0, 300)}`);
          if (Array.isArray(content.components)) lines.push(`  Components: ${(content.components as string[]).join(', ')}`);
          if (Array.isArray(content.integrations) && content.integrations.length) {
            lines.push('  Integrations:');
            for (const i of (content.integrations as Array<{
              from: string; to: string; trigger: string; async: boolean;
            }>).slice(0, 5)) {
              lines.push(`    - ${i.from} → ${i.to} (trigger: ${i.trigger}${i.async ? ', async' : ''})`);
            }
          }
          break;
        }
        case 'FUNCTIONAL_RULES': {
          if (content.summary) lines.push(`  Summary: ${String(content.summary).slice(0, 300)}`);
          if (Array.isArray(content.fieldConstraints) && content.fieldConstraints.length) {
            lines.push('  Field Constraints (generate a TC for each):');
            for (const r of content.fieldConstraints as string[]) lines.push(`    - ${r}`);
          }
          if (Array.isArray(content.dataRelationships) && content.dataRelationships.length) {
            lines.push('  Data Relationships:');
            for (const r of content.dataRelationships as string[]) lines.push(`    - ${r}`);
          }
          if (Array.isArray(content.knownFailureModes) && content.knownFailureModes.length) {
            lines.push('  Known Failure Modes (each needs a negative TC):');
            for (const r of content.knownFailureModes as string[]) lines.push(`    - ${r}`);
          }
          if (Array.isArray(content.permissionScenarios) && content.permissionScenarios.length) {
            lines.push('  Permission Scenarios:');
            for (const r of content.permissionScenarios as string[]) lines.push(`    - ${r}`);
          }
          if (Array.isArray(content.functionalVariations) && content.functionalVariations.length) {
            lines.push('  Functional Variations (each needs its own TC):');
            for (const r of content.functionalVariations as string[]) lines.push(`    - ${r}`);
          }
          break;
        }
        case 'HISTORICAL': {
          let entries: Array<{ date?: string; healType?: string; confidence?: number; summary?: string; selectorChanges?: Record<string, string> }> = [];
          try { entries = JSON.parse(skill.content) as typeof entries; } catch { break; }
          if (!Array.isArray(entries) || entries.length === 0) break;
          lines.push('  PAST HEAL FIXES — do NOT replicate these broken patterns in new scripts:');
          for (const e of entries.slice(-10)) {
            lines.push(`  [${e.date ?? '?'}] ${e.healType ?? 'UNKNOWN'} (confidence ${e.confidence ?? '?'}%): ${e.summary ?? ''}`);
            if (e.selectorChanges && Object.keys(e.selectorChanges).length > 0) {
              for (const [old, next] of Object.entries(e.selectorChanges)) {
                lines.push(`    FIXED selector: "${old}" → "${next}"`);
              }
            }
          }
          break;
        }
        default:
          lines.push(`  ${skill.content.slice(0, 500)}`);
      }
      lines.push('');
    } catch { /* skip malformed skill */ }
  }

  return lines.join('\n');
}

// ── SDK system block ───────────────────────────────────────────────────────

export interface SkillSystemBlock {
  type: 'text';
  text: string;
  cache_control: { type: 'ephemeral' };
}

export function buildSkillsSystemBlock(slug: string): SkillSystemBlock | null {
  const skills = loadActiveSkills(slug);
  const text = buildSkillsText(skills);
  if (!text.trim()) return null;
  return { type: 'text', text, cache_control: { type: 'ephemeral' } };
}

// ── Unified single-shot agent call ─────────────────────────────────────────
// Uses @anthropic-ai/sdk when ANTHROPIC_API_KEY is set; falls back to LangChain.
// If skillsBlock is provided it is injected as a cached first system block.

export interface AgentCallParams {
  systemPrompt: string;
  userContent: string;
  agentName: string;
  projectId?: string | null;
  projectName?: string | null;
  maxTokens?: number;
  thinking?: boolean;
  skillsBlock?: SkillSystemBlock | null;
  temperature?: number;
}

export async function callAgent(params: AgentCallParams): Promise<string> {
  const {
    systemPrompt,
    userContent,
    agentName,
    projectId,
    projectName,
    maxTokens = 8192,
    thinking = false,
    skillsBlock,
    temperature = 0,
  } = params;

  const directClient = createAnthropicDirectClient();

  if (directClient) {
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8';
    const startMs = Date.now();

    const systemBlocks: Array<{ type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }> = [];
    if (skillsBlock) systemBlocks.push(skillsBlock);
    systemBlocks.push({ type: 'text', text: systemPrompt });

    const streamParams: Parameters<typeof directClient.messages.stream>[0] = {
      model,
      max_tokens: maxTokens,
      system: systemBlocks,
      messages: [{ role: 'user', content: userContent }],
    };
    if (thinking) (streamParams as Record<string, unknown>)['thinking'] = { type: 'adaptive' };

    const stream = directClient.messages.stream(streamParams);
    const message = await stream.finalMessage();
    const durationMs = Date.now() - startMs;

    const responseText = message.content.find((b): b is { type: 'text'; text: string } => b.type === 'text')?.text ?? '';

    void prisma.llmCall.create({
      data: {
        agentName,
        projectId: projectId ?? null,
        projectName: projectName ?? null,
        model,
        promptTokens: message.usage.input_tokens,
        completionTokens: message.usage.output_tokens,
        totalTokens: message.usage.input_tokens + message.usage.output_tokens,
        durationMs,
      },
    }).catch((e: Error) => console.error(`[${agentName}] DB write failed:`, e.message));

    appendAuditLog({
      agent: agentName,
      model,
      projectId,
      projectName,
      promptTokens: message.usage.input_tokens,
      completionTokens: message.usage.output_tokens,
      durationMs,
      system: systemBlocks,
      user: userContent,
      response: responseText,
    });

    return responseText;
  }

  // LangChain fallback
  const llm = createLLM({
    temperature,
    agentName,
    projectId: projectId ?? undefined,
    projectName: projectName ?? undefined,
  });
  const userWithSkills = skillsBlock ? `${userContent}\n\n${skillsBlock.text}` : userContent;
  const response = await llm.invoke([new SystemMessage(systemPrompt), new HumanMessage(userWithSkills)]);
  return typeof response.content === 'string' ? response.content : JSON.stringify(response.content);
}
