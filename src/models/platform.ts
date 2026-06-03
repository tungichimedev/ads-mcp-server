import { z } from 'zod';

export const PlatformSchema = z.enum(['meta', 'google', 'tiktok']);
export type Platform = z.infer<typeof PlatformSchema>;

export const StatusSchema = z.enum(['active', 'paused', 'archived', 'draft']);
export type Status = z.infer<typeof StatusSchema>;

export const AdStatusSchema = z.enum(['active', 'paused', 'archived', 'draft', 'in_review']);
export type AdStatus = z.infer<typeof AdStatusSchema>;

export const ObjectiveSchema = z.enum([
  'awareness',
  'traffic',
  'engagement',
  'leads',
  'app_installs',
  'conversions',
  'sales',
  'video_views',
]);
export type Objective = z.infer<typeof ObjectiveSchema>;

export const ChannelSchema = z.enum([
  'search',
  'display',
  'shopping',
  'video',
  'app',
  'performance_max',
]);
export type Channel = z.infer<typeof ChannelSchema>;

export const DateRangeSchema = z
  .object({
    start_date: z.string().date(),
    end_date: z.string().date().optional(),
  })
  .refine(
    (data) => {
      if (data.end_date === undefined) return true;
      return data.end_date > data.start_date;
    },
    { message: 'end_date must be after start_date', path: ['end_date'] }
  );
export type DateRange = z.infer<typeof DateRangeSchema>;

export const AttributionWindowSchema = z.object({
  click_days: z.number().int().positive(),
  view_days: z.number().int().positive().optional(),
});
export type AttributionWindow = z.infer<typeof AttributionWindowSchema>;

export const InsightBreakdownSchema = z.enum([
  'age',
  'gender',
  'country',
  'device',
  'placement',
  'publisher_platform',
  'region',
  'network',
  'placement_type',
]);
export type InsightBreakdown = z.infer<typeof InsightBreakdownSchema>;

export const ComparePeriodSchema = z.enum([
  'yesterday_vs_prior_7d_avg',
  'last_7d_vs_prior_7d',
  'last_7d_vs_prior_30d_avg',
  'this_week_vs_last_week',
  'this_month_vs_last_month',
]);
export type ComparePeriod = z.infer<typeof ComparePeriodSchema>;

export const RuleMetricSchema = z.enum([
  'impressions',
  'clicks',
  'spend',
  'ctr',
  'cpc',
  'cpm',
  'conversions',
  'cpa',
  'roas',
  'reach',
  'frequency',
  'video_views',
  'video_completion_rate',
  'three_second_views',
]);
export type RuleMetric = z.infer<typeof RuleMetricSchema>;

export const GranularitySchema = z.enum(['hourly', 'daily', 'weekly', 'monthly']);
export type Granularity = z.infer<typeof GranularitySchema>;
