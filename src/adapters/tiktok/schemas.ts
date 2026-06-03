import { z } from 'zod';

// ─── Top-Level Response Envelope ─────────────────────────────────────────────

/**
 * Standard TikTok Business API response envelope.
 * code === 0 means success; any other value is an error.
 */
export const TikTokResponseSchema = z.object({
  code: z.number(),
  message: z.string(),
  data: z.unknown().optional(),
  request_id: z.string().optional(),
});
export type TikTokResponse = z.infer<typeof TikTokResponseSchema>;

// ─── Pagination ───────────────────────────────────────────────────────────────

/**
 * TikTok pagination info returned inside list responses.
 */
export const TikTokPageInfoSchema = z.object({
  total_number: z.number(),
  page: z.number(),
  page_size: z.number(),
  total_page: z.number().optional(),
});
export type TikTokPageInfo = z.infer<typeof TikTokPageInfoSchema>;

// ─── Campaign ─────────────────────────────────────────────────────────────────

/**
 * TikTok campaign object as returned by the Campaigns API.
 * `.passthrough()` preserves extra fields TikTok may add in future API versions.
 */
export const TikTokCampaignSchema = z.object({
  campaign_id: z.string(),
  campaign_name: z.string(),
  objective_type: z.string(),
  budget: z.number(),
  budget_mode: z.string(),
  status: z.string(),
  create_time: z.string(),
  modify_time: z.string(),
}).passthrough();
export type TikTokCampaign = z.infer<typeof TikTokCampaignSchema>;

// ─── Ad Group ─────────────────────────────────────────────────────────────────

/**
 * TikTok ad group (adgroup) object as returned by the AdGroups API.
 */
export const TikTokAdGroupSchema = z.object({
  adgroup_id: z.string(),
  adgroup_name: z.string(),
  campaign_id: z.string(),
  status: z.string(),
  budget: z.number().optional(),
  budget_mode: z.string().optional(),
  bid_price: z.number().optional(),
  bid_type: z.string().optional(),
  create_time: z.string(),
  modify_time: z.string(),
}).passthrough();
export type TikTokAdGroup = z.infer<typeof TikTokAdGroupSchema>;

// ─── Ad ───────────────────────────────────────────────────────────────────────

/**
 * TikTok ad object as returned by the Ads API.
 */
export const TikTokAdSchema = z.object({
  ad_id: z.string(),
  ad_name: z.string(),
  adgroup_id: z.string(),
  status: z.string(),
  create_time: z.string(),
  modify_time: z.string(),
}).passthrough();
export type TikTokAd = z.infer<typeof TikTokAdSchema>;

// ─── Metrics ──────────────────────────────────────────────────────────────────

/**
 * TikTok reporting metrics.
 * All values are returned as strings by the TikTok Reporting API.
 */
export const TikTokMetricsSchema = z.object({
  impressions: z.string(),
  clicks: z.string(),
  spend: z.string(),
  ctr: z.string(),
  cpc: z.string(),
  cpm: z.string(),
  conversions: z.string().optional(),
  cost_per_conversion: z.string().optional(),
  conversion_rate: z.string().optional(),
}).passthrough();
export type TikTokMetrics = z.infer<typeof TikTokMetricsSchema>;
