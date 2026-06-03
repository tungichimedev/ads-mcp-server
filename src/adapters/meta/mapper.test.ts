import { describe, it, expect } from 'vitest';
import {
  toMetaObjective,
  fromMetaObjective,
  toMetaStatus,
  fromMetaStatus,
  dollarsToCents,
  centsToDollars,
  toMetaCampaign,
  fromMetaCampaign,
  type MetaCampaign,
} from './mapper.js';
import type { UnifiedCampaign } from '../../models/campaign.js';
import type { Objective, Status } from '../../models/platform.js';

// ─── Objective round-trips ────────────────────────────────────────────────────

describe('Objective mapping', () => {
  const allObjectives: Objective[] = [
    'awareness',
    'traffic',
    'engagement',
    'leads',
    'app_installs',
    'conversions',
    'sales',
    'video_views',
  ];

  it('toMetaObjective returns a non-empty OUTCOME_* or META string for every unified objective', () => {
    for (const obj of allObjectives) {
      const meta = toMetaObjective(obj);
      expect(meta.length).toBeGreaterThan(0);
    }
  });

  it('round-trips awareness → OUTCOME_AWARENESS → awareness', () => {
    expect(fromMetaObjective(toMetaObjective('awareness'))).toBe('awareness');
  });

  it('round-trips traffic → OUTCOME_TRAFFIC → traffic', () => {
    expect(fromMetaObjective(toMetaObjective('traffic'))).toBe('traffic');
  });

  it('round-trips engagement → OUTCOME_ENGAGEMENT → engagement', () => {
    expect(fromMetaObjective(toMetaObjective('engagement'))).toBe('engagement');
  });

  it('round-trips leads → OUTCOME_LEADS → leads', () => {
    expect(fromMetaObjective(toMetaObjective('leads'))).toBe('leads');
  });

  it('round-trips app_installs → OUTCOME_APP_PROMOTION → app_installs', () => {
    expect(fromMetaObjective(toMetaObjective('app_installs'))).toBe('app_installs');
  });

  it('round-trips conversions → OUTCOME_SALES → sales (OUTCOME_SALES maps to sales)', () => {
    // Both 'conversions' and 'sales' map to OUTCOME_SALES; reverse maps to 'sales'
    const metaValue = toMetaObjective('conversions');
    expect(metaValue).toBe('OUTCOME_SALES');
    expect(fromMetaObjective(metaValue)).toBe('sales');
  });

  it('round-trips sales → OUTCOME_SALES → sales', () => {
    expect(fromMetaObjective(toMetaObjective('sales'))).toBe('sales');
  });

  it('round-trips video_views → OUTCOME_AWARENESS → awareness (shared bucket)', () => {
    // video_views maps to OUTCOME_AWARENESS; reverse maps to awareness
    const metaValue = toMetaObjective('video_views');
    expect(metaValue).toBe('OUTCOME_AWARENESS');
    expect(fromMetaObjective(metaValue)).toBe('awareness');
  });

  it('maps legacy CONVERSIONS to conversions', () => {
    expect(fromMetaObjective('CONVERSIONS')).toBe('conversions');
  });

  it('maps legacy LINK_CLICKS to traffic', () => {
    expect(fromMetaObjective('LINK_CLICKS')).toBe('traffic');
  });

  it('maps legacy BRAND_AWARENESS to awareness', () => {
    expect(fromMetaObjective('BRAND_AWARENESS')).toBe('awareness');
  });

  it('maps legacy VIDEO_VIEWS to video_views', () => {
    expect(fromMetaObjective('VIDEO_VIEWS')).toBe('video_views');
  });

  it('maps legacy APP_INSTALLS to app_installs', () => {
    expect(fromMetaObjective('APP_INSTALLS')).toBe('app_installs');
  });

  it('falls back to conversions for unknown Meta objective', () => {
    expect(fromMetaObjective('UNKNOWN_FUTURE_OBJECTIVE')).toBe('conversions');
  });

  it('throws for unknown unified objective (guard against bad casts)', () => {
    expect(() => toMetaObjective('unknown_objective' as Objective)).toThrow();
  });
});

// ─── Status round-trips ───────────────────────────────────────────────────────

describe('Status mapping', () => {
  const allStatuses: Status[] = ['active', 'paused', 'archived', 'draft'];

  it('toMetaStatus returns a non-empty string for every unified status', () => {
    for (const s of allStatuses) {
      const meta = toMetaStatus(s);
      expect(meta.length).toBeGreaterThan(0);
    }
  });

  it('round-trips active → ACTIVE → active', () => {
    expect(fromMetaStatus(toMetaStatus('active'))).toBe('active');
  });

  it('round-trips paused → PAUSED → paused', () => {
    expect(fromMetaStatus(toMetaStatus('paused'))).toBe('paused');
  });

  it('round-trips archived → ARCHIVED → archived', () => {
    expect(fromMetaStatus(toMetaStatus('archived'))).toBe('archived');
  });

  it('maps draft to PAUSED (Meta has no draft status)', () => {
    expect(toMetaStatus('draft')).toBe('PAUSED');
  });

  it('maps Meta DELETED back to archived', () => {
    expect(fromMetaStatus('DELETED')).toBe('archived');
  });

  it('falls back to paused for unknown Meta status', () => {
    expect(fromMetaStatus('UNKNOWN_STATUS')).toBe('paused');
  });
});

// ─── Budget helpers ───────────────────────────────────────────────────────────

describe('Budget conversion', () => {
  it('converts $1.00 to 100 cents', () => {
    expect(dollarsToCents(1)).toBe(100);
  });

  it('converts $9.99 to 999 cents', () => {
    expect(dollarsToCents(9.99)).toBe(999);
  });

  it('converts $0.01 to 1 cent', () => {
    expect(dollarsToCents(0.01)).toBe(1);
  });

  it('converts 100 cents back to $1.00', () => {
    expect(centsToDollars(100)).toBe(1);
  });

  it('converts 999 cents back to $9.99', () => {
    expect(centsToDollars(999)).toBe(9.99);
  });

  it('dollar→cents→dollar round-trips correctly for common values', () => {
    const amounts = [5, 10, 100, 999.99, 50.5];
    for (const amount of amounts) {
      expect(centsToDollars(dollarsToCents(amount))).toBeCloseTo(amount, 5);
    }
  });
});

// ─── Campaign round-trips ─────────────────────────────────────────────────────

describe('Campaign conversion', () => {
  function makeUnifiedCampaign(overrides: Partial<UnifiedCampaign> = {}): UnifiedCampaign {
    return {
      id: 'unified-001',
      platform: 'meta',
      name: 'Summer Sale Campaign',
      status: 'active',
      objective: 'traffic',
      budget: { type: 'daily', amount: 50, currency: 'USD' },
      schedule: { start_date: '2025-01-01' },
      created_at: '2025-01-01T00:00:00.000Z',
      updated_at: '2025-01-02T00:00:00.000Z',
      ...overrides,
    };
  }

  function makeMetaCampaign(overrides: Partial<MetaCampaign> = {}): MetaCampaign {
    return {
      id: 'meta-123',
      name: 'Summer Sale Campaign',
      status: 'ACTIVE',
      objective: 'OUTCOME_TRAFFIC',
      daily_budget: '5000', // $50.00 in cents
      start_time: '2025-01-01',
      created_time: '2025-01-01T00:00:00.000Z',
      updated_time: '2025-01-02T00:00:00.000Z',
      ...overrides,
    };
  }

  describe('toMetaCampaign', () => {
    it('converts budget amount from dollars to cents', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'daily', amount: 50, currency: 'USD' } });
      const meta = toMetaCampaign(unified);
      expect(meta['daily_budget']).toBe('5000');
    });

    it('uses daily_budget field for daily budget type', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'daily', amount: 20, currency: 'USD' } });
      const meta = toMetaCampaign(unified);
      expect(meta['daily_budget']).toBe('2000');
      expect(meta['lifetime_budget']).toBeUndefined();
    });

    it('uses lifetime_budget field for lifetime budget type', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'lifetime', amount: 500, currency: 'USD' } });
      const meta = toMetaCampaign(unified);
      expect(meta['lifetime_budget']).toBe('50000');
      expect(meta['daily_budget']).toBeUndefined();
    });

    it('maps objective to Meta OUTCOME_* value', () => {
      const unified = makeUnifiedCampaign({ objective: 'leads' });
      const meta = toMetaCampaign(unified);
      expect(meta['objective']).toBe('OUTCOME_LEADS');
    });

    it('maps status to Meta uppercase value', () => {
      const unified = makeUnifiedCampaign({ status: 'paused' });
      const meta = toMetaCampaign(unified);
      expect(meta['status']).toBe('PAUSED');
    });

    it('preserves campaign name', () => {
      const unified = makeUnifiedCampaign({ name: 'Black Friday 2025' });
      const meta = toMetaCampaign(unified);
      expect(meta['name']).toBe('Black Friday 2025');
    });

    it('includes start_time when schedule has start_date', () => {
      const unified = makeUnifiedCampaign({ schedule: { start_date: '2025-06-01' } });
      const meta = toMetaCampaign(unified);
      expect(meta['start_time']).toBe('2025-06-01');
    });

    it('includes stop_time when schedule has end_date', () => {
      const unified = makeUnifiedCampaign({
        schedule: { start_date: '2025-06-01', end_date: '2025-06-30' },
      });
      const meta = toMetaCampaign(unified);
      expect(meta['stop_time']).toBe('2025-06-30');
    });

    it('omits stop_time when no end_date', () => {
      const unified = makeUnifiedCampaign({ schedule: { start_date: '2025-06-01' } });
      const meta = toMetaCampaign(unified);
      expect(meta['stop_time']).toBeUndefined();
    });
  });

  describe('fromMetaCampaign', () => {
    it('converts budget from cents to dollars', () => {
      const meta = makeMetaCampaign({ daily_budget: '5000' });
      const unified = fromMetaCampaign(meta);
      expect(unified.budget.amount).toBe(50);
    });

    it('identifies daily budget type from daily_budget field', () => {
      const meta = makeMetaCampaign({ daily_budget: '2000' });
      const unified = fromMetaCampaign(meta);
      expect(unified.budget.type).toBe('daily');
    });

    it('identifies lifetime budget type when only lifetime_budget is present', () => {
      const meta = makeMetaCampaign({ daily_budget: undefined, lifetime_budget: '50000' });
      const unified = fromMetaCampaign(meta);
      expect(unified.budget.type).toBe('lifetime');
      expect(unified.budget.amount).toBe(500);
    });

    it('maps Meta ACTIVE status to unified active', () => {
      const meta = makeMetaCampaign({ status: 'ACTIVE' });
      const unified = fromMetaCampaign(meta);
      expect(unified.status).toBe('active');
    });

    it('maps Meta PAUSED status to unified paused', () => {
      const meta = makeMetaCampaign({ status: 'PAUSED' });
      const unified = fromMetaCampaign(meta);
      expect(unified.status).toBe('paused');
    });

    it('maps OUTCOME_TRAFFIC to unified traffic', () => {
      const meta = makeMetaCampaign({ objective: 'OUTCOME_TRAFFIC' });
      const unified = fromMetaCampaign(meta);
      expect(unified.objective).toBe('traffic');
    });

    it('preserves campaign name', () => {
      const meta = makeMetaCampaign({ name: 'Black Friday 2025' });
      const unified = fromMetaCampaign(meta);
      expect(unified.name).toBe('Black Friday 2025');
    });

    it('sets platform to meta', () => {
      const meta = makeMetaCampaign();
      const unified = fromMetaCampaign(meta);
      expect(unified.platform).toBe('meta');
    });

    it('sets id from meta.id', () => {
      const meta = makeMetaCampaign({ id: 'act_987654321' });
      const unified = fromMetaCampaign(meta);
      expect(unified.id).toBe('act_987654321');
    });

    it('parses start_date from start_time', () => {
      const meta = makeMetaCampaign({ start_time: '2025-06-01T00:00:00+0000' });
      const unified = fromMetaCampaign(meta);
      expect(unified.schedule.start_date).toBe('2025-06-01');
    });

    it('parses end_date from stop_time', () => {
      const meta = makeMetaCampaign({ stop_time: '2025-06-30T23:59:59+0000' });
      const unified = fromMetaCampaign(meta);
      expect(unified.schedule.end_date).toBe('2025-06-30');
    });

    it('omits end_date when stop_time is absent', () => {
      const meta = makeMetaCampaign({ stop_time: undefined });
      const unified = fromMetaCampaign(meta);
      expect(unified.schedule.end_date).toBeUndefined();
    });

    it('preserves raw meta data in platform_data', () => {
      const meta = makeMetaCampaign({ some_custom_field: 'meta_value' });
      const unified = fromMetaCampaign(meta);
      expect((unified.platform_data as Record<string, unknown>)['some_custom_field']).toBe('meta_value');
    });
  });

  describe('full round-trip: fromMetaCampaign → toMetaCampaign', () => {
    it('preserves name after round-trip', () => {
      const original = makeMetaCampaign({ name: 'Round-trip Test' });
      const unified = fromMetaCampaign(original);
      const back = toMetaCampaign(unified);
      expect(back['name']).toBe('Round-trip Test');
    });

    it('preserves objective after round-trip', () => {
      const original = makeMetaCampaign({ objective: 'OUTCOME_LEADS' });
      const unified = fromMetaCampaign(original);
      const back = toMetaCampaign(unified);
      expect(back['objective']).toBe('OUTCOME_LEADS');
    });

    it('preserves status after round-trip (ACTIVE)', () => {
      const original = makeMetaCampaign({ status: 'ACTIVE' });
      const unified = fromMetaCampaign(original);
      const back = toMetaCampaign(unified);
      expect(back['status']).toBe('ACTIVE');
    });

    it('preserves status after round-trip (PAUSED)', () => {
      const original = makeMetaCampaign({ status: 'PAUSED' });
      const unified = fromMetaCampaign(original);
      const back = toMetaCampaign(unified);
      expect(back['status']).toBe('PAUSED');
    });

    it('preserves budget amount after round-trip (no floating point drift)', () => {
      const original = makeMetaCampaign({ daily_budget: '9999' }); // $99.99
      const unified = fromMetaCampaign(original);
      const back = toMetaCampaign(unified);
      expect(back['daily_budget']).toBe('9999');
    });
  });
});
