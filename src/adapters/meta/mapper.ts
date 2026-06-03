import type { UnifiedCampaign } from '../../models/campaign.js';
import type { Objective, Status } from '../../models/platform.js';

// ─── Objective Mapping ────────────────────────────────────────────────────────

/**
 * Unified objective → Meta OUTCOME_* objective (v21+)
 */
const OBJECTIVE_TO_META: Record<Objective, string> = {
  awareness: 'OUTCOME_AWARENESS',
  traffic: 'OUTCOME_TRAFFIC',
  engagement: 'OUTCOME_ENGAGEMENT',
  leads: 'OUTCOME_LEADS',
  app_installs: 'OUTCOME_APP_PROMOTION',
  conversions: 'OUTCOME_SALES',
  sales: 'OUTCOME_SALES',
  video_views: 'OUTCOME_AWARENESS',
};

/**
 * Meta objective (OUTCOME_* and legacy) → unified objective
 *
 * OUTCOME_* are the v21+ values. The legacy values (CONVERSIONS, LINK_CLICKS, …)
 * are kept for backwards-compatibility when reading older campaigns from the API.
 */
const META_TO_OBJECTIVE: Record<string, Objective> = {
  // v21+ OUTCOME_* objectives
  OUTCOME_AWARENESS: 'awareness',
  OUTCOME_TRAFFIC: 'traffic',
  OUTCOME_ENGAGEMENT: 'engagement',
  OUTCOME_LEADS: 'leads',
  OUTCOME_APP_PROMOTION: 'app_installs',
  OUTCOME_SALES: 'sales',

  // Legacy Meta objectives
  CONVERSIONS: 'conversions',
  LINK_CLICKS: 'traffic',
  BRAND_AWARENESS: 'awareness',
  REACH: 'awareness',
  VIDEO_VIEWS: 'video_views',
  POST_ENGAGEMENT: 'engagement',
  PAGE_LIKES: 'engagement',
  EVENT_RESPONSES: 'engagement',
  MESSAGES: 'leads',
  LEAD_GENERATION: 'leads',
  APP_INSTALLS: 'app_installs',
  CATALOG_SALES: 'sales',
  STORE_VISITS: 'traffic',
};

// ─── Status Mapping ───────────────────────────────────────────────────────────

/**
 * Unified status → Meta status
 *
 * Note: 'draft' is not a native Meta campaign status; we map it to PAUSED so
 * the campaign is created in a safe, non-spending state.
 */
const STATUS_TO_META: Record<Status, string> = {
  active: 'ACTIVE',
  paused: 'PAUSED',
  archived: 'ARCHIVED',
  draft: 'PAUSED',
};

/** Meta status → unified status */
const META_TO_STATUS: Record<string, Status> = {
  ACTIVE: 'active',
  PAUSED: 'paused',
  ARCHIVED: 'archived',
  DELETED: 'archived',
};

// ─── Public conversion helpers ────────────────────────────────────────────────

/**
 * Maps a unified objective to the Meta API value.
 * Throws if the objective is not recognised (should never happen with validated input).
 */
export function toMetaObjective(objective: Objective): string {
  const mapped = OBJECTIVE_TO_META[objective];
  if (!mapped) {
    throw new Error(`Unknown unified objective: ${objective}`);
  }
  return mapped;
}

/**
 * Maps a Meta API objective value to the unified objective.
 * Falls back to 'conversions' for unrecognised values to avoid hard failures
 * when Meta introduces new objective types.
 */
export function fromMetaObjective(metaObjective: string): Objective {
  return META_TO_OBJECTIVE[metaObjective] ?? 'conversions';
}

/**
 * Maps a unified status to the Meta API value.
 */
export function toMetaStatus(status: Status): string {
  const mapped = STATUS_TO_META[status];
  if (!mapped) {
    throw new Error(`Unknown unified status: ${status}`);
  }
  return mapped;
}

/**
 * Maps a Meta API status value to the unified status.
 * Falls back to 'paused' for unrecognised values.
 */
export function fromMetaStatus(metaStatus: string): Status {
  return META_TO_STATUS[metaStatus] ?? 'paused';
}

// ─── Budget helpers ───────────────────────────────────────────────────────────

/** Convert dollars (unified) to cents (Meta API stores budgets in the smallest currency unit) */
export function dollarsToCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Convert cents (Meta API) back to dollars (unified) */
export function centsToDollars(cents: number): number {
  return cents / 100;
}

// ─── Campaign Conversion ──────────────────────────────────────────────────────

/**
 * Shape of a Meta API campaign object (read from the API).
 * Only the fields we care about for round-trip conversion are typed here.
 */
export interface MetaCampaign {
  id: string;
  name: string;
  status: string;
  objective: string;
  /** daily_budget is returned as a string by the Meta Graph API */
  daily_budget?: string;
  /** lifetime_budget is returned as a string by the Meta Graph API */
  lifetime_budget?: string;
  start_time?: string;
  stop_time?: string;
  created_time: string;
  updated_time: string;
  /** Raw platform data preserved verbatim */
  [key: string]: unknown;
}

/**
 * Converts a UnifiedCampaign to the payload expected by the Meta Campaigns API.
 *
 * - Budget amounts are converted from dollars to cents (Meta stores micro-currency).
 * - Objective and status are mapped to Meta enum values.
 */
export function toMetaCampaign(unified: UnifiedCampaign): Record<string, unknown> {
  const budgetCents = dollarsToCents(unified.budget.amount);
  const budgetField =
    unified.budget.type === 'daily' ? 'daily_budget' : 'lifetime_budget';

  return {
    name: unified.name,
    objective: toMetaObjective(unified.objective),
    status: toMetaStatus(unified.status),
    [budgetField]: String(budgetCents),
    ...(unified.schedule.start_date && { start_time: unified.schedule.start_date }),
    ...(unified.schedule.end_date && { stop_time: unified.schedule.end_date }),
  };
}

/**
 * Converts a Meta campaign API response object into a UnifiedCampaign.
 *
 * - Budget amounts are converted from cents to dollars.
 * - Objective and status are mapped to unified enum values.
 * - Raw Meta fields are preserved in platform_data.
 */
export function fromMetaCampaign(meta: MetaCampaign): UnifiedCampaign {
  const hasDailyBudget = meta.daily_budget !== undefined && meta.daily_budget !== '0';
  const budgetType = hasDailyBudget ? 'daily' : 'lifetime';
  const rawBudget = hasDailyBudget
    ? parseInt(meta.daily_budget ?? '0', 10)
    : parseInt(meta.lifetime_budget ?? '0', 10);

  return {
    id: String(meta.id),
    platform: 'meta',
    name: meta.name,
    status: fromMetaStatus(meta.status),
    objective: fromMetaObjective(meta.objective),
    budget: {
      type: budgetType,
      amount: centsToDollars(rawBudget),
      // Meta budgets are always in the account's currency; we store USD as default.
      // The caller should override this with the account currency if available.
      currency: 'USD',
    },
    schedule: {
      start_date: meta.start_time?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
      ...(meta.stop_time && { end_date: meta.stop_time.slice(0, 10) }),
    },
    created_at: meta.created_time,
    updated_at: meta.updated_time,
    platform_data: meta as Record<string, unknown>,
  };
}
