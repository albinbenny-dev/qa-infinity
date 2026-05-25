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
}): BaseChatModel {
  const temperature = options?.temperature ?? 0.2;
  const agentName = options?.agentName ?? 'unknown';
  const projectId = options?.projectId;
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
      callbacks: [new LlmUsageTracker(agentName, projectId, model)],
    });
  }

  // Default: OpenRouter (OpenAI-compatible endpoint)
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');
  const model = process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-5';

  return new ChatOpenAI({
    modelName: model,
    openAIApiKey: apiKey,
    temperature,
    maxTokens: 8192,
    callbacks: [new LlmUsageTracker(agentName, projectId, model)],
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
        'X-Title': 'QA Infinity',
      },
    },
  });
}
