import { z } from 'zod';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Safety config
// ---------------------------------------------------------------------------

export interface SafetyConfig {
  max_daily_budget_per_campaign_usd: number;
  max_lifetime_budget_per_campaign_usd: number;
  max_account_daily_spend_usd: number;
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  max_daily_budget_per_campaign_usd: 100,
  max_lifetime_budget_per_campaign_usd: 5000,
  max_account_daily_spend_usd: 500,
};

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const SafetyConfigSchema = z.object({
  max_daily_budget_per_campaign_usd: z.number().positive().default(DEFAULT_SAFETY_CONFIG.max_daily_budget_per_campaign_usd),
  max_lifetime_budget_per_campaign_usd: z.number().positive().default(DEFAULT_SAFETY_CONFIG.max_lifetime_budget_per_campaign_usd),
  max_account_daily_spend_usd: z.number().positive().default(DEFAULT_SAFETY_CONFIG.max_account_daily_spend_usd),
});

const AccountMetaSchema = z.object({
  account_id: z.string(),
  // TikTok identifies ad accounts by `advertiser_id`. Optional here; when
  // omitted the TikTok adapter falls back to `account_id`.
  advertiser_id: z.string().optional(),
  // Google Ads identifies accounts by `customer_id`, with `login_customer_id`
  // being the manager (MCC) account. Both optional; the Google adapter falls
  // back to `account_id` for the customer id.
  customer_id: z.string().optional(),
  login_customer_id: z.string().optional(),
  currency: z.string().length(3).optional(),
  label: z.string().optional(),
});
export type AccountMeta = z.infer<typeof AccountMetaSchema>;

const PlatformConfigSchema = z.object({
  default_account: z.string().optional(),
  accounts: z.record(z.string(), AccountMetaSchema).optional(),
});

const ConfigSchema = z.object({
  schema_version: z.literal(1),
  safety: SafetyConfigSchema.optional(),
  platforms: z.record(z.string(), PlatformConfigSchema).optional(),
});

export type AdsConfig = z.infer<typeof ConfigSchema> & {
  safety: SafetyConfig;
};

// ---------------------------------------------------------------------------
// parseConfig
// ---------------------------------------------------------------------------

/**
 * Validates and parses a raw config object.
 * Throws if schema_version !== 1 or if the schema is invalid.
 * Applies safety defaults for any missing safety fields.
 */
export function parseConfig(raw: unknown): AdsConfig {
  // Check schema_version before full parse so the error message is clear.
  if (
    typeof raw !== 'object' ||
    raw === null ||
    (raw as Record<string, unknown>)['schema_version'] !== 1
  ) {
    throw new Error(
      `Unsupported or missing schema_version. Expected schema_version: 1, got: ${
        typeof raw === 'object' && raw !== null
          ? String((raw as Record<string, unknown>)['schema_version'])
          : String(raw)
      }`,
    );
  }

  const parsed = ConfigSchema.parse(raw);

  return {
    ...parsed,
    safety: {
      max_daily_budget_per_campaign_usd:
        parsed.safety?.max_daily_budget_per_campaign_usd ??
        DEFAULT_SAFETY_CONFIG.max_daily_budget_per_campaign_usd,
      max_lifetime_budget_per_campaign_usd:
        parsed.safety?.max_lifetime_budget_per_campaign_usd ??
        DEFAULT_SAFETY_CONFIG.max_lifetime_budget_per_campaign_usd,
      max_account_daily_spend_usd:
        parsed.safety?.max_account_daily_spend_usd ??
        DEFAULT_SAFETY_CONFIG.max_account_daily_spend_usd,
    },
  };
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

const FALLBACK_CONFIG: AdsConfig = {
  schema_version: 1,
  safety: { ...DEFAULT_SAFETY_CONFIG },
};

/**
 * Loads config from Google Cloud Secret Manager (`ads-mcp-config` secret).
 * Used when running on Cloud Run (detected via K_SERVICE env var).
 * Returns FALLBACK_CONFIG on any error so the server can still start.
 */
async function loadConfigFromSecret(): Promise<AdsConfig> {
  try {
    // Dynamic import — package installed at deploy time, not at dev time.
    const mod = await import('@google-cloud/secret-manager' as string);
    const { SecretManagerServiceClient } = mod;
    const client = new SecretManagerServiceClient();
    // Use the resolved project id (from the metadata server on Cloud Run); the
    // `projects/-` wildcard fails with PERMISSION_DENIED (no quota project).
    const projectId = await client.getProjectId();
    const [version] = await client.accessSecretVersion({
      name: `projects/${projectId}/secrets/ads-mcp-config/versions/latest`,
    });
    const payload = version.payload?.data;
    if (!payload) {
      return FALLBACK_CONFIG;
    }
    const text =
      typeof payload === 'string'
        ? payload
        : new TextDecoder().decode(payload as Uint8Array);
    return parseConfig(JSON.parse(text));
  } catch (err) {
    process.stderr.write(`Warning: failed to load config from Secret Manager: ${err instanceof Error ? err.message : String(err)}. Using defaults.\n`);
    return FALLBACK_CONFIG;
  }
}

/**
 * Reads `config.json` from basePath and parses it.
 * Falls back to FALLBACK_CONFIG if the file does not exist.
 *
 * When running on Cloud Run (K_SERVICE env var set), loads config from
 * Google Cloud Secret Manager instead of the filesystem.
 */
export async function loadConfig(basePath: string): Promise<AdsConfig> {
  // On Cloud Run, load from Secret Manager instead of filesystem.
  if (process.env['K_SERVICE']) {
    return loadConfigFromSecret();
  }

  const configPath = join(basePath, 'config.json');
  let raw: unknown;

  try {
    const text = await readFile(configPath, 'utf-8');
    raw = JSON.parse(text);
  } catch (err: unknown) {
    // File not found → use defaults
    if (isNodeError(err) && err.code === 'ENOENT') {
      return FALLBACK_CONFIG;
    }
    throw err;
  }

  return parseConfig(raw);
}

/**
 * Writes the config to `<basePath>/config.json` as pretty-printed JSON.
 * Local-only — not supported on Cloud Run (Secret Manager is read-only here).
 */
export async function saveConfig(basePath: string, config: AdsConfig): Promise<void> {
  const configPath = join(basePath, 'config.json');
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

/**
 * Returns the default account name for a given platform, or undefined if none.
 */
export function getDefaultAccount(config: AdsConfig, platform: string): string | undefined {
  return config.platforms?.[platform]?.default_account;
}

/**
 * Returns account metadata for a given platform + account name, or undefined if not found.
 */
export function getAccountMeta(
  config: AdsConfig,
  platform: string,
  account: string,
): AccountMeta | undefined {
  return config.platforms?.[platform]?.accounts?.[account];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isNodeError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err;
}
