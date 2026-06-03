import type { PaginatedResponse } from '../models/pagination.js';
import type { UnifiedCampaign } from '../models/campaign.js';
import type { UnifiedAdSet } from '../models/adset.js';
import type { UnifiedAd } from '../models/ad.js';
import type { DateRange, AttributionWindow } from '../models/platform.js';

export interface AdapterContext {
  account: string;
  accountMeta: Record<string, unknown>;
}

export interface BaseAdapter {
  platform: 'meta' | 'google' | 'tiktok';
  allowedPlatformOptions: string[];

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  listCampaigns(
    ctx: AdapterContext,
    filters: { status?: string; dateRange?: DateRange },
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedCampaign>>;

  getCampaign(ctx: AdapterContext, campaignId: string): Promise<UnifiedCampaign>;

  createCampaign(ctx: AdapterContext, input: Record<string, unknown>): Promise<UnifiedCampaign>;

  updateCampaign(
    ctx: AdapterContext,
    campaignId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedCampaign>;

  setCampaignStatus(
    ctx: AdapterContext,
    campaignId: string,
    status: string
  ): Promise<UnifiedCampaign>;

  deleteCampaign(ctx: AdapterContext, campaignId: string): Promise<void>;

  cloneCampaign(
    ctx: AdapterContext,
    campaignId: string,
    name?: string
  ): Promise<UnifiedCampaign>;

  // ─── Ad Sets ─────────────────────────────────────────────────────────────────

  listAdSets(
    ctx: AdapterContext,
    campaignId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAdSet>>;

  getAdSet(ctx: AdapterContext, adsetId: string): Promise<UnifiedAdSet>;

  createAdSet(ctx: AdapterContext, input: Record<string, unknown>): Promise<UnifiedAdSet>;

  updateAdSet(
    ctx: AdapterContext,
    adsetId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAdSet>;

  setAdSetStatus(ctx: AdapterContext, adsetId: string, status: string): Promise<UnifiedAdSet>;

  deleteAdSet(ctx: AdapterContext, adsetId: string): Promise<void>;

  // ─── Ads ─────────────────────────────────────────────────────────────────────

  listAds(
    ctx: AdapterContext,
    adsetId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAd>>;

  getAd(ctx: AdapterContext, adId: string): Promise<UnifiedAd>;

  createAd(ctx: AdapterContext, input: Record<string, unknown>): Promise<UnifiedAd>;

  updateAd(
    ctx: AdapterContext,
    adId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAd>;

  deleteAd(ctx: AdapterContext, adId: string): Promise<void>;

  // ─── Creatives + Audience Files ──────────────────────────────────────────────

  uploadCreative(
    ctx: AdapterContext,
    filePath: string,
    mediaType: string
  ): Promise<{ creative_id: string; url: string }>;

  uploadAudienceFile(
    ctx: AdapterContext,
    filePath: string
  ): Promise<{ uploaded_file_id: string }>;

  // ─── Audiences ───────────────────────────────────────────────────────────────

  listAudiences(
    ctx: AdapterContext,
    type: string | undefined,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<Record<string, unknown>>>;

  createAudience(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  updateAudience(
    ctx: AdapterContext,
    audienceId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  getAudienceSize(
    ctx: AdapterContext,
    targeting: Record<string, unknown>
  ): Promise<{ estimated_reach: number; range?: { min: number; max: number } }>;

  // ─── Reporting ───────────────────────────────────────────────────────────────

  getPerformance(
    ctx: AdapterContext,
    entityType: string,
    entityId: string,
    dateRange: DateRange,
    granularity: string,
    attributionWindow?: AttributionWindow
  ): Promise<Record<string, unknown>[]>;

  getInsights(
    ctx: AdapterContext,
    entityId: string,
    breakdowns: string[],
    dateRange: DateRange
  ): Promise<Record<string, unknown>[]>;

  // ─── Budget ──────────────────────────────────────────────────────────────────

  getBudget(ctx: AdapterContext, campaignId: string): Promise<Record<string, unknown>>;

  getAllActiveCampaignBudgets(ctx: AdapterContext): Promise<number[]>;

  // ─── Rules ───────────────────────────────────────────────────────────────────

  listRules(ctx: AdapterContext): Promise<Record<string, unknown>[]>;

  createRule(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  updateRule(
    ctx: AdapterContext,
    ruleId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>>;

  deleteRule(ctx: AdapterContext, ruleId: string): Promise<void>;

  getRuleHistory(
    ctx: AdapterContext,
    ruleId: string,
    dateRange?: DateRange
  ): Promise<Record<string, unknown>[]>;

  // ─── Tracking ────────────────────────────────────────────────────────────────

  listPixels(ctx: AdapterContext): Promise<Record<string, unknown>[]>;

  getPixelStatus(ctx: AdapterContext, pixelId: string): Promise<Record<string, unknown>>;

  listConversionEvents(ctx: AdapterContext): Promise<Record<string, unknown>[]>;

  getEventMatchQuality(ctx: AdapterContext, pixelId: string): Promise<Record<string, unknown>>;

  validateTrackingUrls(
    ctx: AdapterContext,
    entityType: string,
    entityId: string
  ): Promise<Record<string, unknown>[]>;

  // ─── Account ─────────────────────────────────────────────────────────────────

  getAccountHealth(ctx: AdapterContext): Promise<Record<string, unknown>>;
}
