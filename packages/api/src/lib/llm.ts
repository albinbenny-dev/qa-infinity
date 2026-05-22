import { ChatOpenAI } from '@langchain/openai';
import { ChatAnthropic } from '@langchain/anthropic';
import type { BaseChatModel } from '@langchain/core/language_models/chat_models';

/**
 * Returns a LangChain chat model instance.
 *
 * Provider is selected by LLM_PROVIDER env var:
 *   "openrouter"  → OpenRouter (default — works with any OpenRouter key)
 *   "anthropic"   → Direct Anthropic API
 *
 * All 5 agents import this factory so switching provider is a single env change.
 */
export function createLLM(options?: { temperature?: number }): BaseChatModel {
  const temperature = options?.temperature ?? 0.2;
  const provider = process.env.LLM_PROVIDER ?? 'openrouter';

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set');

    return new ChatAnthropic({
      apiKey,
      model: process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-20250514',
      temperature,
      maxTokens: 8192,
    });
  }

  // Default: OpenRouter (OpenAI-compatible endpoint)
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error('OPENROUTER_API_KEY is not set');

  return new ChatOpenAI({
    modelName: process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-5',
    openAIApiKey: apiKey,
    temperature,
    maxTokens: 8192,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': process.env.APP_URL ?? 'http://localhost:3000',
        'X-Title': 'QA Infinity',
      },
    },
  });
}
