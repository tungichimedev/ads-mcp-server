import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TikTokAdapter } from './client.js';
import { AdsError } from '../../utils/errors.js';

// ─── Shared adapter context ───────────────────────────────────────────────────

const ctx = {
  account: 'brand_a',
  accountMeta: { advertiser_id: '7890123456' },
};

// ─── Fetch mock helpers ───────────────────────────────────────────────────────

type MockResponses = Record<string, unknown>;

let savedFetch: typeof globalThis.fetch;

function setupFetchMock(responses: MockResponses) {
  savedFetch = globalThis.fetch;
  globalThis.fetch = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    const parsedUrl = new URL(url);
    const path = parsedUrl.pathname;

    const matchedKey = Object.keys(responses).find((k) => path.includes(k));
    const responseData = matchedKey ? responses[matchedKey] : { code: 0, message: 'OK', data: {} };

    return {
      ok: true,
      json: async () => responseData,
    } as Response;
  });
}

function teardownFetchMock() {
  globalThis.fetch = savedFetch;
}

// ─── Campaign list fixture ────────────────────────────────────────────────────

const campaignListResponse = {
  code: 0,
  message: 'OK',
  data: {
    list: [
      {
        campaign_id: '111',
        campaign_name: 'Test',
        objective_type: 'CONVERSIONS',
        budget: 50,
        budget_mode: 'BUDGET_MODE_DAY',
        status: 'CAMPAIGN_STATUS_ENABLE',
        create_time: '2026-06-01 00:00:00',
        modify_time: '2026-06-01 00:00:00',
      },
    ],
    page_info: {
      total_number: 1,
      page: 1,
      page_size: 20,
      total_page: 1,
    },
  },
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TikTokAdapter — listCampaigns', () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({ '/campaign/get/': campaignListResponse });
  });

  afterEach(() => {
    teardownFetchMock();
  });

  it('returns unified campaigns from list response', async () => {
    const result = await adapter.listCampaigns(ctx as any, {}, 20);

    expect(result.data).toHaveLength(1);
    expect(result.data[0].name).toBe('Test');
    expect(result.data[0].status).toBe('active');
    expect(result.data[0].budget.amount).toBe(50);
    expect(result.data[0].platform).toBe('tiktok');
  });

  it('maps CONVERSIONS objective to unified conversions', async () => {
    const result = await adapter.listCampaigns(ctx as any, {}, 20);
    expect(result.data[0].objective).toBe('conversions');
  });

  it('returns correct pagination info', async () => {
    const result = await adapter.listCampaigns(ctx as any, {}, 20);
    expect(result.pagination?.total).toBe(1);
    expect(result.pagination?.has_next_page).toBe(false);
  });
});

describe('TikTokAdapter — createCampaign', () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({
      '/campaign/create/': {
        code: 0,
        message: 'OK',
        data: { campaign_id: '222' },
      },
      '/campaign/get/': campaignListResponse,
    });
  });

  afterEach(() => {
    teardownFetchMock();
  });

  it('sends POST with required payload fields', async () => {
    await adapter.createCampaign(ctx as any, {
      name: 'New Campaign',
      objective: 'conversions',
      budget: { type: 'daily', amount: 50, currency: 'USD' },
      status: 'paused',
    });

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    const createCall = mockFetch.mock.calls.find(
      ([url]: [string]) => url.includes('/campaign/create/'),
    );
    expect(createCall).toBeDefined();

    const requestInit = createCall![1] as RequestInit;
    expect(requestInit.method).toBe('POST');

    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body['advertiser_id']).toBe('7890123456');
    expect(body['campaign_name']).toBe('New Campaign');
    expect(body['objective_type']).toBe('CONVERSIONS');
    expect(body['budget_mode']).toBe('BUDGET_MODE_DAY');
    expect(body['budget']).toBe(50);
  });
});

describe('TikTokAdapter — deleteCampaign', () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({
      '/campaign/status/update/': { code: 0, message: 'OK', data: {} },
      '/campaign/get/': campaignListResponse,
    });
  });

  afterEach(() => {
    teardownFetchMock();
  });

  it('calls status/update/ with opt_status CAMPAIGN_STATUS_DELETE', async () => {
    await adapter.deleteCampaign(ctx as any, '111');

    const mockFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    const statusCall = mockFetch.mock.calls.find(
      ([url]: [string]) => url.includes('/campaign/status/update/'),
    );
    expect(statusCall).toBeDefined();

    const requestInit = statusCall![1] as RequestInit;
    expect(requestInit.method).toBe('POST');

    const body = JSON.parse(requestInit.body as string) as Record<string, unknown>;
    expect(body['advertiser_id']).toBe('7890123456');
    expect(body['campaign_ids']).toEqual(['111']);
    // TikTok maps 'archived' → 'CAMPAIGN_STATUS_DELETE'
    expect(body['opt_status']).toBe('CAMPAIGN_STATUS_DELETE');
  });
});

describe('TikTokAdapter — getPerformance', () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({
      '/report/integrated/get/': {
        code: 0,
        message: 'OK',
        data: {
          list: [
            {
              metrics: {
                impressions: '1000',
                clicks: '50',
                spend: '25.50',
                ctr: '0.05',
                cpc: '0.51',
                cpm: '25.50',
              },
              dimensions: {
                stat_time_day: '2026-06-01',
              },
            },
          ],
          page_info: { total_number: 1, page: 1, page_size: 20 },
        },
      },
    });
  });

  afterEach(() => {
    teardownFetchMock();
  });

  it('parses string metrics to numbers', async () => {
    const result = await adapter.getPerformance(
      ctx as any,
      'campaign',
      '111',
      { start_date: '2026-06-01', end_date: '2026-06-01' },
      'daily',
    );

    expect(result).toHaveLength(1);
    const metrics = result[0]['metrics'] as Record<string, unknown>;
    expect(metrics['impressions']).toBe(1000);
    expect(metrics['clicks']).toBe(50);
    expect(metrics['spend']).toBe(25.5);
    expect(metrics['ctr']).toBe(0.05);
    expect(metrics['cpc']).toBe(0.51);
    expect(metrics['cpm']).toBe(25.5);
  });
});

describe('TikTokAdapter — getAllActiveCampaignBudgets', () => {
  let adapter: TikTokAdapter;

  beforeEach(() => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({
      '/campaign/get/': {
        code: 0,
        message: 'OK',
        data: {
          list: [
            {
              campaign_id: '111',
              campaign_name: 'Campaign A',
              objective_type: 'CONVERSIONS',
              budget: 50,
              budget_mode: 'BUDGET_MODE_DAY',
              status: 'CAMPAIGN_STATUS_ENABLE',
              create_time: '2026-06-01 00:00:00',
              modify_time: '2026-06-01 00:00:00',
            },
            {
              campaign_id: '222',
              campaign_name: 'Campaign B',
              objective_type: 'TRAFFIC',
              budget: 75,
              budget_mode: 'BUDGET_MODE_DAY',
              status: 'CAMPAIGN_STATUS_ENABLE',
              create_time: '2026-06-01 00:00:00',
              modify_time: '2026-06-01 00:00:00',
            },
          ],
          page_info: { total_number: 2, page: 1, page_size: 200, total_page: 1 },
        },
      },
    });
  });

  afterEach(() => {
    teardownFetchMock();
  });

  it('returns budget amounts as numbers', async () => {
    const result = await adapter.getAllActiveCampaignBudgets(ctx as any);
    expect(result).toEqual([50, 75]);
  });
});

describe('TikTokAdapter — error handling', () => {
  let adapter: TikTokAdapter;

  afterEach(() => {
    teardownFetchMock();
  });

  it('code 40100 → AUTH_EXPIRED', async () => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({
      '/campaign/get/': { code: 40100, message: 'Token expired', data: null },
    });

    await expect(
      adapter.listCampaigns(ctx as any, {}, 20),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AdsError && err.code === 'AUTH_EXPIRED';
    });
  });

  it('code 40002 → RATE_LIMITED', async () => {
    adapter = new TikTokAdapter(async () => 'mock-token');
    setupFetchMock({
      '/campaign/get/': { code: 40002, message: 'Rate limit exceeded', data: null },
    });

    await expect(
      adapter.listCampaigns(ctx as any, {}, 20),
    ).rejects.toSatisfy((err: unknown) => {
      return err instanceof AdsError && err.code === 'RATE_LIMITED';
    });
  });
});
