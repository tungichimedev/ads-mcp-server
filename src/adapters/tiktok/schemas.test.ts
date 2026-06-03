import { describe, it, expect } from 'vitest';
import {
  TikTokResponseSchema,
  TikTokPageInfoSchema,
  TikTokCampaignSchema,
  TikTokAdGroupSchema,
  TikTokAdSchema,
  TikTokMetricsSchema,
} from './schemas.js';

// ─── TikTokResponseSchema ─────────────────────────────────────────────────────

describe('TikTokResponseSchema', () => {
  it('parses a successful response envelope', () => {
    const raw = { code: 0, message: 'OK', request_id: 'abc123' };
    const result = TikTokResponseSchema.parse(raw);
    expect(result.code).toBe(0);
    expect(result.message).toBe('OK');
    expect(result.request_id).toBe('abc123');
  });

  it('parses a response with data payload', () => {
    const raw = { code: 0, message: 'OK', data: { list: [], page_info: {} } };
    const result = TikTokResponseSchema.parse(raw);
    expect(result.data).toBeDefined();
  });

  it('parses an error response (non-zero code)', () => {
    const raw = { code: 40001, message: 'Invalid token' };
    const result = TikTokResponseSchema.parse(raw);
    expect(result.code).toBe(40001);
    expect(result.message).toBe('Invalid token');
  });

  it('allows missing data and request_id (both optional)', () => {
    const raw = { code: 0, message: 'OK' };
    const result = TikTokResponseSchema.parse(raw);
    expect(result.data).toBeUndefined();
    expect(result.request_id).toBeUndefined();
  });

  it('rejects a response missing code', () => {
    expect(() => TikTokResponseSchema.parse({ message: 'OK' })).toThrow();
  });

  it('rejects a response missing message', () => {
    expect(() => TikTokResponseSchema.parse({ code: 0 })).toThrow();
  });
});

// ─── TikTokPageInfoSchema ─────────────────────────────────────────────────────

describe('TikTokPageInfoSchema', () => {
  it('parses valid page info', () => {
    const raw = { total_number: 100, page: 1, page_size: 10, total_page: 10 };
    const result = TikTokPageInfoSchema.parse(raw);
    expect(result.total_number).toBe(100);
    expect(result.page).toBe(1);
    expect(result.page_size).toBe(10);
    expect(result.total_page).toBe(10);
  });

  it('allows missing total_page (optional)', () => {
    const raw = { total_number: 5, page: 1, page_size: 20 };
    const result = TikTokPageInfoSchema.parse(raw);
    expect(result.total_page).toBeUndefined();
  });

  it('rejects when total_number is missing', () => {
    expect(() => TikTokPageInfoSchema.parse({ page: 1, page_size: 10 })).toThrow();
  });
});

// ─── TikTokCampaignSchema ─────────────────────────────────────────────────────

describe('TikTokCampaignSchema', () => {
  const sampleCampaign = {
    campaign_id: '1234567890',
    campaign_name: 'Summer Promo',
    objective_type: 'TRAFFIC',
    budget: 500,
    budget_mode: 'BUDGET_MODE_DAY',
    status: 'CAMPAIGN_STATUS_ENABLE',
    create_time: '2025-01-01 00:00:00',
    modify_time: '2025-01-02 00:00:00',
  };

  it('parses a valid campaign object', () => {
    const result = TikTokCampaignSchema.parse(sampleCampaign);
    expect(result.campaign_id).toBe('1234567890');
    expect(result.campaign_name).toBe('Summer Promo');
    expect(result.objective_type).toBe('TRAFFIC');
    expect(result.budget).toBe(500);
    expect(result.budget_mode).toBe('BUDGET_MODE_DAY');
    expect(result.status).toBe('CAMPAIGN_STATUS_ENABLE');
  });

  it('passes through extra fields (passthrough)', () => {
    const withExtra = { ...sampleCampaign, advertiser_id: 'adv-001', is_new_structure: true };
    const result = TikTokCampaignSchema.parse(withExtra);
    expect((result as Record<string, unknown>)['advertiser_id']).toBe('adv-001');
    expect((result as Record<string, unknown>)['is_new_structure']).toBe(true);
  });

  it('rejects when campaign_id is missing', () => {
    const { campaign_id: _, ...rest } = sampleCampaign;
    expect(() => TikTokCampaignSchema.parse(rest)).toThrow();
  });

  it('rejects when budget is not a number', () => {
    expect(() => TikTokCampaignSchema.parse({ ...sampleCampaign, budget: '500' })).toThrow();
  });
});

// ─── TikTokAdGroupSchema ──────────────────────────────────────────────────────

describe('TikTokAdGroupSchema', () => {
  const sampleAdGroup = {
    adgroup_id: 'ag-001',
    adgroup_name: 'Ad Group 1',
    campaign_id: '1234567890',
    status: 'ADGROUP_STATUS_ENABLE',
    budget: 100,
    budget_mode: 'BUDGET_MODE_DAY',
    bid_price: 2.5,
    bid_type: 'BID_TYPE_CUSTOM',
    create_time: '2025-01-01 00:00:00',
    modify_time: '2025-01-02 00:00:00',
  };

  it('parses a valid ad group with all optional fields', () => {
    const result = TikTokAdGroupSchema.parse(sampleAdGroup);
    expect(result.adgroup_id).toBe('ag-001');
    expect(result.campaign_id).toBe('1234567890');
    expect(result.budget).toBe(100);
    expect(result.bid_price).toBe(2.5);
  });

  it('parses a minimal ad group (optional fields omitted)', () => {
    const minimal = {
      adgroup_id: 'ag-002',
      adgroup_name: 'Minimal',
      campaign_id: '999',
      status: 'ADGROUP_STATUS_DISABLE',
      create_time: '2025-01-01 00:00:00',
      modify_time: '2025-01-01 00:00:00',
    };
    const result = TikTokAdGroupSchema.parse(minimal);
    expect(result.budget).toBeUndefined();
    expect(result.bid_price).toBeUndefined();
  });

  it('passes through extra fields (passthrough)', () => {
    const withExtra = { ...sampleAdGroup, placement_type: 'PLACEMENT_TYPE_NORMAL' };
    const result = TikTokAdGroupSchema.parse(withExtra);
    expect((result as Record<string, unknown>)['placement_type']).toBe('PLACEMENT_TYPE_NORMAL');
  });

  it('rejects when adgroup_id is missing', () => {
    const { adgroup_id: _, ...rest } = sampleAdGroup;
    expect(() => TikTokAdGroupSchema.parse(rest)).toThrow();
  });
});

// ─── TikTokAdSchema ───────────────────────────────────────────────────────────

describe('TikTokAdSchema', () => {
  const sampleAd = {
    ad_id: 'ad-001',
    ad_name: 'My Ad',
    adgroup_id: 'ag-001',
    status: 'AD_STATUS_ENABLE',
    create_time: '2025-01-01 00:00:00',
    modify_time: '2025-01-02 00:00:00',
  };

  it('parses a valid ad object', () => {
    const result = TikTokAdSchema.parse(sampleAd);
    expect(result.ad_id).toBe('ad-001');
    expect(result.ad_name).toBe('My Ad');
    expect(result.adgroup_id).toBe('ag-001');
    expect(result.status).toBe('AD_STATUS_ENABLE');
  });

  it('passes through extra fields (passthrough)', () => {
    const withExtra = { ...sampleAd, call_to_action: 'LEARN_MORE' };
    const result = TikTokAdSchema.parse(withExtra);
    expect((result as Record<string, unknown>)['call_to_action']).toBe('LEARN_MORE');
  });

  it('rejects when ad_id is missing', () => {
    const { ad_id: _, ...rest } = sampleAd;
    expect(() => TikTokAdSchema.parse(rest)).toThrow();
  });

  it('rejects when modify_time is missing', () => {
    const { modify_time: _, ...rest } = sampleAd;
    expect(() => TikTokAdSchema.parse(rest)).toThrow();
  });
});

// ─── TikTokMetricsSchema ──────────────────────────────────────────────────────

describe('TikTokMetricsSchema', () => {
  const sampleMetrics = {
    impressions: '10000',
    clicks: '500',
    spend: '150.25',
    ctr: '5.00',
    cpc: '0.30',
    cpm: '15.02',
    conversions: '20',
    cost_per_conversion: '7.51',
    conversion_rate: '4.00',
  };

  it('parses valid metrics with all optional fields', () => {
    const result = TikTokMetricsSchema.parse(sampleMetrics);
    expect(result.impressions).toBe('10000');
    expect(result.clicks).toBe('500');
    expect(result.spend).toBe('150.25');
    expect(result.ctr).toBe('5.00');
    expect(result.cpc).toBe('0.30');
    expect(result.cpm).toBe('15.02');
    expect(result.conversions).toBe('20');
    expect(result.cost_per_conversion).toBe('7.51');
    expect(result.conversion_rate).toBe('4.00');
  });

  it('parses metrics without optional conversion fields', () => {
    const minimal = {
      impressions: '1000',
      clicks: '50',
      spend: '10.00',
      ctr: '5.00',
      cpc: '0.20',
      cpm: '10.00',
    };
    const result = TikTokMetricsSchema.parse(minimal);
    expect(result.conversions).toBeUndefined();
    expect(result.cost_per_conversion).toBeUndefined();
    expect(result.conversion_rate).toBeUndefined();
  });

  it('all required metric fields are strings (TikTok returns metrics as strings)', () => {
    const result = TikTokMetricsSchema.parse(sampleMetrics);
    expect(typeof result.impressions).toBe('string');
    expect(typeof result.clicks).toBe('string');
    expect(typeof result.spend).toBe('string');
    expect(typeof result.ctr).toBe('string');
    expect(typeof result.cpc).toBe('string');
    expect(typeof result.cpm).toBe('string');
  });

  it('rejects when impressions is not a string', () => {
    expect(() => TikTokMetricsSchema.parse({ ...sampleMetrics, impressions: 10000 })).toThrow();
  });

  it('passes through extra metric fields (passthrough)', () => {
    const withExtra = { ...sampleMetrics, video_play_actions: '800' };
    const result = TikTokMetricsSchema.parse(withExtra);
    expect((result as Record<string, unknown>)['video_play_actions']).toBe('800');
  });
});
