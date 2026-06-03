import { describe, it, expect } from 'vitest';
import { checkCampaignBudget, checkAccountVelocity } from './budget-guard.js';
import { DEFAULT_SAFETY_CONFIG } from '../utils/config.js';
import { AdsError } from '../utils/errors.js';

describe('checkCampaignBudget', () => {
  it('passes when daily budget is under the limit', () => {
    expect(() =>
      checkCampaignBudget('daily', 50, DEFAULT_SAFETY_CONFIG),
    ).not.toThrow();
  });

  it('passes when daily budget equals the limit', () => {
    expect(() =>
      checkCampaignBudget('daily', DEFAULT_SAFETY_CONFIG.max_daily_budget_per_campaign_usd, DEFAULT_SAFETY_CONFIG),
    ).not.toThrow();
  });

  it('throws BUDGET_EXCEEDED when daily budget exceeds limit', () => {
    const overLimit = DEFAULT_SAFETY_CONFIG.max_daily_budget_per_campaign_usd + 0.01;
    try {
      checkCampaignBudget('daily', overLimit, DEFAULT_SAFETY_CONFIG);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdsError);
      expect((err as AdsError).code).toBe('BUDGET_EXCEEDED');
      expect((err as AdsError).message).toMatch(/Daily budget/);
    }
  });

  it('throws BUDGET_EXCEEDED when lifetime budget exceeds limit', () => {
    const overLimit = DEFAULT_SAFETY_CONFIG.max_lifetime_budget_per_campaign_usd + 1;
    try {
      checkCampaignBudget('lifetime', overLimit, DEFAULT_SAFETY_CONFIG);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdsError);
      expect((err as AdsError).code).toBe('BUDGET_EXCEEDED');
      expect((err as AdsError).message).toMatch(/Lifetime budget/);
    }
  });

  it('passes when lifetime budget is under the limit', () => {
    expect(() =>
      checkCampaignBudget('lifetime', 1000, DEFAULT_SAFETY_CONFIG),
    ).not.toThrow();
  });
});

describe('checkAccountVelocity', () => {
  it('passes when total daily spend is under the account limit', () => {
    const existing = [50, 100]; // total = 150
    expect(() =>
      checkAccountVelocity(100, existing, DEFAULT_SAFETY_CONFIG),
    ).not.toThrow();
  });

  it('passes when total equals the account limit exactly', () => {
    const existing = [200, 200]; // total = 400
    const proposed = DEFAULT_SAFETY_CONFIG.max_account_daily_spend_usd - 400; // = 100
    expect(() =>
      checkAccountVelocity(proposed, existing, DEFAULT_SAFETY_CONFIG),
    ).not.toThrow();
  });

  it('throws ACCOUNT_SPEND_LIMIT when total exceeds account daily limit', () => {
    const existing = [300, 150]; // total = 450
    const proposed = 100; // would make 550 > 500
    try {
      checkAccountVelocity(proposed, existing, DEFAULT_SAFETY_CONFIG);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdsError);
      expect((err as AdsError).code).toBe('ACCOUNT_SPEND_LIMIT');
      expect((err as AdsError).message).toMatch(/exceeding the limit/);
    }
  });

  it('passes when there are no existing budgets', () => {
    expect(() =>
      checkAccountVelocity(50, [], DEFAULT_SAFETY_CONFIG),
    ).not.toThrow();
  });

  it('throws ACCOUNT_SPEND_LIMIT when single proposed budget exceeds limit', () => {
    try {
      checkAccountVelocity(600, [], DEFAULT_SAFETY_CONFIG);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdsError);
      expect((err as AdsError).code).toBe('ACCOUNT_SPEND_LIMIT');
    }
  });
});
