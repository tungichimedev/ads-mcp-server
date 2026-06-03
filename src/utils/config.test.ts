import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseConfig,
  loadConfig,
  getDefaultAccount,
  getAccountMeta,
  DEFAULT_SAFETY_CONFIG,
} from './config.js';

// ---------------------------------------------------------------------------
// parseConfig
// ---------------------------------------------------------------------------

describe('parseConfig', () => {
  it('parses a valid config with all fields', () => {
    const raw = {
      schema_version: 1,
      safety: {
        max_daily_budget_per_campaign_usd: 200,
        max_lifetime_budget_per_campaign_usd: 10000,
        max_account_daily_spend_usd: 1000,
      },
      platforms: {
        meta: {
          default_account: 'my-meta-account',
          accounts: {
            'my-meta-account': { account_id: 'act_123456', currency: 'USD' },
          },
        },
      },
    };

    const config = parseConfig(raw);

    expect(config.schema_version).toBe(1);
    expect(config.safety.max_daily_budget_per_campaign_usd).toBe(200);
    expect(config.safety.max_lifetime_budget_per_campaign_usd).toBe(10000);
    expect(config.safety.max_account_daily_spend_usd).toBe(1000);
    expect(config.platforms?.['meta']?.default_account).toBe('my-meta-account');
    expect(config.platforms?.['meta']?.accounts?.['my-meta-account']?.account_id).toBe('act_123456');
  });

  it('applies default safety values when safety section is missing', () => {
    const raw = { schema_version: 1 };
    const config = parseConfig(raw);

    expect(config.safety.max_daily_budget_per_campaign_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_daily_budget_per_campaign_usd,
    );
    expect(config.safety.max_lifetime_budget_per_campaign_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_lifetime_budget_per_campaign_usd,
    );
    expect(config.safety.max_account_daily_spend_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_account_daily_spend_usd,
    );
  });

  it('applies defaults for partially missing safety fields', () => {
    const raw = {
      schema_version: 1,
      safety: { max_daily_budget_per_campaign_usd: 50 },
    };
    const config = parseConfig(raw);

    expect(config.safety.max_daily_budget_per_campaign_usd).toBe(50);
    expect(config.safety.max_lifetime_budget_per_campaign_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_lifetime_budget_per_campaign_usd,
    );
    expect(config.safety.max_account_daily_spend_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_account_daily_spend_usd,
    );
  });

  it('rejects unknown schema_version (2)', () => {
    const raw = { schema_version: 2 };
    expect(() => parseConfig(raw)).toThrow();
  });

  it('rejects missing schema_version', () => {
    const raw = { safety: {} };
    expect(() => parseConfig(raw)).toThrow();
  });

  it('rejects null input', () => {
    expect(() => parseConfig(null)).toThrow();
  });

  it('rejects non-positive safety budget values', () => {
    const raw = {
      schema_version: 1,
      safety: { max_daily_budget_per_campaign_usd: -10 },
    };
    expect(() => parseConfig(raw)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

describe('loadConfig', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'ads-mcp-test-'));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('loads a valid config.json from the given directory', async () => {
    const raw = {
      schema_version: 1,
      safety: {
        max_daily_budget_per_campaign_usd: 75,
        max_lifetime_budget_per_campaign_usd: 3000,
        max_account_daily_spend_usd: 300,
      },
    };
    await writeFile(join(tmpDir, 'config.json'), JSON.stringify(raw), 'utf-8');

    const config = await loadConfig(tmpDir);
    expect(config.safety.max_daily_budget_per_campaign_usd).toBe(75);
  });

  it('falls back to defaults when config.json does not exist', async () => {
    const config = await loadConfig(tmpDir);

    expect(config.schema_version).toBe(1);
    expect(config.safety.max_daily_budget_per_campaign_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_daily_budget_per_campaign_usd,
    );
    expect(config.safety.max_lifetime_budget_per_campaign_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_lifetime_budget_per_campaign_usd,
    );
    expect(config.safety.max_account_daily_spend_usd).toBe(
      DEFAULT_SAFETY_CONFIG.max_account_daily_spend_usd,
    );
  });

  it('throws when config.json has invalid schema_version', async () => {
    await writeFile(
      join(tmpDir, 'config.json'),
      JSON.stringify({ schema_version: 99 }),
      'utf-8',
    );
    await expect(loadConfig(tmpDir)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// getDefaultAccount
// ---------------------------------------------------------------------------

describe('getDefaultAccount', () => {
  it('returns the default account name for a known platform', () => {
    const config = parseConfig({
      schema_version: 1,
      platforms: { meta: { default_account: 'main-meta' } },
    });
    expect(getDefaultAccount(config, 'meta')).toBe('main-meta');
  });

  it('returns undefined when platform has no default_account', () => {
    const config = parseConfig({
      schema_version: 1,
      platforms: { meta: {} },
    });
    expect(getDefaultAccount(config, 'meta')).toBeUndefined();
  });

  it('returns undefined when platform is not in config', () => {
    const config = parseConfig({ schema_version: 1 });
    expect(getDefaultAccount(config, 'google')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAccountMeta
// ---------------------------------------------------------------------------

describe('getAccountMeta', () => {
  const raw = {
    schema_version: 1,
    platforms: {
      meta: {
        default_account: 'acct-a',
        accounts: {
          'acct-a': { account_id: 'act_111', currency: 'USD', label: 'Main' },
          'acct-b': { account_id: 'act_222' },
        },
      },
    },
  };

  it('returns account metadata for a known platform and account', () => {
    const config = parseConfig(raw);
    const meta = getAccountMeta(config, 'meta', 'acct-a');
    expect(meta?.account_id).toBe('act_111');
    expect(meta?.currency).toBe('USD');
    expect(meta?.label).toBe('Main');
  });

  it('returns account metadata without optional fields', () => {
    const config = parseConfig(raw);
    const meta = getAccountMeta(config, 'meta', 'acct-b');
    expect(meta?.account_id).toBe('act_222');
    expect(meta?.currency).toBeUndefined();
  });

  it('returns undefined for an unknown account', () => {
    const config = parseConfig(raw);
    expect(getAccountMeta(config, 'meta', 'nonexistent')).toBeUndefined();
  });

  it('returns undefined for an unknown platform', () => {
    const config = parseConfig(raw);
    expect(getAccountMeta(config, 'tiktok', 'acct-a')).toBeUndefined();
  });
});
