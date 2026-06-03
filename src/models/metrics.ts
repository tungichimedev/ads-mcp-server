import { z } from 'zod';
import { PlatformSchema, GranularitySchema } from './platform.js';

// ─── Unified Metrics ──────────────────────────────────────────────────────────

export const UnifiedMetricsSchema = z.object({
  date: z.string().date().optional(),
  granularity: GranularitySchema.optional(),
  impressions: z.number().int().nonnegative(),
  clicks: z.number().int().nonnegative(),
  spend: z.number().nonnegative(),
  spend_currency: z.string().length(3),
  ctr: z.number().nonnegative(),
  cpc: z.number().nonnegative(),
  cpm: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  cpa: z.number().nonnegative(),
  roas: z.number().nonnegative(),
  reach: z.number().int().nonnegative(),
  frequency: z.number().nonnegative(),
  video_views: z.number().int().nonnegative().optional(),
  video_completion_rate: z.number().min(0).max(1).optional(),
  three_second_views: z.number().int().nonnegative().optional(),
});
export type UnifiedMetrics = z.infer<typeof UnifiedMetricsSchema>;

// ─── Trend Metric ─────────────────────────────────────────────────────────────

export const TrendMetricSchema = z.object({
  metric: z.string(),
  current_value: z.number(),
  previous_value: z.number(),
  change_pct: z.number(),
  direction: z.enum(['up', 'down', 'flat']),
});
export type TrendMetric = z.infer<typeof TrendMetricSchema>;

// ─── Comparison Entity ────────────────────────────────────────────────────────

export const ComparisonEntitySchema = z.object({
  platform: PlatformSchema,
  entity_type: z.enum(['campaign', 'adset', 'ad', 'account']),
  entity_id: z.string(),
  account: z.string().optional(),
});
export type ComparisonEntity = z.infer<typeof ComparisonEntitySchema>;

// ─── Metrics with Time Series ─────────────────────────────────────────────────

export const MetricsTimeSeriesSchema = z.object({
  entity: ComparisonEntitySchema,
  period_start: z.string().date(),
  period_end: z.string().date(),
  data_points: z.array(UnifiedMetricsSchema),
  totals: UnifiedMetricsSchema.omit({ date: true, granularity: true }),
});
export type MetricsTimeSeries = z.infer<typeof MetricsTimeSeriesSchema>;
