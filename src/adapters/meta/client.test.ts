import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MetaAdapter } from './client.js';

function mockResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: { get: () => 'application/json' },
  } as unknown as Response;
}

describe('MetaAdapter.createCampaign platform_options forwarding', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ctx = { account: 'themepack', accountMeta: { account_id: '71472870' } } as any;
  let calls: Array<{ url: string; method?: string; body: Record<string, unknown> | undefined }>;

  beforeEach(() => {
    calls = [];
    vi.stubGlobal(
      'fetch',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      vi.fn(async (url: string, opts: any) => {
        const body = opts?.body ? JSON.parse(opts.body) : undefined;
        calls.push({ url: String(url), method: opts?.method, body });
        if (opts?.method === 'POST') return mockResponse({ id: '999' });
        return mockResponse({
          id: '999',
          name: 'PROBE',
          status: 'PAUSED',
          objective: 'OUTCOME_APP_PROMOTION',
          daily_budget: '5000',
          start_time: '2026-06-20',
          created_time: '2026-06-18',
          updated_time: '2026-06-18',
        });
      })
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('forwards special_ad_categories from platform_options into the Meta POST body', async () => {
    const adapter = new MetaAdapter(async () => 'token');
    const input = {
      name: 'PROBE',
      objective: 'app_installs',
      status: 'paused',
      budget: { amount: 50, type: 'daily', currency: 'VND' },
      schedule: { start_date: '2026-06-20' },
      platform_options: { special_ad_categories: [] },
    };
    await adapter.createCampaign(ctx, input);
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/campaigns'));
    expect(post, 'expected a POST to /campaigns').toBeTruthy();
    // special_ad_categories is REQUIRED by Meta on every campaign create.
    expect(post!.body).toHaveProperty('special_ad_categories');
    // The wrapper key must not be forwarded as a raw Meta field.
    expect(post!.body).not.toHaveProperty('platform_options');
  });

  it('updateCampaign converts a VND budget to minor units without x100', async () => {
    const adapter = new MetaAdapter(async () => 'token');
    await adapter.updateCampaign(ctx, '123', {
      budget: { type: 'daily', amount: 200000, currency: 'VND' },
    });
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/123'));
    expect(post, 'expected a POST to /123').toBeTruthy();
    expect(post!.body!['daily_budget']).toBe('200000');
    expect(post!.body).not.toHaveProperty('budget');
  });

  it('sends DELETE with the token in the query string and no body', async () => {
    const adapter = new MetaAdapter(async () => 'token');
    await adapter.deleteCampaign(ctx, '6991580960370');
    const del = calls.find((c) => c.method === 'DELETE');
    expect(del, 'expected a DELETE call').toBeTruthy();
    expect(del!.url).toContain('access_token=token');
    expect(del!.url).toContain('/6991580960370');
    // A JSON body on DELETE makes the Graph API return "API version not supported".
    expect(del!.body).toBeUndefined();
  });

  it('defaults special_ad_categories to [] when no platform_options are given', async () => {
    const adapter = new MetaAdapter(async () => 'token');
    const input = {
      name: 'PROBE',
      objective: 'app_installs',
      status: 'paused',
      budget: { amount: 50, type: 'daily', currency: 'VND' },
      schedule: { start_date: '2026-06-20' },
    };
    await adapter.createCampaign(ctx, input);
    const post = calls.find((c) => c.method === 'POST' && c.url.includes('/campaigns'));
    expect(post!.body).toHaveProperty('special_ad_categories');
    expect(post!.body!['special_ad_categories']).toEqual([]);
  });
});
