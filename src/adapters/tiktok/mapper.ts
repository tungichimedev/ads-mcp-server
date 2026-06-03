import type { UnifiedCampaign } from '../../models/campaign.js';
import type { Objective, Status } from '../../models/platform.js';

// ─── Objective Mapping ────────────────────────────────────────────────────────

/**
 * Unified objective → TikTok objective_type
 */
const OBJECTIVE_TO_TIKTOK: Record<Objective, string> = {
  awareness: 'REACH',
  traffic: 'TRAFFIC',
  engagement: 'ENGAGEMENT',
  leads: 'LEAD_GENERATION',
  app_installs: 'APP_PROMOTION',
  conversions: 'CONVERSIONS',
  sales: 'CATALOG_SALES',
  video_views: 'VIDEO_VIEWS',
};

/**
 * TikTok objective_type → unified objective
 */
const TIKTOK_TO_OBJECTIVE: Record<string, Objective> = {
  REACH: 'awareness',
  TRAFFIC: 'traffic',
  ENGAGEMENT: 'engagement',
  LEAD_GENERATION: 'leads',
  APP_PROMOTION: 'app_installs',
  CONVERSIONS: 'conversions',
  CATALOG_SALES: 'sales',
  VIDEO_VIEWS: 'video_views',
};

// ─── Status Mapping ───────────────────────────────────────────────────────────

/**
 * Unified status → TikTok campaign status.
 * 'draft' has no native TikTok equivalent; map to CAMPAIGN_STATUS_DISABLE for safety.
 */
const STATUS_TO_TIKTOK: Record<Status, string> = {
  active: 'CAMPAIGN_STATUS_ENABLE',
  paused: 'CAMPAIGN_STATUS_DISABLE',
  archived: 'CAMPAIGN_STATUS_DELETE',
  draft: 'CAMPAIGN_STATUS_DISABLE',
};

/**
 * TikTok status (campaign, adgroup, ad variants) → unified status.
 *
 * TikTok uses different status prefix conventions per entity level:
 *   - Campaigns: CAMPAIGN_STATUS_*
 *   - Ad groups: ADGROUP_STATUS_*
 *   - Ads:       AD_STATUS_*
 */
const TIKTOK_TO_STATUS: Record<string, Status> = {
  // Campaign-level statuses
  CAMPAIGN_STATUS_ENABLE: 'active',
  CAMPAIGN_STATUS_DISABLE: 'paused',
  CAMPAIGN_STATUS_DELETE: 'archived',

  // Ad group-level statuses
  ADGROUP_STATUS_ENABLE: 'active',
  ADGROUP_STATUS_DISABLE: 'paused',
  ADGROUP_STATUS_DELETE: 'archived',

  // Ad-level statuses
  AD_STATUS_ENABLE: 'active',
  AD_STATUS_DISABLE: 'paused',
  AD_STATUS_DELETE: 'archived',

  // Delivery/computed statuses (map to nearest equivalent)
  CAMPAIGN_STATUS_NOT_DELIVERY: 'paused',
  ADGROUP_STATUS_NOT_DELIVERY: 'paused',
  AD_STATUS_NOT_DELIVERY: 'paused',
};

// ─── Budget Mode Mapping ──────────────────────────────────────────────────────

/**
 * Unified budget type → TikTok budget_mode
 */
const BUDGET_MODE_TO_TIKTOK: Record<'daily' | 'lifetime', string> = {
  daily: 'BUDGET_MODE_DAY',
  lifetime: 'BUDGET_MODE_TOTAL',
};

/**
 * TikTok budget_mode → unified budget type
 */
const TIKTOK_TO_BUDGET_MODE: Record<string, 'daily' | 'lifetime'> = {
  BUDGET_MODE_DAY: 'daily',
  BUDGET_MODE_TOTAL: 'lifetime',
};

// ─── Public conversion helpers ────────────────────────────────────────────────

/**
 * Maps a unified objective to the TikTok API objective_type value.
 * Throws if the objective is not recognised.
 */
export function toTikTokObjective(objective: Objective): string {
  const mapped = OBJECTIVE_TO_TIKTOK[objective];
  if (!mapped) {
    throw new Error(`Unknown unified objective: ${objective}`);
  }
  return mapped;
}

/**
 * Maps a TikTok objective_type value to the unified objective.
 * Falls back to 'conversions' for unrecognised values.
 */
export function fromTikTokObjective(tiktokObjective: string): Objective {
  return TIKTOK_TO_OBJECTIVE[tiktokObjective] ?? 'conversions';
}

/**
 * Maps a unified status to the TikTok API campaign status value.
 */
export function toTikTokStatus(status: Status): string {
  const mapped = STATUS_TO_TIKTOK[status];
  if (!mapped) {
    throw new Error(`Unknown unified status: ${status}`);
  }
  return mapped;
}

/**
 * Maps a TikTok status value (campaign, adgroup, or ad level) to the unified status.
 * Falls back to 'paused' for unrecognised values.
 */
export function fromTikTokStatus(tiktokStatus: string): Status {
  return TIKTOK_TO_STATUS[tiktokStatus] ?? 'paused';
}

/**
 * Maps a unified budget type to the TikTok budget_mode value.
 */
export function toTikTokBudgetMode(budgetType: 'daily' | 'lifetime'): string {
  const mapped = BUDGET_MODE_TO_TIKTOK[budgetType];
  if (!mapped) {
    throw new Error(`Unknown budget type: ${budgetType}`);
  }
  return mapped;
}

/**
 * Maps a TikTok budget_mode value to the unified budget type.
 * Falls back to 'daily' for unrecognised values.
 */
export function fromTikTokBudgetMode(budgetMode: string): 'daily' | 'lifetime' {
  return TIKTOK_TO_BUDGET_MODE[budgetMode] ?? 'daily';
}

// ─── Campaign Conversion ──────────────────────────────────────────────────────

/**
 * Shape of a TikTok API campaign object (read from the API).
 * Only the fields needed for round-trip conversion are typed here.
 */
export interface TikTokCampaignData {
  campaign_id: string;
  campaign_name: string;
  objective_type: string;
  /** Budget as a plain number (not cents/micros — TikTok uses actual currency units) */
  budget: number;
  budget_mode: string;
  status: string;
  create_time: string;
  modify_time: string;
  /** Raw platform data preserved verbatim */
  [key: string]: unknown;
}

/**
 * Converts a UnifiedCampaign to the payload expected by the TikTok Campaigns API.
 *
 * - Budget amount is passed as a plain number (TikTok does NOT use cents or micros).
 * - Objective and status are mapped to TikTok enum values.
 */
export function toTikTokCampaign(unified: UnifiedCampaign): Record<string, unknown> {
  return {
    campaign_name: unified.name,
    objective_type: toTikTokObjective(unified.objective),
    budget: unified.budget.amount,
    budget_mode: toTikTokBudgetMode(unified.budget.type),
    status: toTikTokStatus(unified.status),
  };
}

/**
 * Converts a TikTok campaign API response object into a UnifiedCampaign.
 *
 * - Budget amount is used as-is (no conversion needed).
 * - Objective and status are mapped to unified enum values.
 * - Raw TikTok fields are preserved in platform_data.
 */
export function fromTikTokCampaign(tiktok: TikTokCampaignData): UnifiedCampaign {
  return {
    id: String(tiktok.campaign_id),
    platform: 'tiktok',
    name: tiktok.campaign_name,
    status: fromTikTokStatus(tiktok.status),
    objective: fromTikTokObjective(tiktok.objective_type),
    budget: {
      type: fromTikTokBudgetMode(tiktok.budget_mode),
      amount: tiktok.budget,
      currency: 'USD',
    },
    schedule: {
      // TikTok campaigns don't always carry start/end dates at the campaign level;
      // use today as a safe fallback.
      start_date: new Date().toISOString().slice(0, 10),
    },
    created_at: tiktok.create_time,
    updated_at: tiktok.modify_time,
    platform_data: tiktok as Record<string, unknown>,
  };
}
