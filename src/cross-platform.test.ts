import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { setReadOnly } from './safety/read-only.js';
import { parseConfig } from './utils/config.js';
import { campaignTools } from './tools/campaigns.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { AuditLog } from './utils/audit-log.js';
import { TokenManager } from './auth/token-manager.js';
import { DeleteGuard } from './safety/delete-guard.js';
import type { BaseAdapter } from './adapters/base.js';

// ---------------------------------------------------------------------------
// Mock adapter factory
// ---------------------------------------------------------------------------

function makeMockAdapter(platform: string): BaseAdapter {
  return {
    platform: platform as BaseAdapter['platform'],
    allowedPlatformOptions: [],

    listCampaigns: vi.fn().mockResolvedValue({
      data: [
        {
          id: '1',
          platform,
          name: `${platform} Campaign`,
          status: 'active',
          objective: 'conversions',
          budget: { type: 'daily', amount: 50, currency: 'USD' },
          schedule: { start_date: '2026-06-01' },
          created_at: '2026-06-01T00:00:00.000Z',
          updated_at: '2026-06-01T00:00:00.000Z',
        },
      ],
      has_more: false,
    }),
    getCampaign: vi.fn().mockResolvedValue({
      id: '1',
      platform,
      name: `${platform} Campaign`,
      status: 'active',
      objective: 'conversions',
      budget: { type: 'daily', amount: 50, currency: 'USD' },
      schedule: { start_date: '2026-06-01' },
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    }),
    createCampaign: vi.fn().mockResolvedValue({
      id: '2',
      platform,
      name: 'New',
      status: 'paused',
      objective: 'conversions',
      budget: { type: 'daily', amount: 50, currency: 'USD' },
      schedule: { start_date: '2026-06-01' },
      created_at: '2026-06-01T00:00:00.000Z',
      updated_at: '2026-06-01T00:00:00.000Z',
    }),
    updateCampaign: vi.fn().mockResolvedValue({}),
    setCampaignStatus: vi.fn().mockResolvedValue({}),
    deleteCampaign: vi.fn().mockResolvedValue(undefined),
    cloneCampaign: vi.fn().mockResolvedValue({}),
    getAllActiveCampaignBudgets: vi.fn().mockResolvedValue([50]),

    listAdSets: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    getAdSet: vi.fn().mockResolvedValue({}),
    createAdSet: vi.fn().mockResolvedValue({}),
    updateAdSet: vi.fn().mockResolvedValue({}),
    setAdSetStatus: vi.fn().mockResolvedValue({}),
    deleteAdSet: vi.fn().mockResolvedValue(undefined),

    listAds: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    getAd: vi.fn().mockResolvedValue({}),
    createAd: vi.fn().mockResolvedValue({}),
    updateAd: vi.fn().mockResolvedValue({}),
    deleteAd: vi.fn().mockResolvedValue(undefined),

    uploadCreative: vi.fn().mockResolvedValue({ creative_id: 'c1', url: 'https://example.com' }),
    uploadAudienceFile: vi.fn().mockResolvedValue({ uploaded_file_id: 'f1' }),

    listAudiences: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    createAudience: vi.fn().mockResolvedValue({}),
    updateAudience: vi.fn().mockResolvedValue({}),
    getAudienceSize: vi.fn().mockResolvedValue({ estimated_reach: 1000 }),

    getPerformance: vi.fn().mockResolvedValue([]),
    getInsights: vi.fn().mockResolvedValue([]),

    getBudget: vi.fn().mockResolvedValue({}),
    getAllActiveBudgets: vi.fn().mockResolvedValue([]),

    listRules: vi.fn().mockResolvedValue([]),
    createRule: vi.fn().mockResolvedValue({}),
    updateRule: vi.fn().mockResolvedValue({}),
    deleteRule: vi.fn().mockResolvedValue(undefined),
    getRuleHistory: vi.fn().mockResolvedValue([]),

    listPixels: vi.fn().mockResolvedValue([]),
    getPixelStatus: vi.fn().mockResolvedValue({}),
    listConversionEvents: vi.fn().mockResolvedValue([]),
    getEventMatchQuality: vi.fn().mockResolvedValue({}),
    validateTrackingUrls: vi.fn().mockResolvedValue([]),

    getAccountHealth: vi.fn().mockResolvedValue({}),
  } as unknown as BaseAdapter;
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

function makeCtx(adapters: Map<string, BaseAdapter>) {
  // ConfigSchema requires account_id in AccountMetaSchema — include it alongside
  // platform-specific fields so validation passes.
  const config = parseConfig({
    schema_version: 1,
    platforms: {
      meta: {
        default_account: 'a',
        accounts: {
          a: { account_id: 'act_1' },
        },
      },
      google: {
        default_account: 'a',
        accounts: {
          a: { account_id: '123' },
        },
      },
      tiktok: {
        default_account: 'a',
        accounts: {
          a: { account_id: '456' },
        },
      },
    },
  });

  const mockKeychain = {
    getPassword: vi.fn().mockResolvedValue('mock-token'),
    setPassword: vi.fn().mockResolvedValue(undefined),
  };

  const logDir = mkdtempSync(join(tmpdir(), 'ads-cross-'));

  return campaignTools({
    adapters,
    rateLimiter: new RateLimiter(),
    auditLog: new AuditLog(logDir),
    tokenManager: new TokenManager(mockKeychain as any),
    deleteGuard: new DeleteGuard(),
    config,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Cross-Platform: all 3 platforms through unified tool layer', () => {
  let tools: ReturnType<typeof campaignTools>;

  beforeEach(() => {
    setReadOnly(false);
    const adapters = new Map<string, BaseAdapter>([
      ['meta', makeMockAdapter('meta')],
      ['google', makeMockAdapter('google')],
      ['tiktok', makeMockAdapter('tiktok')],
    ]);
    tools = makeCtx(adapters);
  });

  // ─── 1. list_campaigns ───────────────────────────────────────────────────

  it('list_campaigns works for all 3 platforms', async () => {
    for (const platform of ['meta', 'google', 'tiktok']) {
      const result = await tools.list_campaigns({ platform }) as { data: Array<Record<string, unknown>> };
      expect(result.data).toHaveLength(1);
      expect(result.data[0]['platform']).toBe(platform);
    }
  });

  // ─── 2. create_campaign ──────────────────────────────────────────────────

  it('create_campaign works for all 3 platforms', async () => {
    for (const platform of ['meta', 'google', 'tiktok']) {
      const result = await tools.create_campaign({
        platform,
        input: {
          name: 'Test',
          objective: 'conversions',
          budget: { type: 'daily', amount: 50, currency: 'USD' },
          schedule: { start_date: '2026-06-01' },
        },
      }) as Record<string, unknown>;
      expect(result['id']).toBe('2');
    }
  });

  // ─── 3. rejects unknown platform ─────────────────────────────────────────

  it('rejects unknown platform', async () => {
    await expect(
      tools.list_campaigns({ platform: 'twitter' }),
    ).rejects.toThrow();
  });

  // ─── 4. delete with confirmation for all platforms ────────────────────────

  it('delete works with confirmation for all platforms', async () => {
    for (const platform of ['meta', 'google', 'tiktok']) {
      // Step 1: request delete — should require confirmation
      const step1 = await tools.delete_campaign({
        platform,
        campaign_id: '1',
      }) as Record<string, unknown>;

      expect(step1['confirmation_required']).toBe(true);
      expect(typeof step1['confirmation_token']).toBe('string');

      // Step 2: confirm with token
      const step2 = await tools.delete_campaign({
        platform,
        campaign_id: '1',
        confirmation_token: step1['confirmation_token'] as string,
      }) as Record<string, unknown>;

      expect(step2['deleted']).toBe(true);
    }
  });

  // ─── 5. list_campaigns returns correct platform field ────────────────────

  it('each platform returns its own platform identifier in results', async () => {
    const platforms = ['meta', 'google', 'tiktok'];
    const results = await Promise.all(
      platforms.map((p) => tools.list_campaigns({ platform: p }) as Promise<{ data: Array<Record<string, unknown>> }>),
    );

    for (let i = 0; i < platforms.length; i++) {
      expect(results[i].data[0]['platform']).toBe(platforms[i]);
    }
  });
});
