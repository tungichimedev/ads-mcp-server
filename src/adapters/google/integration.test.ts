import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GoogleAdapter } from './client.js';

// ─── Mock google-ads-node customer object ────────────────────────────────────

function createMockCustomer() {
  return {
    query: vi.fn(),
    campaigns: { create: vi.fn(), update: vi.fn() },
    campaignBudgets: {
      create: vi.fn().mockResolvedValue({
        resource_name: 'customers/123/campaignBudgets/456',
      }),
    },
    adGroups: { create: vi.fn(), update: vi.fn() },
    adGroupAds: { create: vi.fn(), update: vi.fn() },
    adGroupCriteria: { create: vi.fn(), remove: vi.fn() },
  };
}

const mockClient = { Customer: vi.fn() };

// ─── Shared setup ────────────────────────────────────────────────────────────

const ctx = {
  account: 'brand_a',
  accountMeta: { customer_id: '123-456-7890' },
};

let adapter: GoogleAdapter;
let mockCustomer: ReturnType<typeof createMockCustomer>;

beforeEach(() => {
  mockCustomer = createMockCustomer();
  // getClient returns the customer directly (not mockClient.Customer())
  adapter = new GoogleAdapter(async () => mockCustomer as any);
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GoogleAdapter — listCampaigns', () => {
  it('executes GAQL and returns unified campaigns', async () => {
    mockCustomer.query.mockResolvedValue([
      {
        campaign: {
          id: '111',
          name: 'Test',
          status: 'ENABLED',
          advertising_channel_type: 'SEARCH',
          start_date: '2024-01-01',
        },
        campaign_budget: {
          amount_micros: '50000000',
          period: 'DAILY',
        },
      },
    ]);

    const result = await adapter.listCampaigns(ctx as any, {}, 10);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test');
    expect(result.data[0].status).toBe('active');
    expect(result.data[0].budget.amount).toBe(50);
    expect(result.data[0].channel).toBe('search');
  });
});

describe('GoogleAdapter — createCampaign', () => {
  it('creates budget first then campaign', async () => {
    // getCampaign is called after create — mock the query it issues
    mockCustomer.query.mockResolvedValue([
      {
        campaign: {
          id: '999',
          name: 'Brand Campaign',
          status: 'PAUSED',
          advertising_channel_type: 'SEARCH',
          start_date: '2024-01-01',
        },
        campaign_budget: {
          amount_micros: '100000000',
          period: 'DAILY',
        },
      },
    ]);

    mockCustomer.campaigns.create.mockResolvedValue({
      resource_name: 'customers/1234567890/campaigns/999',
    });

    await adapter.createCampaign(ctx as any, {
      name: 'Brand Campaign',
      status: 'paused',
      objective: 'traffic',
      channel: 'search',
      budget: { amount: 100, type: 'daily' },
    });

    // Budget created first with correct micros ($100 → 100_000_000)
    expect(mockCustomer.campaignBudgets.create).toHaveBeenCalledTimes(1);
    const budgetArg = mockCustomer.campaignBudgets.create.mock.calls[0][0] as Record<string, unknown>;
    expect(budgetArg['amount_micros']).toBe(100_000_000);

    // Campaign created with correct channel type
    expect(mockCustomer.campaigns.create).toHaveBeenCalledTimes(1);
    const campaignArg = mockCustomer.campaigns.create.mock.calls[0][0] as Record<string, unknown>;
    expect(campaignArg['advertising_channel_type']).toBe('SEARCH');
  });
});

describe('GoogleAdapter — deleteCampaign', () => {
  it('sets campaign status to REMOVED', async () => {
    mockCustomer.campaigns.update.mockResolvedValue({});

    await adapter.deleteCampaign(ctx as any, '42');

    expect(mockCustomer.campaigns.update).toHaveBeenCalledTimes(1);
    const arg = mockCustomer.campaigns.update.mock.calls[0][0] as Record<string, unknown>;
    expect(arg['status']).toBe('REMOVED');
    expect(String(arg['resource_name'])).toContain('/campaigns/42');
  });
});

describe('GoogleAdapter — getAllActiveCampaignBudgets', () => {
  it('returns daily amounts in dollars converted from micros', async () => {
    mockCustomer.query.mockResolvedValue([
      { campaign_budget: { amount_micros: '50000000', period: 'DAILY' } },
      { campaign_budget: { amount_micros: '30000000', period: 'DAILY' } },
    ]);

    const result = await adapter.getAllActiveCampaignBudgets(ctx as any);

    expect(result).toEqual([50, 30]);
  });
});

describe('GoogleAdapter — error handling', () => {
  it('maps RATE_EXCEEDED to RATE_LIMITED error code', async () => {
    mockCustomer.query.mockRejectedValue(new Error('RATE_EXCEEDED: quota exhausted'));

    await expect(
      adapter.listCampaigns(ctx as any, {}, 10),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('maps AUTHENTICATION_ERROR to AUTH_EXPIRED error code', async () => {
    mockCustomer.query.mockRejectedValue(new Error('AUTHENTICATION_ERROR: invalid credentials'));

    await expect(
      adapter.listCampaigns(ctx as any, {}, 10),
    ).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
  });
});

describe('GoogleAdapter — getPerformance', () => {
  it('returns unified metrics with micros converted to dollars', async () => {
    mockCustomer.query.mockResolvedValue([
      {
        metrics: {
          impressions: '1000',
          clicks: '50',
          cost_micros: '25000000',
          ctr: 0.05,
          average_cpc: '500000',
          conversions: '5',
          cost_per_conversion: '5000000',
          conversions_value: '100',
        },
        segments: { date: '2024-01-15' },
      },
    ]);

    const result = await adapter.getPerformance(
      ctx as any,
      'campaign',
      '111',
      { start_date: '2024-01-15', end_date: '2024-01-15' },
      'daily',
    );

    expect(result).toHaveLength(1);
    expect(result[0]['spend']).toBe(25);      // 25_000_000 micros → $25
    expect(result[0]['cpc']).toBe(0.5);        // 500_000 micros → $0.5
    expect(result[0]['impressions']).toBe(1000);
    expect(result[0]['clicks']).toBe(50);
  });
});
