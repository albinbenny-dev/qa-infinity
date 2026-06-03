import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { LLMResult } from '@langchain/core/outputs';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { prisma } from './prisma.js';

/**
 * Returns a LangChain chat model instance.
 *
 * Provider is selected by LLM_PROVIDER env var:
 *   "openrouter"  → OpenRouter (default — works with any OpenRouter key)
 *   "anthropic"   → Direct Anthropic API
 *
 * All 5 agents import this factory so switching provider is a single env change.
 */

// ── Usage tracker callback ─────────────────────────────────────────────────

class LlmUsageTracker extends BaseCallbackHandler {
  name = 'llm-usage-tracker';
  private startMs = 0;

  constructor(
    private agentName: string,
    private projectId: string | undefined,
    private projectName: string | undefined,
    private model: string,
  ) {
    super();
  }

  handleLLMStart(): void {
    this.startMs = Date.now();
  }

  async handleLLMEnd(output: LLMResult): Promise<void> {
    const durationMs = Date.now() - this.startMs;
    const usage = output.llmOutput?.['tokenUsage'] as {
      promptTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
    } | undefined;

    void prisma.llmCall.create({
      data: {
        agentName: this.agentName,
        projectId: this.projectId ?? null,
        projectName: this.projectName ?? null,
        model: this.model,
        promptTokens: usage?.promptTokens ?? 0,
        completionTokens: usage?.completionTokens ?? 0,
        totalTokens: usage?.totalTokens ?? 0,
        durationMs,
      },
    }).catch((err) => console.error('[usage-tracker] DB write failed:', err));
  }
}

// ── Factory ────────────────────────────────────────────────────────────────

export function createLLM(options?: {
  temperature?: number;
  agentName?: string;
  projectId?: string;
  projectName?: string;
  /**
   * Enable Anthropic prompt caching (only takes effect with provider=anthropic).
   *
   * When true, the model is initialised with the `prompt-caching-2024-07-31` beta
   * header so that system messages tagged with `cache_control: {type:"ephemeral"}`
   * are cached server-side.
   *
   * Cached tokens cost 10% of normal input price — large wins for agents that
   * repeat the same long system prompt on every step (e.g. browser-agent).
   *
   * OpenRouter handles caching automatically on their end — no flag needed there.
   *
   * Default: true (opt-out by passing false)
   */
  enableCaching?: boolean;
}): BaseChatModel {
  const temperature = options?.temperature ?? 0.2;
  const agentName = options?.agentName ?? 'unknown';
  const projectId = options?.projectId;
  const projectName = options?.projectName;
  const enableCaching = options?.enableCaching ?? true;
  const provider = process.env.LLM_PROVIDER ?? 'openrouter';

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514';

    return new ChatAnthropic({
      apiKey,
      model,
      temperature,
      maxTokens: 8192,
      callbacks: [new LlmUsageTracker(agentName, projectId, projectName, model)],
      // ── Prompt caching: reduces cost by 90% on repeated system prompts ──
      // Agents that call this model multiple times with the same system prompt
      // (e.g. browser-agent running 20 steps) benefit most.
      // Mark system message content with cache_control: {type:"ephemeral"} at
      // the call site (see browserAgent.ts buildSystemPrompt).
      ...(enableCaching && {
        clientOptions: {
          defaultHeaders: {
            'anthropic-beta': 'prompt-caching-2024-07-31',
          },
        },
      }),
    });
  }

  // Default: OpenRouter (OpenAI-compatible endpoint)
  // OpenRouter applies its own prompt caching automatically — no header needed.
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-5';

  return new ChatOpenAI({
    modelName: model,
    openAIApiKey: apiKey,
    temperature,
    maxTokens: 8192,
    callbacks: [new LlmUsageTracker(agentName, projectId, projectName, model)],
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
        'X-Title': 'QA Infinity',
      },
    },
  });
}
