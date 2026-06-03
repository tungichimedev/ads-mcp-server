import { AdsError } from '../utils/errors.js';
import type { SafetyConfig } from '../utils/config.js';

export function checkCampaignBudget(
  budgetType: 'daily' | 'lifetime',
  amount: number,
  safety: SafetyConfig,
): void {
  if (budgetType === 'daily') {
    if (amount > safety.max_daily_budget_per_campaign_usd) {
      throw new AdsError(
        'BUDGET_EXCEEDED',
        'safety',
        `Daily budget $${amount} exceeds the safety limit of $${safety.max_daily_budget_per_campaign_usd}`,
        false,
      );
    }
  } else {
    if (amount > safety.max_lifetime_budget_per_campaign_usd) {
      throw new AdsError(
        'BUDGET_EXCEEDED',
        'safety',
        `Lifetime budget $${amount} exceeds the safety limit of $${safety.max_lifetime_budget_per_campaign_usd}`,
        false,
      );
    }
  }
}

export function checkAccountVelocity(
  proposedDailyBudget: number,
  existingDailyBudgets: number[],
  safety: SafetyConfig,
): void {
  const existingTotal = existingDailyBudgets.reduce((sum, b) => sum + b, 0);
  const newTotal = existingTotal + proposedDailyBudget;

  if (newTotal > safety.max_account_daily_spend_usd) {
    throw new AdsError(
      'ACCOUNT_SPEND_LIMIT',
      'safety',
      `Adding a $${proposedDailyBudget}/day budget would bring total account daily spend to $${newTotal}, exceeding the limit of $${safety.max_account_daily_spend_usd}`,
      false,
    );
  }
}
