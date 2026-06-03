import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { setReadOnly } from './safety/read-only.js';
import { parseConfig } from './utils/config.js';
import { campaignTools } from './tools/campaigns.js';
import { RateLimiter } from './utils/rate-limiter.js';
import { AuditLog } from './utils/audit-log.js';
import { TokenManager } from './auth/token-manager.js';
import { DeleteGuard } from './safety/delete-guard.js';
import { AdsError } from './utils/errors.js';
import type { ToolContext } from './tools/register.js';
import type { BaseAdapter } from './adapters/base.js';

// ---------------------------------------------------------------------------
// Shared mock campaign fixture
// ---------------------------------------------------------------------------

const mockCampaign = {
  id: '123',
  platform: 'meta' as const,
  name: 'Test Campaign',
  status: 'active' as const,
  objective: 'conversions' as const,
  budget: { type: 'daily' as const, amount: 50, currency: 'USD' },
  schedule: { start_date: '2026-06-01' },
  created_at: '2026-06-01T00:00:00.000Z',
  updated_at: '2026-06-01T00:00:00.000Z',
};

const mockCreatedCampaign = { ...mockCampaign, id: '456' };

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

function makeMockAdapter(): BaseAdapter {
  return {
    platform: 'meta' as const,
    allowedPlatformOptions: ['special_ad_categories'],

    listCampaigns: vi.fn().mockResolvedValue({ data: [], has_more: false }),
    getCampaign: vi.fn().mockResolvedValue(mockCampaign),
    createCampaign: vi.fn().mockResolvedValue(mockCreatedCampaign),
    updateCampaign: vi.fn().mockResolvedValue(mockCampaign),
    setCampaignStatus: vi.fn().mockResolvedValue(mockCampaign),
    deleteCampaign: vi.fn().mockResolvedValue(undefined),
    cloneCampaign: vi.fn().mockResolvedValue(mockCreatedCampaign),
    getAllActiveCampaignBudgets: vi.fn().mockResolvedValue([50, 100]),

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
  };
}

// ---------------------------------------------------------------------------
// Mock keychain
// ---------------------------------------------------------------------------

function makeMockKeychain() {
  return {
    getPassword: vi.fn().mockResolvedValue('mock-token'),
    setPassword: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Context factory
// ---------------------------------------------------------------------------

function makeCtx(adapter: BaseAdapter): ToolContext {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ads-mcp-audit-'));
  const config = parseConfig({ schema_version: 1 });
  const adapters = new Map<string, BaseAdapter>();
  adapters.set('meta', adapter);

  return {
    adapters,
    rateLimiter: new RateLimiter(),
    auditLog: new AuditLog(tmpDir),
    tokenManager: new TokenManager(makeMockKeychain()),
    deleteGuard: new DeleteGuard(),
    config,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Integration: tool → safety → adapter pipeline', () => {
  let mockAdapter: BaseAdapter;
  let ctx: ToolContext;
  let tools: ReturnType<typeof campaignTools>;

  beforeEach(() => {
    setReadOnly(false);
    mockAdapter = makeMockAdapter();
    ctx = makeCtx(mockAdapter);
    tools = campaignTools(ctx);
  });

  // ─── 1. list_campaigns calls adapter and returns data ────────────────────

  it('list_campaigns calls adapter and returns data', async () => {
    const expected = { data: [mockCampaign], has_more: false };
    vi.mocked(mockAdapter.listCampaigns).mockResolvedValueOnce(expected);

    const result = await tools.list_campaigns({ platform: 'meta', account: 'acc1' });

    expect(result).toEqual(expected);
    expect(mockAdapter.listCampaigns).toHaveBeenCalledTimes(1);
    expect(mockAdapter.listCampaigns).toHaveBeenCalledWith(
      { account: 'acc1', accountMeta: {} },
      { status: undefined },
      20,
      undefined,
    );
  });

  // ─── 2. create_campaign enforces budget guard (BUDGET_EXCEEDED) ──────────

  it('create_campaign enforces budget guard when amount > $100', async () => {
    const input = {
      name: 'Big Spend',
      budget: { type: 'daily', amount: 150, currency: 'USD' },
      schedule: { start_date: '2026-06-01' },
    };

    await expect(
      tools.create_campaign({ platform: 'meta', account: 'acc1', input }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AdsError && err.code === 'BUDGET_EXCEEDED';
    });

    // Adapter must NOT have been called
    expect(mockAdapter.createCampaign).not.toHaveBeenCalled();
  });

  // ─── 3. create_campaign with dry_run returns preview, no adapter call ────

  it('create_campaign with dry_run:true returns preview without calling adapter', async () => {
    const input = {
      name: 'Preview Campaign',
      budget: { type: 'daily', amount: 999, currency: 'USD' },
    };

    const result = await tools.create_campaign({
      platform: 'meta',
      account: 'acc1',
      input,
      dry_run: true,
    }) as Record<string, unknown>;

    expect(result['dry_run']).toBe(true);
    expect(result['preview']).toEqual(input);

    // Budget guard and adapter should never run
    expect(mockAdapter.getAllActiveCampaignBudgets).not.toHaveBeenCalled();
    expect(mockAdapter.createCampaign).not.toHaveBeenCalled();
  });

  // ─── 4. delete_campaign requires confirmation token on first call ─────────

  it('delete_campaign first call returns confirmation_required + token', async () => {
    const result = await tools.delete_campaign({
      platform: 'meta',
      account: 'acc1',
      campaign_id: 'camp-99',
    }) as Record<string, unknown>;

    expect(result['confirmation_required']).toBe(true);
    expect(typeof result['confirmation_token']).toBe('string');
    expect((result['confirmation_token'] as string).length).toBeGreaterThan(0);
    expect(typeof result['summary']).toBe('string');

    // Adapter must NOT have been called yet
    expect(mockAdapter.deleteCampaign).not.toHaveBeenCalled();
  });

  // ─── 5. delete_campaign executes with valid token ────────────────────────

  it('delete_campaign second call with valid token executes delete', async () => {
    // First call — get token
    const first = await tools.delete_campaign({
      platform: 'meta',
      account: 'acc1',
      campaign_id: 'camp-99',
    }) as Record<string, unknown>;

    const token = first['confirmation_token'] as string;

    // Second call — confirm with token
    const result = await tools.delete_campaign({
      platform: 'meta',
      account: 'acc1',
      campaign_id: 'camp-99',
      confirmation_token: token,
    }) as Record<string, unknown>;

    expect(result['deleted']).toBe(true);
    expect(result['campaign_id']).toBe('camp-99');
    expect(mockAdapter.deleteCampaign).toHaveBeenCalledTimes(1);
    expect(mockAdapter.deleteCampaign).toHaveBeenCalledWith(
      { account: 'acc1', accountMeta: {} },
      'camp-99',
    );
  });

  // ─── 6. blocks writes in read-only mode ──────────────────────────────────

  it('blocks create_campaign in read-only mode with READ_ONLY_MODE', async () => {
    setReadOnly(true);

    await expect(
      tools.create_campaign({
        platform: 'meta',
        account: 'acc1',
        input: { name: 'Test', budget: { type: 'daily', amount: 10, currency: 'USD' } },
      }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AdsError && err.code === 'READ_ONLY_MODE';
    });

    expect(mockAdapter.createCampaign).not.toHaveBeenCalled();
  });

  // ─── 7. account velocity guard ───────────────────────────────────────────

  it('throws ACCOUNT_SPEND_LIMIT when existing campaigns sum near the limit', async () => {
    // Default max_account_daily_spend_usd = 500
    // Existing budgets sum to 450; adding 60 → 510 > 500
    vi.mocked(mockAdapter.getAllActiveCampaignBudgets).mockResolvedValueOnce([200, 250]);

    const input = {
      name: 'One More Campaign',
      budget: { type: 'daily', amount: 60, currency: 'USD' },
      schedule: { start_date: '2026-06-01' },
    };

    await expect(
      tools.create_campaign({ platform: 'meta', account: 'acc1', input }),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AdsError && err.code === 'ACCOUNT_SPEND_LIMIT';
    });

    expect(mockAdapter.getAllActiveCampaignBudgets).toHaveBeenCalledTimes(1);
    expect(mockAdapter.createCampaign).not.toHaveBeenCalled();
  });
});
