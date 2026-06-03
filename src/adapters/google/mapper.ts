import type { UnifiedCampaign } from '../../models/campaign.js';
import type { Objective, Channel, Status } from '../../models/platform.js';

// ─── Campaign Type Mapping ─────────────────────────────────────────────────────

/**
 * Unified channel → Google advertising_channel_type.
 * Takes precedence over objective when both are provided.
 */
const CHANNEL_TO_GOOGLE: Record<Channel, string> = {
  search: 'SEARCH',
  display: 'DISPLAY',
  shopping: 'SHOPPING',
  video: 'VIDEO',
  app: 'APP',
  performance_max: 'PERFORMANCE_MAX',
};

/**
 * Unified objective → Google advertising_channel_type (fallback when no channel set).
 */
const OBJECTIVE_TO_GOOGLE_CHANNEL: Record<Objective, string> = {
  awareness: 'DISPLAY',
  traffic: 'SEARCH',
  engagement: 'VIDEO',
  leads: 'SEARCH',
  app_installs: 'APP',
  conversions: 'SEARCH',
  sales: 'SHOPPING',
  video_views: 'VIDEO',
};

/**
 * Google advertising_channel_type → { objective, channel } (unified).
 */
const GOOGLE_CHANNEL_TO_UNIFIED: Record<string, { objective: Objective; channel: Channel }> = {
  SEARCH: { objective: 'traffic', channel: 'search' },
  DISPLAY: { objective: 'awareness', channel: 'display' },
  SHOPPING: { objective: 'sales', channel: 'shopping' },
  VIDEO: { objective: 'video_views', channel: 'video' },
  APP: { objective: 'app_installs', channel: 'app' },
  PERFORMANCE_MAX: { objective: 'conversions', channel: 'performance_max' },
};

/**
 * Maps unified objective + optional channel to a Google campaign type string.
 * Channel takes precedence over objective when provided.
 */
export function toGoogleCampaignType(objective: Objective, channel?: Channel): string {
  if (channel) {
    const mapped = CHANNEL_TO_GOOGLE[channel];
    if (!mapped) {
      throw new Error(`Unknown unified channel: ${channel}`);
    }
    return mapped;
  }
  const mapped = OBJECTIVE_TO_GOOGLE_CHANNEL[objective];
  if (!mapped) {
    throw new Error(`Unknown unified objective: ${objective}`);
  }
  return mapped;
}

/**
 * Maps a Google advertising_channel_type back to unified objective + channel.
 * Falls back to { conversions, search } for unrecognised types.
 */
export function fromGoogleCampaignType(campaignType: string): { objective: Objective; channel: Channel } {
  return GOOGLE_CHANNEL_TO_UNIFIED[campaignType] ?? { objective: 'conversions', channel: 'search' };
}

// ─── Status Mapping ───────────────────────────────────────────────────────────

/**
 * Unified status → Google campaign status.
 * 'draft' has no native Google equivalent; map to PAUSED for safety.
 */
const STATUS_TO_GOOGLE: Record<Status, string> = {
  active: 'ENABLED',
  paused: 'PAUSED',
  archived: 'REMOVED',
  draft: 'PAUSED',
};

/** Google campaign status → unified status */
const GOOGLE_TO_STATUS: Record<string, Status> = {
  ENABLED: 'active',
  PAUSED: 'paused',
  REMOVED: 'archived',
};

/**
 * Maps a unified status to the Google Ads API value.
 */
export function toGoogleStatus(status: Status): string {
  const mapped = STATUS_TO_GOOGLE[status];
  if (!mapped) {
    throw new Error(`Unknown unified status: ${status}`);
  }
  return mapped;
}

/**
 * Maps a Google Ads status value to the unified status.
 * Falls back to 'paused' for unrecognised values.
 */
export function fromGoogleStatus(googleStatus: string): Status {
  return GOOGLE_TO_STATUS[googleStatus] ?? 'paused';
}

// ─── Budget helpers ───────────────────────────────────────────────────────────

/** Convert dollars (unified) to micros (Google Ads stores budgets as micros: 1 USD = 1,000,000) */
export function baseToMicros(amount: number): number {
  return Math.round(amount * 1_000_000);
}

/** Convert micros (Google Ads) back to dollars (unified) */
export function microsToBase(micros: number): number {
  return micros / 1_000_000;
}

// ─── Campaign Conversion ──────────────────────────────────────────────────────

/**
 * Shape of a Google Ads API campaign object (read from the API).
 * Only the fields we care about for round-trip conversion are typed here.
 */
export interface GoogleCampaign {
  campaign: {
    resource_name: string;
    id: string;
    name: string;
    status: string;
    advertising_channel_type: string;
    start_date?: string; // YYYYMMDD
    end_date?: string;   // YYYYMMDD
  };
  campaign_budget?: {
    amount_micros: string;
    period: string; // DAILY or CUSTOM_PERIOD
  };
}

/** Convert ISO date (YYYY-MM-DD) to Google date format (YYYYMMDD) */
function toGoogleDate(isoDate: string): string {
  return isoDate.replace(/-/g, '');
}

/** Convert Google date format (YYYYMMDD) to ISO date (YYYY-MM-DD) */
function fromGoogleDate(googleDate: string): string {
  // YYYYMMDD → YYYY-MM-DD
  return `${googleDate.slice(0, 4)}-${googleDate.slice(4, 6)}-${googleDate.slice(6, 8)}`;
}

/**
 * Converts a UnifiedCampaign to the payload expected by the Google Ads API.
 *
 * - Budget amounts are converted from dollars to micros.
 * - Objective/channel are mapped to advertising_channel_type.
 * - Dates are formatted as YYYYMMDD.
 */
export function toGoogleCampaign(unified: UnifiedCampaign): Record<string, unknown> {
  const budgetMicros = baseToMicros(unified.budget.amount);
  const channelType = toGoogleCampaignType(unified.objective, unified.channel);
  const budgetPeriod = unified.budget.type === 'daily' ? 'DAILY' : 'CUSTOM_PERIOD';

  return {
    campaign: {
      name: unified.name,
      status: toGoogleStatus(unified.status),
      advertising_channel_type: channelType,
      ...(unified.schedule.start_date && { start_date: toGoogleDate(unified.schedule.start_date) }),
      ...(unified.schedule.end_date && { end_date: toGoogleDate(unified.schedule.end_date) }),
    },
    campaign_budget: {
      amount_micros: String(budgetMicros),
      period: budgetPeriod,
    },
  };
}

/**
 * Converts a Google Ads campaign API response object into a UnifiedCampaign.
 *
 * - Budget amounts are converted from micros to dollars.
 * - advertising_channel_type is mapped to unified objective + channel.
 * - Dates are formatted as YYYY-MM-DD.
 */
export function fromGoogleCampaign(google: GoogleCampaign): UnifiedCampaign {
  const { objective, channel } = fromGoogleCampaignType(google.campaign.advertising_channel_type);
  const rawMicros = parseInt(google.campaign_budget?.amount_micros ?? '0', 10);
  const budgetPeriod = google.campaign_budget?.period;
  const budgetType = budgetPeriod === 'CUSTOM_PERIOD' ? 'lifetime' : 'daily';

  const now = new Date().toISOString();

  return {
    id: String(google.campaign.id),
    platform: 'google',
    name: google.campaign.name,
    status: fromGoogleStatus(google.campaign.status),
    objective,
    channel,
    budget: {
      type: budgetType,
      amount: microsToBase(rawMicros),
      currency: 'USD',
    },
    schedule: {
      start_date: google.campaign.start_date
        ? fromGoogleDate(google.campaign.start_date)
        : new Date().toISOString().slice(0, 10),
      ...(google.campaign.end_date && { end_date: fromGoogleDate(google.campaign.end_date) }),
    },
    created_at: now,
    updated_at: now,
    platform_data: google as unknown as Record<string, unknown>,
  };
}
