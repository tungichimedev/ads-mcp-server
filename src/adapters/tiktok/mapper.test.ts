import { describe, it, expect } from 'vitest';
import {
  toTikTokObjective,
  fromTikTokObjective,
  toTikTokStatus,
  fromTikTokStatus,
  toTikTokBudgetMode,
  fromTikTokBudgetMode,
  toTikTokCampaign,
  fromTikTokCampaign,
  type TikTokCampaignData,
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

  it('toTikTokObjective returns a non-empty string for every unified objective', () => {
    for (const obj of allObjectives) {
      const tiktok = toTikTokObjective(obj);
      expect(tiktok.length).toBeGreaterThan(0);
    }
  });

  it('round-trips awareness → REACH → awareness', () => {
    expect(fromTikTokObjective(toTikTokObjective('awareness'))).toBe('awareness');
  });

  it('round-trips traffic → TRAFFIC → traffic', () => {
    expect(fromTikTokObjective(toTikTokObjective('traffic'))).toBe('traffic');
  });

  it('round-trips engagement → ENGAGEMENT → engagement', () => {
    expect(fromTikTokObjective(toTikTokObjective('engagement'))).toBe('engagement');
  });

  it('round-trips leads → LEAD_GENERATION → leads', () => {
    expect(fromTikTokObjective(toTikTokObjective('leads'))).toBe('leads');
  });

  it('round-trips app_installs → APP_PROMOTION → app_installs', () => {
    expect(fromTikTokObjective(toTikTokObjective('app_installs'))).toBe('app_installs');
  });

  it('round-trips conversions → CONVERSIONS → conversions', () => {
    expect(fromTikTokObjective(toTikTokObjective('conversions'))).toBe('conversions');
  });

  it('round-trips sales → CATALOG_SALES → sales', () => {
    expect(fromTikTokObjective(toTikTokObjective('sales'))).toBe('sales');
  });

  it('round-trips video_views → VIDEO_VIEWS → video_views', () => {
    expect(fromTikTokObjective(toTikTokObjective('video_views'))).toBe('video_views');
  });

  it('maps awareness to REACH (TikTok reach objective)', () => {
    expect(toTikTokObjective('awareness')).toBe('REACH');
  });

  it('maps leads to LEAD_GENERATION', () => {
    expect(toTikTokObjective('leads')).toBe('LEAD_GENERATION');
  });

  it('maps app_installs to APP_PROMOTION', () => {
    expect(toTikTokObjective('app_installs')).toBe('APP_PROMOTION');
  });

  it('maps sales to CATALOG_SALES', () => {
    expect(toTikTokObjective('sales')).toBe('CATALOG_SALES');
  });

  it('maps video_views to VIDEO_VIEWS', () => {
    expect(toTikTokObjective('video_views')).toBe('VIDEO_VIEWS');
  });

  it('falls back to conversions for unknown TikTok objective', () => {
    expect(fromTikTokObjective('UNKNOWN_OBJECTIVE')).toBe('conversions');
  });

  it('throws for unknown unified objective (guard against bad casts)', () => {
    expect(() => toTikTokObjective('unknown_objective' as Objective)).toThrow();
  });
});

// ─── Status round-trips ───────────────────────────────────────────────────────

describe('Status mapping', () => {
  const allStatuses: Status[] = ['active', 'paused', 'archived', 'draft'];

  it('toTikTokStatus returns a non-empty string for every unified status', () => {
    for (const s of allStatuses) {
      const tiktok = toTikTokStatus(s);
      expect(tiktok.length).toBeGreaterThan(0);
    }
  });

  it('maps active to CAMPAIGN_STATUS_ENABLE', () => {
    expect(toTikTokStatus('active')).toBe('CAMPAIGN_STATUS_ENABLE');
  });

  it('maps paused to CAMPAIGN_STATUS_DISABLE', () => {
    expect(toTikTokStatus('paused')).toBe('CAMPAIGN_STATUS_DISABLE');
  });

  it('maps archived to CAMPAIGN_STATUS_DELETE', () => {
    expect(toTikTokStatus('archived')).toBe('CAMPAIGN_STATUS_DELETE');
  });

  it('maps draft to CAMPAIGN_STATUS_DISABLE (TikTok has no draft status)', () => {
    expect(toTikTokStatus('draft')).toBe('CAMPAIGN_STATUS_DISABLE');
  });

  it('round-trips active → CAMPAIGN_STATUS_ENABLE → active', () => {
    expect(fromTikTokStatus(toTikTokStatus('active'))).toBe('active');
  });

  it('round-trips paused → CAMPAIGN_STATUS_DISABLE → paused', () => {
    expect(fromTikTokStatus(toTikTokStatus('paused'))).toBe('paused');
  });

  it('round-trips archived → CAMPAIGN_STATUS_DELETE → archived', () => {
    expect(fromTikTokStatus(toTikTokStatus('archived'))).toBe('archived');
  });

  // Ad group status variants
  it('maps ADGROUP_STATUS_ENABLE to active', () => {
    expect(fromTikTokStatus('ADGROUP_STATUS_ENABLE')).toBe('active');
  });

  it('maps ADGROUP_STATUS_DISABLE to paused', () => {
    expect(fromTikTokStatus('ADGROUP_STATUS_DISABLE')).toBe('paused');
  });

  it('maps ADGROUP_STATUS_DELETE to archived', () => {
    expect(fromTikTokStatus('ADGROUP_STATUS_DELETE')).toBe('archived');
  });

  // Ad status variants
  it('maps AD_STATUS_ENABLE to active', () => {
    expect(fromTikTokStatus('AD_STATUS_ENABLE')).toBe('active');
  });

  it('maps AD_STATUS_DISABLE to paused', () => {
    expect(fromTikTokStatus('AD_STATUS_DISABLE')).toBe('paused');
  });

  it('maps AD_STATUS_DELETE to archived', () => {
    expect(fromTikTokStatus('AD_STATUS_DELETE')).toBe('archived');
  });

  it('falls back to paused for unknown TikTok status', () => {
    expect(fromTikTokStatus('UNKNOWN_STATUS')).toBe('paused');
  });

  it('throws for unknown unified status (guard against bad casts)', () => {
    expect(() => toTikTokStatus('unknown_status' as Status)).toThrow();
  });
});

// ─── Budget mode round-trips ──────────────────────────────────────────────────

describe('Budget mode mapping', () => {
  it('maps daily to BUDGET_MODE_DAY', () => {
    expect(toTikTokBudgetMode('daily')).toBe('BUDGET_MODE_DAY');
  });

  it('maps lifetime to BUDGET_MODE_TOTAL', () => {
    expect(toTikTokBudgetMode('lifetime')).toBe('BUDGET_MODE_TOTAL');
  });

  it('round-trips daily → BUDGET_MODE_DAY → daily', () => {
    expect(fromTikTokBudgetMode(toTikTokBudgetMode('daily'))).toBe('daily');
  });

  it('round-trips lifetime → BUDGET_MODE_TOTAL → lifetime', () => {
    expect(fromTikTokBudgetMode(toTikTokBudgetMode('lifetime'))).toBe('lifetime');
  });

  it('falls back to daily for unknown budget mode', () => {
    expect(fromTikTokBudgetMode('BUDGET_MODE_UNKNOWN')).toBe('daily');
  });
});

// ─── Campaign Conversion ──────────────────────────────────────────────────────

describe('Campaign conversion', () => {
  function makeUnifiedCampaign(overrides: Partial<UnifiedCampaign> = {}): UnifiedCampaign {
    return {
      id: 'unified-001',
      platform: 'tiktok',
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

  function makeTikTokCampaign(overrides: Partial<TikTokCampaignData> = {}): TikTokCampaignData {
    return {
      campaign_id: 'tiktok-123',
      campaign_name: 'Summer Sale Campaign',
      objective_type: 'TRAFFIC',
      budget: 50,
      budget_mode: 'BUDGET_MODE_DAY',
      status: 'CAMPAIGN_STATUS_ENABLE',
      create_time: '2025-01-01T00:00:00.000Z',
      modify_time: '2025-01-02T00:00:00.000Z',
      ...overrides,
    };
  }

  describe('toTikTokCampaign', () => {
    it('passes budget amount as a plain number (no cents/micros conversion)', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'daily', amount: 50, currency: 'USD' } });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['budget']).toBe(50);
    });

    it('uses BUDGET_MODE_DAY for daily budget type', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'daily', amount: 20, currency: 'USD' } });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['budget_mode']).toBe('BUDGET_MODE_DAY');
    });

    it('uses BUDGET_MODE_TOTAL for lifetime budget type', () => {
      const unified = makeUnifiedCampaign({ budget: { type: 'lifetime', amount: 500, currency: 'USD' } });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['budget_mode']).toBe('BUDGET_MODE_TOTAL');
    });

    it('maps objective to TikTok objective_type', () => {
      const unified = makeUnifiedCampaign({ objective: 'leads' });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['objective_type']).toBe('LEAD_GENERATION');
    });

    it('maps status to TikTok CAMPAIGN_STATUS_* value', () => {
      const unified = makeUnifiedCampaign({ status: 'paused' });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['status']).toBe('CAMPAIGN_STATUS_DISABLE');
    });

    it('preserves campaign name', () => {
      const unified = makeUnifiedCampaign({ name: 'Black Friday 2025' });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['campaign_name']).toBe('Black Friday 2025');
    });

    it('maps active to CAMPAIGN_STATUS_ENABLE', () => {
      const unified = makeUnifiedCampaign({ status: 'active' });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['status']).toBe('CAMPAIGN_STATUS_ENABLE');
    });

    it('maps archived to CAMPAIGN_STATUS_DELETE', () => {
      const unified = makeUnifiedCampaign({ status: 'archived' });
      const tiktok = toTikTokCampaign(unified);
      expect(tiktok['status']).toBe('CAMPAIGN_STATUS_DELETE');
    });
  });

  describe('fromTikTokCampaign', () => {
    it('sets platform to tiktok', () => {
      const tiktok = makeTikTokCampaign();
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.platform).toBe('tiktok');
    });

    it('sets id from campaign_id', () => {
      const tiktok = makeTikTokCampaign({ campaign_id: '987654321' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.id).toBe('987654321');
    });

    it('sets name from campaign_name', () => {
      const tiktok = makeTikTokCampaign({ campaign_name: 'My TikTok Campaign' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.name).toBe('My TikTok Campaign');
    });

    it('passes budget amount through as-is (no conversion)', () => {
      const tiktok = makeTikTokCampaign({ budget: 100 });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.budget.amount).toBe(100);
    });

    it('identifies daily budget type from BUDGET_MODE_DAY', () => {
      const tiktok = makeTikTokCampaign({ budget_mode: 'BUDGET_MODE_DAY' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.budget.type).toBe('daily');
    });

    it('identifies lifetime budget type from BUDGET_MODE_TOTAL', () => {
      const tiktok = makeTikTokCampaign({ budget_mode: 'BUDGET_MODE_TOTAL' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.budget.type).toBe('lifetime');
    });

    it('maps CAMPAIGN_STATUS_ENABLE to active', () => {
      const tiktok = makeTikTokCampaign({ status: 'CAMPAIGN_STATUS_ENABLE' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.status).toBe('active');
    });

    it('maps CAMPAIGN_STATUS_DISABLE to paused', () => {
      const tiktok = makeTikTokCampaign({ status: 'CAMPAIGN_STATUS_DISABLE' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.status).toBe('paused');
    });

    it('maps TRAFFIC objective_type to traffic', () => {
      const tiktok = makeTikTokCampaign({ objective_type: 'TRAFFIC' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.objective).toBe('traffic');
    });

    it('maps REACH objective_type to awareness', () => {
      const tiktok = makeTikTokCampaign({ objective_type: 'REACH' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.objective).toBe('awareness');
    });

    it('preserves raw tiktok data in platform_data', () => {
      const tiktok = makeTikTokCampaign({ advertiser_id: 'adv-001' });
      const unified = fromTikTokCampaign(tiktok);
      expect((unified.platform_data as Record<string, unknown>)['advertiser_id']).toBe('adv-001');
    });

    it('sets created_at from create_time', () => {
      const tiktok = makeTikTokCampaign({ create_time: '2025-03-01T00:00:00.000Z' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.created_at).toBe('2025-03-01T00:00:00.000Z');
    });

    it('sets updated_at from modify_time', () => {
      const tiktok = makeTikTokCampaign({ modify_time: '2025-03-15T00:00:00.000Z' });
      const unified = fromTikTokCampaign(tiktok);
      expect(unified.updated_at).toBe('2025-03-15T00:00:00.000Z');
    });
  });

  describe('full round-trip: fromTikTokCampaign → toTikTokCampaign', () => {
    it('preserves name after round-trip', () => {
      const original = makeTikTokCampaign({ campaign_name: 'Round-trip Test' });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['campaign_name']).toBe('Round-trip Test');
    });

    it('preserves objective after round-trip', () => {
      const original = makeTikTokCampaign({ objective_type: 'LEAD_GENERATION' });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['objective_type']).toBe('LEAD_GENERATION');
    });

    it('preserves status after round-trip (ENABLE)', () => {
      const original = makeTikTokCampaign({ status: 'CAMPAIGN_STATUS_ENABLE' });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['status']).toBe('CAMPAIGN_STATUS_ENABLE');
    });

    it('preserves status after round-trip (DISABLE)', () => {
      const original = makeTikTokCampaign({ status: 'CAMPAIGN_STATUS_DISABLE' });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['status']).toBe('CAMPAIGN_STATUS_DISABLE');
    });

    it('preserves budget amount after round-trip (no floating point drift)', () => {
      const original = makeTikTokCampaign({ budget: 99.99 });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['budget']).toBe(99.99);
    });

    it('preserves budget mode after round-trip (daily)', () => {
      const original = makeTikTokCampaign({ budget_mode: 'BUDGET_MODE_DAY' });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['budget_mode']).toBe('BUDGET_MODE_DAY');
    });

    it('preserves budget mode after round-trip (lifetime)', () => {
      const original = makeTikTokCampaign({ budget_mode: 'BUDGET_MODE_TOTAL' });
      const unified = fromTikTokCampaign(original);
      const back = toTikTokCampaign(unified);
      expect(back['budget_mode']).toBe('BUDGET_MODE_TOTAL');
    });

    it('round-trips all 8 objectives', () => {
      const objectives: Array<{ unified: Objective; tiktok: string }> = [
        { unified: 'awareness', tiktok: 'REACH' },
        { unified: 'traffic', tiktok: 'TRAFFIC' },
        { unified: 'engagement', tiktok: 'ENGAGEMENT' },
        { unified: 'leads', tiktok: 'LEAD_GENERATION' },
        { unified: 'app_installs', tiktok: 'APP_PROMOTION' },
        { unified: 'conversions', tiktok: 'CONVERSIONS' },
        { unified: 'sales', tiktok: 'CATALOG_SALES' },
        { unified: 'video_views', tiktok: 'VIDEO_VIEWS' },
      ];

      for (const { unified: unifiedObj, tiktok: tiktokObj } of objectives) {
        const original = makeTikTokCampaign({ objective_type: tiktokObj });
        const unified = fromTikTokCampaign(original);
        expect(unified.objective).toBe(unifiedObj);
        const back = toTikTokCampaign(unified);
        expect(back['objective_type']).toBe(tiktokObj);
      }
    });
  });
});
