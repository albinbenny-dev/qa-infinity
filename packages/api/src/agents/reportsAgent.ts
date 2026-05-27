import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { createLLM } from '../lib/llm.js';

export interface ReportsAgentInput {
  runSummary: {
    total: number;
    passed: number;
    failed: number;
    duration: number; // ms
  };
  failedTests: Array<{
    title: string;
    error: string;
  }>;
}

export interface ReportsAgentOutput {
  summary: string;
  rootCauses: string[];
  recommendations: string[];
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

const SYSTEM_PROMPT = `You are a senior QA analyst. Analyse a Playwright test run result and produce a structured failure report.
Respond with valid JSON only — no markdown fences, no prose outside the JSON.

Required JSON schema:
{
  "summary": "2–3 sentence overall run summary mentioning pass rate and key failures",
  "rootCauses": ["root cause 1", "root cause 2"],
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2"],
  "severity": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL"
}

Severity rules:
  CRITICAL — >30% fail rate OR critical-path failures (login, checkout, payment)
  HIGH     — 10–30% fail rate
  MEDIUM   — 1–10% fail rate
  LOW      — <1% fail rate or flaky-only failures`;

export async function runReportsAgent(input: ReportsAgentInput): Promise<ReportsAgentOutput> {
  const failRate =
    input.runSummary.total > 0
      ? (input.runSummary.failed / input.runSummary.total) * 100
      : 0;

  if (input.runSummary.failed === 0) {
    return {
      summary: `All ${input.runSummary.total} tests passed in ${formatDuration(input.runSummary.duration)}. The run completed with no failures.`,
      rootCauses: [],
      recommendations: [
        'Continue monitoring for flaky tests',
        'Consider expanding test coverage for edge cases',
      ],
      severity: 'LOW',
    };
  }

  const llm = createLLM({ temperature: 0, agentName: 'reports-agent' });

  const failedList = input.failedTests
    .slice(0, 10)
    .map((t, i) => `${i + 1}. ${t.title}\n   Error: ${t.error.slice(0, 200)}`)
    .join('\n');

  const userContent = `Run summary:
  Total: ${input.runSummary.total}
  Passed: ${input.runSummary.passed}
  Failed: ${input.runSummary.failed}
  Fail rate: ${failRate.toFixed(1)}%
  Duration: ${formatDuration(input.runSummary.duration)}

Failed tests (up to 10):
${failedList}`;

  const response = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(userContent),
  ]);

  const raw =
    typeof response.content === 'string' ? response.content : JSON.stringify(response.content);

  try {
    const clean = raw.replace(/```json\s*/g, '').replace(/```/g, '').trim();
    const parsed = JSON.parse(clean) as Partial<ReportsAgentOutput>;
    const valid: ReportsAgentOutput['severity'][] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    return {
      summary: parsed.summary ?? `${input.runSummary.failed}/${input.runSummary.total} tests failed.`,
      rootCauses: Array.isArray(parsed.rootCauses) ? parsed.rootCauses : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      severity: valid.includes(parsed.severity as ReportsAgentOutput['severity'])
        ? (parsed.severity as ReportsAgentOutput['severity'])
        : severityFromRate(failRate),
    };
  } catch {
    return {
      summary: `${input.runSummary.failed} out of ${input.runSummary.total} tests failed (${failRate.toFixed(1)}% fail rate).`,
      rootCauses: input.failedTests
        .slice(0, 3)
        .map((t) => `${t.title}: ${t.error.slice(0, 100)}`),
      recommendations: ['Review failed tests', 'Check recent code changes for regressions'],
      severity: severityFromRate(failRate),
    };
  }
}

function severityFromRate(rate: number): ReportsAgentOutput['severity'] {
  if (rate >= 30) return 'CRITICAL';
  if (rate >= 10) return 'HIGH';
  if (rate >= 1) return 'MEDIUM';
  return 'LOW';
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
