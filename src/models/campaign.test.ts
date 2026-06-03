import { describe, it, expect } from 'vitest';
import { UnifiedCampaignSchema, CreateCampaignInputSchema } from './campaign.js';

const validCampaignBase = {
  platform: 'meta' as const,
  name: 'Summer Sale 2025',
  status: 'active' as const,
  objective: 'conversions' as const,
  budget: {
    type: 'daily' as const,
    amount: 100,
    currency: 'USD',
  },
  schedule: {
    start_date: '2025-06-01',
    end_date: '2025-06-30',
  },
};

const validCampaign = {
  id: 'campaign-001',
  ...validCampaignBase,
  created_at: '2025-05-01T00:00:00Z',
  updated_at: '2025-05-01T00:00:00Z',
};

describe('UnifiedCampaignSchema', () => {
  it('accepts a valid campaign', () => {
    const result = UnifiedCampaignSchema.safeParse(validCampaign);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe('campaign-001');
      expect(result.data.platform).toBe('meta');
      expect(result.data.budget.amount).toBe(100);
    }
  });

  it('accepts a campaign with platform_data (read-only field)', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      platform_data: { meta_campaign_id: 'act_12345', special_ad_categories: [] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platform_data).toBeDefined();
    }
  });

  it('rejects an invalid platform', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      platform: 'snapchat',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const platformError = result.error.issues.find((i) => i.path.includes('platform'));
      expect(platformError).toBeDefined();
    }
  });

  it('rejects a negative budget amount', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      budget: { type: 'daily', amount: -50, currency: 'USD' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const budgetError = result.error.issues.find((i) => i.path.includes('amount'));
      expect(budgetError).toBeDefined();
    }
  });

  it('rejects a zero budget amount', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      budget: { type: 'daily', amount: 0, currency: 'USD' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects end_date before start_date', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      schedule: { start_date: '2025-06-30', end_date: '2025-06-01' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const scheduleError = result.error.issues.find((i) => i.path.includes('end_date'));
      expect(scheduleError).toBeDefined();
      expect(scheduleError?.message).toContain('end_date must be after start_date');
    }
  });

  it('rejects end_date equal to start_date', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      schedule: { start_date: '2025-06-01', end_date: '2025-06-01' },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a campaign without end_date', () => {
    const result = UnifiedCampaignSchema.safeParse({
      ...validCampaign,
      schedule: { start_date: '2025-06-01' },
    });
    expect(result.success).toBe(true);
  });
});

describe('CreateCampaignInputSchema', () => {
  it('accepts valid create input', () => {
    const result = CreateCampaignInputSchema.safeParse(validCampaignBase);
    expect(result.success).toBe(true);
  });

  it('strips (rejects) platform_data on write input due to .strict()', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      platform_data: { meta_campaign_id: 'act_12345' },
    });
    // .strict() means extra keys cause a parse failure
    expect(result.success).toBe(false);
    if (!result.success) {
      const unrecognizedError = result.error.issues.find(
        (i) => i.code === 'unrecognized_keys'
      );
      expect(unrecognizedError).toBeDefined();
    }
  });

  it('rejects invalid platform', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      platform: 'pinterest',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative budget', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      budget: { type: 'daily', amount: -1, currency: 'USD' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path.includes('amount'));
      expect(err).toBeDefined();
    }
  });

  it('rejects end_date before start_date', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      schedule: { start_date: '2025-12-31', end_date: '2025-01-01' },
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      const err = result.error.issues.find((i) => i.path.includes('end_date'));
      expect(err).toBeDefined();
    }
  });

  it('rejects id field (not in create schema)', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      id: 'should-be-rejected',
    });
    expect(result.success).toBe(false);
  });

  it('rejects created_at field (not in create schema)', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      created_at: '2025-01-01T00:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional channel field', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      channel: 'search',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.channel).toBe('search');
    }
  });

  it('rejects invalid channel value', () => {
    const result = CreateCampaignInputSchema.safeParse({
      ...validCampaignBase,
      channel: 'unknown_channel',
    });
    expect(result.success).toBe(false);
  });
});
