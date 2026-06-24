import { vi } from 'vitest';
import { parseConfig } from '../utils/config.js';
import { mapAdvertisers, probeCampaignScope } from './tiktok-mapping.js';

const config = parseConfig({
  schema_version: 1,
  platforms: {
    tiktok: {
      accounts: {
        themepack: { account_id: '600', advertiser_id: '600', label: 'ThemePack' },
        legacy: { account_id: '700', label: 'Legacy (no advertiser_id)' },
      },
    },
  },
});

describe('mapAdvertisers', () => {
  it('matches by advertiser_id and falls back to account_id', () => {
    const r = mapAdvertisers(config, ['600', '700', '999']);
    expect(r.matched).toContainEqual({ advertiserId: '600', accountName: 'themepack' });
    expect(r.matched).toContainEqual({ advertiserId: '700', accountName: 'legacy' });
    expect(r.unknown).toEqual(['999']);
  });
});

describe('probeCampaignScope', () => {
  it('returns true when campaign/get succeeds', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'OK', data: { list: [] } }), { status: 200 },
    )) as unknown as typeof globalThis.fetch;
    expect(await probeCampaignScope(fetchFn, 'tok', '600')).toBe(true);
  });

  it('returns false on 40001 scope error', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ code: 40001, message: 'lacks scope', data: {} }), { status: 200 },
    )) as unknown as typeof globalThis.fetch;
    expect(await probeCampaignScope(fetchFn, 'tok', '600')).toBe(false);
  });

  it('sends the Access-Token header and advertiser_id query', async () => {
    const fetchFn = vi.fn(async () => new Response(
      JSON.stringify({ code: 0, message: 'OK', data: {} }), { status: 200 },
    )) as unknown as typeof globalThis.fetch;
    await probeCampaignScope(fetchFn, 'tok123', '600');
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(call[0])).toContain('advertiser_id=600');
    expect((call[1] as RequestInit).headers).toMatchObject({ 'Access-Token': 'tok123' });
  });
});
