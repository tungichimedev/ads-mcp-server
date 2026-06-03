import { describe, it, expect } from 'vitest';
import {
  toGoogleCampaignType,
  fromGoogleCampaignType,
  toGoogleStatus,
  fromGoogleStatus,
  baseToMicros,
  microsToBase,
  toGoogleCampaign,
  fromGoogleCampaign,
  type GoogleCampaign,
} from './mapper.js';
import type { UnifiedCampaign } from '../../models/campaign.js';
import type { Objective, Channel, Status } from '../../models/platform.js';

// ─── Campaign type mapping ────────────────────────────────────────────────────

describe('toGoogleCampaignType', () => {
  it('maps channel=search to SEARCH (channel takes precedence over objective)', () => {
    expect(toGoogleCampaignType('awareness', 'search')).toBe('SEARCH');
  });

  it('maps channel=display to DISPLAY', () => {
    expect(toGoogleCampaignType('traffic', 'display')).toBe('DISPLAY');
  });

  it('maps channel=shopping to SHOPPING', () => {
    expect(toGoogleCampaignType('leads', 'shopping')).toBe('SHOPPING');
  });

  it('maps channel=video to VIDEO', () => {
    expect(toGoogleCampaignType('awareness', 'video')).toBe('VIDEO');
  });

  it('maps channel=app to APP', () => {
    expect(toGoogleCampaignType('traffic', 'app')).toBe('APP');
  });

  it('maps channel=performance_max to PERFORMANCE_MAX', () => {
    expect(toGoogleCampaignType('conversions', 'performance_max')).toBe('PERFORMANCE_MAX');
  });

  // Objective-only inference (no channel)
  it('infers DISPLAY from objective=awareness when no channel', () => {
    expect(toGoogleCampaignType('awareness')).toBe('DISPLAY');
  });

  it('infers SEARCH from objective=traffic when no channel', () => {
    expect(toGoogleCampaignType('traffic')).toBe('SEARCH');
  });

  it('infers VIDEO from objective=engagement when no channel', () => {
    expect(toGoogleCampaignType('engagement')).toBe('VIDEO');
  });

  it('infers SEARCH from objective=leads when no channel', () => {
    expect(toGoogleCampaignType('leads')).toBe('SEARCH');
  });

  it('infers APP from objective=app_installs when no channel', () => {
    expect(toGoogleCampaignType('app_installs')).toBe('APP');
  });

  it('infers SEARCH from objective=conversions when no channel', () => {
    expect(toGoogleCampaignType('conversions')).toBe('SEARCH');
  });

  it('infers SHOPPING from objective=sales when no channel', () => {
    expect(toGoogleCampaignType('sales')).toBe('SHOPPING');
  });

  it('infers VIDEO from objective=video_views when no channel', () => {
    expect(toGoogleCampaignType('video_views')).toBe('VIDEO');
  });

  it('throws for unknown objective (guard against bad casts)', () => {
    expect(() => toGoogleCampaignType('unknown_objective' as Objective)).toThrow();
  });
});

describe('fromGoogleCampaignType', () => {
  it('maps SEARCH → { objective: traffic, channel: search }', () => {
    expect(fromGoogleCampaignType('SEARCH')).toEqual({ objective: 'traffic', channel: 'search' });
  });

  it('maps DISPLAY → { objective: awareness, channel: display }', () => {
    expect(fromGoogleCampaignType('DISPLAY')).toEqual({ objective: 'awareness', channel: 'display' });
  });

  it('maps SHOPPING → { objective: sales, channel: shopping }', () => {
    expect(fromGoogleCampaignType('SHOPPING')).toEqual({ objective: 'sales', channel: 'shopping' });
  });

  it('maps VIDEO → { objective: video_views, channel: video }', () => {
    expect(fromGoogleCampaignType('VIDEO')).toEqual({ objective: 'video_views', channel: 'video' });
  });

  it('maps APP → { objective: app_installs, channel: app }', () => {
    expect(fromGoogleCampaignType('APP')).toEqual({ objective: 'app_installs', channel: 'app' });
  });

  it('maps PERFORMANCE_MAX → { objective: conversions, channel: performance_max }', () => {
    expect(fromGoogleCampaignType('PERFORMANCE_MAX')).toEqual({ objective: 'conversions', channel: 'performance_max' });
  });

  it('falls back to { conversions, search } for unknown campaign type', () => {
    expect(fromGoogleCampaignType('UNKNOWN_FUTURE_TYPE')).toEqual({ objective: 'conversions', channel: 'search' });
  });
});

describe('Campaign type round-trips', () => {
  const channelCases: Channel[] = ['search', 'display', 'shopping', 'video', 'app', 'performance_max'];

  for (const channel of channelCases) {
    it(`round-trips channel=${channel} through Google campaign type`, () => {
      // Use a neutral objective — channel wins
      const googleType = toGoogleCampaignType('conversions', channel);
      const { channel: backChannel } = fromGoogleCampaignType(googleType);
      expect(backChannel).toBe(channel);
    });
  }

  it('SEARCH round-trip preserves channel', () => {
    const { channel } = fromGoogleCampaignType(toGoogleCampaignType('traffic', 'search'));
    expect(channel).toBe('search');
  });

  it('PERFORMANCE_MAX round-trip preserves channel', () => {
    const { channel } = fromGoogleCampaignType(toGoogleCampaignType('conversions', 'performance_max'));
    expect(channel).toBe('performance_max');
  });

  it('SHOPPING round-trip preserves channel', () => {
    const { channel } = fromGoogleCampaignType(toGoogleCampaignType('sales', 'shopping'));
    expect(channel).toBe('shopping');
  });
});

// ─── Status round-trips ───────────────────────────────────────────────────────

describe('Status mapping', () => {
  const allStatuses: Status[] = ['active', 'paused', 'archived', 'draft'];

  it('toGoogleStatus returns a non-empty string for every unified status', () => {
    for (const s of allStatuses) {
      expect(toGoogleStatus(s).length).toBeGreaterThan(0);
    }
  });

  it('round-trips active → ENABLED → active', () => {
    expect(fromGoogleStatus(toGoogleStatus('active'))).toBe('active');
  });

  it('round-trips paused → PAUSED → paused', () => {
    expect(fromGoogleStatus(toGoogleStatus('paused'))).toBe('paused');
  });

  it('round-trips archived → REMOVED → archived', () => {
    expect(fromGoogleStatus(toGoogleStatus('archived'))).toBe('archived');
  });

  it('maps draft to PAUSED (Google has no draft status)', () => {
    expect(toGoogleStatus('draft')).toBe('PAUSED');
  });

  it('maps Google REMOVED back to archived', () => {
    expect(fromGoogleStatus('REMOVED')).toBe('archived');
  });

  it('falls back to paused for unknown Google status', () => {
    expect(fromGoogleStatus('UNKNOWN_STATUS')).toBe('paused');
  });

  it('throws for unknown unified status (guard against bad casts)', () => {
    expect(() => toGoogleStatus('unknown_status' as Status)).toThrow();
  });
});

// ─── Budget micros ────────────────────────────────────────────────────────────

describe('Budget micros conversion', () => {
  it('converts $1.00 to 1,000,000 micros', () => {
    expect(baseToMicros(1)).toBe(1_000_000);
  });

  it('converts $10.50 to 10,500,000 micros', () => {
    expect(baseToMicros(10.50)).toBe(10_500_000);
  });

  it('converts $0.01 to 10,000 micros', () => {
    expect(baseToMicros(0.01)).toBe(10_000);
  });

  it('converts 1,000,000 micros back to $1.00', () => {
    expect(microsToBase(1_000_000)).toBe(1);
  });

  it('converts 10,500,000 micros back to $10.50', () => {
    expect(microsToBase(10_500_000)).toBe(10.5);
  });

  it('dollar→micros→dollar round-trips correctly for common values', () => {
    const amounts = [5, 10, 100, 50.5, 9.99];
    for (const amount of amounts) {
      expect(microsToBase(baseToMicros(amount))).toBeCloseTo(amount, 5);
    }
  });
});

// ─── Campaign round-trips ─────────────────────────────────────────────────────

describe('Campaign conversion', () => {
  function makeUnifiedCampaign(overrides: Partial<UnifiedCampaign> = {}): UnifiedCampaign {
    return {
      id: 'unified-001',
      platform: 'google',
      name: 'Summer Sale Campaign',
      status: 'active',
      objective: 'traffic',
      channel: 'search',
      budget: { type: 'daily', amount: 50, currency: 'USD' },
      schedule: { start_date: '2025-01-01' },
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-02T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeGoogleCampaign(overrides: Partial<{
    campaign: Partial<GoogleCampaign['campaign']>;
    campaign_budget: Partial<NonNullable<GoogleCampaign['campaign_budget']>>;
  }> = {}): GoogleCampaign {
    return {
      campaign: {
        resource_name: 'customers/123/campaigns/456',
        id: 'google-456',
        name: 'Summer Sale Campaign',
        status: 'ENABLED',
        advertising_channel_type: 'SEARCH',
        start_date: '20250101',
        ...overrides.campaign,
      },
      campaign_budget: {
        amount_micros: '50000000', // $50.00
        period: 'DAILY',
        ...overrides.campaign_budget,
      },
    };
  }

  describe('toGoogleCampaign', () => {
    it('converts budget amount from dollars to micros', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'daily', amount: 50, currency: 'USD' } });
      const google = toGoogleCampaign(unified);
      expect((google['campaign_budget'] as Record<string, unknown>)['amount_micros']).toBe('50000000');
    });

    it('sets budget period to DAILY for daily budget type', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'daily', amount: 20, currency: 'USD' } });
      const google = toGoogleCampaign(unified);
      expect((google['campaign_budget'] as Record<string, unknown>)['period']).toBe('DAILY');
    });

    it('sets budget period to CUSTOM_PERIOD for lifetime budget type', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'lifetime', amount: 500, currency: 'USD' } });
      const google = toGoogleCampaign(unified);
      expect((google['campaign_budget'] as Record<string, unknown>)['period']).toBe('CUSTOM_PERIOD');
    });

    it('maps channel=search to advertising_channel_type SEARCH', () => {
      const unified = makeUnifiedCampaign({ channel: 'search', objective: 'traffic' });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['advertising_channel_type']).toBe('SEARCH');
    });

    it('maps channel=performance_max to advertising_channel_type PERFORMANCE_MAX', () => {
      const unified = makeUnifiedCampaign({ channel: 'performance_max', objective: 'conversions' });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['advertising_channel_type']).toBe('PERFORMANCE_MAX');
    });

    it('maps status active to ENABLED', () => {
      const unified = makeUnifiedCampaign({ status: 'active' });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['status']).toBe('ENABLED');
    });

    it('maps status paused to PAUSED', () => {
      const unified = makeUnifiedCampaign({ status: 'paused' });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['status']).toBe('PAUSED');
    });

    it('preserves campaign name', () => {
      const unified = makeUnifiedCampaign({ name: 'Black Friday 2025' });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['name']).toBe('Black Friday 2025');
    });

    it('formats start_date as YYYYMMDD', () => {
      const unified = makeUnifiedCampaign({ schedule: { start_date: '2025-06-01' } });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['start_date']).toBe('20250601');
    });

    it('formats end_date as YYYYMMDD when present', () => {
      const unified = makeUnifiedCampaign({
        schedule: { start_date: '2025-06-01', end_date: '2025-06-30' },
      });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['end_date']).toBe('20250630');
    });

    it('omits end_date when no end_date in schedule', () => {
      const unified = makeUnifiedCampaign({ schedule: { start_date: '2025-06-01' } });
      const google = toGoogleCampaign(unified);
      expect((google['campaign'] as Record<string, unknown>)['end_date']).toBeUndefined();
    });
  });

  describe('fromGoogleCampaign', () => {
    it('converts budget from micros to dollars', () => {
      const google = makeGoogleCampaign({ campaign_budget: { amount_micros: '50000000', period: 'DAILY' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.budget.amount).toBe(50);
    });

    it('identifies daily budget type from DAILY period', () => {
      const google = makeGoogleCampaign({ campaign_budget: { amount_micros: '20000000', period: 'DAILY' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.budget.type).toBe('daily');
    });

    it('identifies lifetime budget type from CUSTOM_PERIOD', () => {
      const google = makeGoogleCampaign({ campaign_budget: { amount_micros: '500000000', period: 'CUSTOM_PERIOD' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.budget.type).toBe('lifetime');
      expect(unified.budget.amount).toBe(500);
    });

    it('maps ENABLED status to unified active', () => {
      const google = makeGoogleCampaign({ campaign: { status: 'ENABLED' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.status).toBe('active');
    });

    it('maps PAUSED status to unified paused', () => {
      const google = makeGoogleCampaign({ campaign: { status: 'PAUSED' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.status).toBe('paused');
    });

    it('maps REMOVED status to unified archived', () => {
      const google = makeGoogleCampaign({ campaign: { status: 'REMOVED' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.status).toBe('archived');
    });

    it('maps SEARCH channel type to traffic objective + search channel', () => {
      const google = makeGoogleCampaign({ campaign: { advertising_channel_type: 'SEARCH' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.objective).toBe('traffic');
      expect(unified.channel).toBe('search');
    });

    it('maps PERFORMANCE_MAX channel type correctly', () => {
      const google = makeGoogleCampaign({ campaign: { advertising_channel_type: 'PERFORMANCE_MAX' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.objective).toBe('conversions');
      expect(unified.channel).toBe('performance_max');
    });

    it('preserves campaign name', () => {
      const google = makeGoogleCampaign({ campaign: { name: 'Black Friday 2025' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.name).toBe('Black Friday 2025');
    });

    it('sets platform to google', () => {
      const unified = fromGoogleCampaign(makeGoogleCampaign());
      expect(unified.platform).toBe('google');
    });

    it('sets id from campaign.id', () => {
      const google = makeGoogleCampaign({ campaign: { id: 'google-999' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.id).toBe('google-999');
    });

    it('parses start_date from YYYYMMDD to YYYY-MM-DD', () => {
      const google = makeGoogleCampaign({ campaign: { start_date: '20250601' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.schedule.start_date).toBe('2025-06-01');
    });

    it('parses end_date from YYYYMMDD to YYYY-MM-DD', () => {
      const google = makeGoogleCampaign({ campaign: { end_date: '20250630' } });
      const unified = fromGoogleCampaign(google);
      expect(unified.schedule.end_date).toBe('2025-06-30');
    });

    it('omits end_date when absent', () => {
      const google = makeGoogleCampaign();
      // ensure no end_date
      delete google.campaign.end_date;
      const unified = fromGoogleCampaign(google);
      expect(unified.schedule.end_date).toBeUndefined();
    });

    it('preserves raw google data in platform_data', () => {
      const google = makeGoogleCampaign();
      const unified = fromGoogleCampaign(google);
      expect(unified.platform_data).toBeDefined();
      expect((unified.platform_data as GoogleCampaign).campaign.id).toBe('google-456');
    });
  });

  describe('full round-trip: fromGoogleCampaign → toGoogleCampaign', () => {
    it('preserves name after round-trip', () => {
      const original = makeGoogleCampaign({ campaign: { name: 'Round-trip Test' } });
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign'] as Record<string, unknown>)['name']).toBe('Round-trip Test');
    });

    it('preserves objective+channel SEARCH after round-trip', () => {
      const original = makeGoogleCampaign({ campaign: { advertising_channel_type: 'SEARCH' } });
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign'] as Record<string, unknown>)['advertising_channel_type']).toBe('SEARCH');
    });

    it('preserves objective+channel PERFORMANCE_MAX after round-trip', () => {
      const original = makeGoogleCampaign({ campaign: { advertising_channel_type: 'PERFORMANCE_MAX' } });
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign'] as Record<string, unknown>)['advertising_channel_type']).toBe('PERFORMANCE_MAX');
    });

    it('preserves objective+channel SHOPPING after round-trip', () => {
      const original = makeGoogleCampaign({ campaign: { advertising_channel_type: 'SHOPPING' } });
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign'] as Record<string, unknown>)['advertising_channel_type']).toBe('SHOPPING');
    });

    it('preserves status ENABLED after round-trip', () => {
      const original = makeGoogleCampaign({ campaign: { status: 'ENABLED' } });
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign'] as Record<string, unknown>)['status']).toBe('ENABLED');
    });

    it('preserves status PAUSED after round-trip', () => {
      const original = makeGoogleCampaign({ campaign: { status: 'PAUSED' } });
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign'] as Record<string, unknown>)['status']).toBe('PAUSED');
    });

    it('preserves budget amount after round-trip (no floating point drift)', () => {
      const original = makeGoogleCampaign({ campaign_budget: { amount_micros: '9999000000', period: 'DAILY' } }); // $9999.00
      const unified = fromGoogleCampaign(original);
      const back = toGoogleCampaign(unified);
      expect((back['campaign_budget'] as Record<string, unknown>)['amount_micros']).toBe('9999000000');
    });

    it('full campaign round-trip preserving name, objective, channel, status, and budget', () => {
      const unified = makeUnifiedCampaign({
        name: 'Full Round-trip Campaign',
        objective: 'conversions',
        channel: 'performance_max',
        status: 'active',
        budget: { type: 'daily', amount: 100, currency: 'USD' },
      });
      const google = toGoogleCampaign(unified);
      const campaign = google['campaign'] as Record<string, unknown>;
      const budget = google['campaign_budget'] as Record<string, unknown>;

      expect(campaign['name']).toBe('Full Round-trip Campaign');
      expect(campaign['advertising_channel_type']).toBe('PERFORMANCE_MAX');
      expect(campaign['status']).toBe('ENABLED');
      expect(budget['amount_micros']).toBe('100000000');
      expect(budget['period']).toBe('DAILY');
    });
  });
});
