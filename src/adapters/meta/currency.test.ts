import { describe, it, expect } from 'vitest';
import {
  minorUnitDigits,
  toMinorUnits,
  fromMinorUnits,
  toMetaCampaign,
} from './mapper.js';
import type { UnifiedCampaign } from '../../models/campaign.js';
import { checkCampaignBudget } from '../../safety/budget-guard.js';
import type { SafetyConfig } from '../../utils/config.js';

describe('currency-aware minor units', () => {
  it('uses 0 decimals for zero-decimal currencies (VND/JPY/KRW)', () => {
    expect(minorUnitDigits('VND')).toBe(0);
    expect(minorUnitDigits('jpy')).toBe(0);
    expect(toMinorUnits(50000, 'VND')).toBe(50000); // no x100
    expect(fromMinorUnits(50000, 'VND')).toBe(50000);
  });

  it('uses 2 decimals for USD/EUR (unchanged behavior)', () => {
    expect(minorUnitDigits('USD')).toBe(2);
    expect(toMinorUnits(50, 'USD')).toBe(5000);
    expect(fromMinorUnits(5000, 'USD')).toBe(50);
  });

  it('uses 3 decimals for three-decimal currencies (KWD)', () => {
    expect(minorUnitDigits('KWD')).toBe(3);
    expect(toMinorUnits(2, 'KWD')).toBe(2000);
  });
});

describe('toMetaCampaign budget conversion by currency', () => {
  const base = (currency: string, amount: number): UnifiedCampaign =>
    ({
      id: '',
      platform: 'meta',
      name: 'x',
      status: 'paused',
      objective: 'app_installs',
      budget: { type: 'daily', amount, currency },
      schedule: { start_date: '2026-06-20' },
    }) as unknown as UnifiedCampaign;

  it('does NOT multiply a VND budget by 100', () => {
    expect(toMetaCampaign(base('VND', 50000))['daily_budget']).toBe('50000');
  });

  it('still multiplies a USD budget by 100', () => {
    expect(toMetaCampaign(base('USD', 50))['daily_budget']).toBe('5000');
  });
});

describe('budget guard converts to USD-equivalent before comparing', () => {
  const safety = {
    max_daily_budget_per_campaign_usd: 100,
    max_lifetime_budget_per_campaign_usd: 5000,
    max_account_daily_spend_usd: 500,
  } as SafetyConfig;

  it('allows a normal VND daily budget (~$8)', () => {
    expect(() => checkCampaignBudget('daily', 200000, safety, 'VND')).not.toThrow();
  });

  it('blocks a huge VND daily budget (~$400)', () => {
    expect(() => checkCampaignBudget('daily', 10_000_000, safety, 'VND')).toThrow(
      /exceeds the safety limit/
    );
  });

  it('keeps USD behavior unchanged when currency defaults', () => {
    expect(() => checkCampaignBudget('daily', 50, safety)).not.toThrow();
    expect(() => checkCampaignBudget('daily', 150, safety)).toThrow(/exceeds the safety limit/);
  });
});
