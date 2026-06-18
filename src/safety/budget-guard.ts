import { AdsError } from '../utils/errors.js';
import type { SafetyConfig } from '../utils/config.js';

// Approximate USD value of one major unit of each currency, used ONLY to evaluate
// budget amounts against the USD-denominated safety caps. These are deliberately
// rough guardrail rates (not accounting-grade FX) — a non-USD account whose currency
// is absent here is treated as 1:1 USD, i.e. conservatively (stricter, never looser).
const USD_PER_UNIT: Record<string, number> = {
  USD: 1, EUR: 1.08, GBP: 1.27, CAD: 0.73, AUD: 0.66, JPY: 1 / 150, CNY: 1 / 7.2,
  KRW: 1 / 1350, VND: 1 / 24500, IDR: 1 / 16000, INR: 1 / 83, THB: 1 / 36,
  PHP: 1 / 58, MYR: 1 / 4.7, SGD: 0.74, BRL: 1 / 5.1, MXN: 1 / 17, TWD: 1 / 32,
};

/** Convert a major-unit amount in the given currency to an approximate USD value. */
function toUsd(amount: number, currency: string): number {
  const rate = USD_PER_UNIT[currency.toUpperCase()] ?? 1;
  return amount * rate;
}

export function checkCampaignBudget(
  budgetType: 'daily' | 'lifetime',
  amount: number,
  safety: SafetyConfig,
  currency = 'USD',
): void {
  const usd = toUsd(amount, currency);
  const detail = currency.toUpperCase() === 'USD' ? `$${amount}` : `${amount} ${currency} (~$${usd.toFixed(2)})`;
  if (budgetType === 'daily') {
    if (usd > safety.max_daily_budget_per_campaign_usd) {
      throw new AdsError(
        'BUDGET_EXCEEDED',
        'safety',
        `Daily budget ${detail} exceeds the safety limit of $${safety.max_daily_budget_per_campaign_usd}`,
        false,
      );
    }
  } else {
    if (usd > safety.max_lifetime_budget_per_campaign_usd) {
      throw new AdsError(
        'BUDGET_EXCEEDED',
        'safety',
        `Lifetime budget ${detail} exceeds the safety limit of $${safety.max_lifetime_budget_per_campaign_usd}`,
        false,
      );
    }
  }
}

export function checkAccountVelocity(
  proposedDailyBudget: number,
  existingDailyBudgets: number[],
  safety: SafetyConfig,
  currency = 'USD',
): void {
  const existingTotal = existingDailyBudgets.reduce((sum, b) => sum + b, 0);
  const newTotalUsd = toUsd(existingTotal + proposedDailyBudget, currency);

  if (newTotalUsd > safety.max_account_daily_spend_usd) {
    throw new AdsError(
      'ACCOUNT_SPEND_LIMIT',
      'safety',
      `Adding a ${proposedDailyBudget} ${currency}/day budget would bring total account daily spend to ~$${newTotalUsd.toFixed(2)}, exceeding the limit of $${safety.max_account_daily_spend_usd}`,
      false,
    );
  }
}
