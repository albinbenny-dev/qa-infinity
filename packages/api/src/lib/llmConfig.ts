/**
 * LLM configuration singleton.
 *
 * Priority:  DB (SystemConfig table)  >  environment variables (.env)
 *
 * Call `initLlmConfig()` once at startup (before workers attach).
 * All other code calls `getCachedLlmConfig()` synchronously — zero latency.
 * After a super-admin saves new config via the UI, `saveLlmConfig()` writes to
 * DB then calls `initLlmConfig()` again to refresh the in-memory cache; new
 * agent calls immediately pick up the updated provider/model/key.
 *
 * Sensitive keys (API keys) are stored encrypted — see configCrypto.ts.
 * Non-sensitive keys (provider name, model names, URLs) are stored plaintext.
 */

import { prisma } from './prisma.js';
import { encrypt, decrypt, isEncrypted } from './configCrypto.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type LlmProvider = 'openrouter' | 'anthropic' | 'local';

export interface LlmConfig {
  provider: LlmProvider;
  anthropicApiKey: string;
  anthropicModel: string;
  openrouterApiKey: string;
  openrouterModel: string;
  localLlmBaseUrl: string;
  localLlmApiKey: string;
  localLlmModel: string;
  localLlmScriptModel: string;
}

// DB keys for each config field
const DB_KEY: Record<keyof LlmConfig, string> = {
  provider:           'llm_provider',
  anthropicApiKey:    'anthropic_api_key',
  anthropicModel:     'anthropic_model',
  openrouterApiKey:   'openrouter_api_key',
  openrouterModel:    'openrouter_model',
  localLlmBaseUrl:    'local_llm_base_url',
  localLlmApiKey:     'local_llm_api_key',
  localLlmModel:      'local_llm_model',
  localLlmScriptModel:'local_llm_script_model',
};

// Which DB keys store encrypted values
const SENSITIVE_DB_KEYS = new Set([
  'anthropic_api_key',
  'openrouter_api_key',
  'local_llm_api_key',
]);

// ── In-memory cache ────────────────────────────────────────────────────────

let _cache: LlmConfig | null = null;

// ── Env-var fallback ───────────────────────────────────────────────────────

function configFromEnv(): LlmConfig {
  return {
    provider:            (process.env.LLM_PROVIDER ?? 'openrouter') as LlmProvider,
    anthropicApiKey:     process.env.ANTHROPIC_API_KEY ?? '',
    anthropicModel:      process.env.ANTHROPIC_MODEL ?? 'claude-opus-4-8',
    openrouterApiKey:    process.env.OPENROUTER_API_KEY ?? '',
    openrouterModel:     process.env.OPENROUTER_MODEL ?? 'anthropic/claude-sonnet-4-5',
    localLlmBaseUrl:     process.env.LOCAL_LLM_BASE_URL ?? '',
    localLlmApiKey:      process.env.LOCAL_LLM_API_KEY ?? '',
    localLlmModel:       process.env.LOCAL_LLM_MODEL ?? '',
    localLlmScriptModel: process.env.LOCAL_LLM_SCRIPT_MODEL ?? '',
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Load config from DB into the in-memory cache.
 * Falls back to env vars if the DB has no SystemConfig rows (e.g. first boot).
 * Also falls back per-key if a value cannot be decrypted (key rotation).
 * Non-fatal: a DB error logs a warning and the cache falls back to env entirely.
 *
 * Call once at startup, and again after every successful saveLlmConfig().
 */
export async function initLlmConfig(): Promise<void> {
  try {
    const rows = await prisma.systemConfig.findMany();
    if (rows.length === 0) {
      _cache = configFromEnv();
      console.log('[llm-config] No DB config — using env vars');
      return;
    }

    const map = new Map(rows.map((r) => [r.key, r.value]));
    const env = configFromEnv();

    function get(dbKey: string, fallback: string): string {
      const raw = map.get(dbKey);
      if (raw === undefined || raw === '') return fallback;
      if (SENSITIVE_DB_KEYS.has(dbKey) && isEncrypted(raw)) {
        try {
          return decrypt(raw);
        } catch {
          console.warn(
            `[llm-config] Could not decrypt "${dbKey}" — CONFIG_ENCRYPTION_KEY may have changed. ` +
            'Falling back to env var for this key.',
          );
          return fallback;
        }
      }
      return raw;
    }

    _cache = {
      provider:            get(DB_KEY.provider, env.provider) as LlmProvider,
      anthropicApiKey:     get(DB_KEY.anthropicApiKey, env.anthropicApiKey),
      anthropicModel:      get(DB_KEY.anthropicModel, env.anthropicModel),
      openrouterApiKey:    get(DB_KEY.openrouterApiKey, env.openrouterApiKey),
      openrouterModel:     get(DB_KEY.openrouterModel, env.openrouterModel),
      localLlmBaseUrl:     get(DB_KEY.localLlmBaseUrl, env.localLlmBaseUrl),
      localLlmApiKey:      get(DB_KEY.localLlmApiKey, env.localLlmApiKey),
      localLlmModel:       get(DB_KEY.localLlmModel, env.localLlmModel),
      localLlmScriptModel: get(DB_KEY.localLlmScriptModel, env.localLlmScriptModel),
    };

    const activeModel =
      _cache.provider === 'anthropic' ? _cache.anthropicModel :
      _cache.provider === 'local'     ? _cache.localLlmModel :
      _cache.openrouterModel;

    console.log(`[llm-config] Loaded from DB — provider: ${_cache.provider}, model: ${activeModel}`);
  } catch (err) {
    _cache = configFromEnv();
    console.warn('[llm-config] DB load failed (non-fatal) — falling back to env vars:', (err as Error).message);
  }
}

/**
 * Returns the current LLM config synchronously.
 * If `initLlmConfig()` has not run yet, falls back to env vars on-the-fly.
 */
export function getCachedLlmConfig(): LlmConfig {
  return _cache ?? configFromEnv();
}

/**
 * Persist a partial config update to DB (encrypting sensitive values),
 * then refresh the in-memory cache so the new config is active immediately.
 *
 * @param update  Partial<LlmConfig> — only the fields you want to change.
 * @param updatedBy  userId of the super-admin making the change (for audit).
 */
export async function saveLlmConfig(
  update: Partial<LlmConfig>,
  updatedBy?: string,
): Promise<void> {
  for (const [field, dbKey] of Object.entries(DB_KEY) as [keyof LlmConfig, string][]) {
    if (!(field in update)) continue;
    const val = (update[field] as string) ?? '';
    const stored = SENSITIVE_DB_KEYS.has(dbKey) ? encrypt(val) : val;
    await prisma.systemConfig.upsert({
      where:  { key: dbKey },
      create: { key: dbKey, value: stored, updatedBy: updatedBy ?? null },
      update: { value: stored, updatedBy: updatedBy ?? null },
    });
  }
  // Refresh cache so the change takes effect immediately
  await initLlmConfig();
}

/**
 * Returns the masked display string for an API key.
 * Empty keys return an empty string; set keys show `...XXXX` (last 4 chars).
 */
export function maskKey(key: string): string {
  if (!key) return '';
  return `...${key.slice(-4)}`;
}
