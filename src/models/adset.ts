import { z } from 'zod';
import { PlatformSchema, StatusSchema } from './platform.js';

const TargetingSchema = z.object({
  locations: z.array(z.string()),
  age_min: z.number().int().min(13).max(65).optional(),
  age_max: z.number().int().min(13).max(65).optional(),
  gender: z.enum(['male', 'female', 'all']).optional(),
  interests: z.array(z.string()),
  behaviors: z.array(z.string()),
  audiences: z.array(z.string()),
  languages: z.array(z.string()),
  devices: z.array(z.string()),
  os: z.array(z.string()),
});

const BidSchema = z.object({
  strategy: z.enum([
    'lowest_cost',
    'target_cost',
    'bid_cap',
    'cost_cap',
    'manual_cpc',
    'manual_cpm',
    'target_cpa',
    'target_roas',
    'maximize_conversions',
    'maximize_clicks',
  ]),
  amount: z.number().positive().optional(),
});

const FrequencyCapSchema = z.object({
  impressions: z.number().int().positive(),
  period: z.enum(['day', 'week', 'month']),
});

const DaypartingEntrySchema = z
  .object({
    day: z.number().int().min(0).max(6),
    start_hour: z.number().int().min(0).max(23),
    end_hour: z.number().int().min(1).max(24),
  })
  .refine((data) => data.end_hour > data.start_hour, {
    message: 'end_hour must be greater than start_hour',
    path: ['end_hour'],
  });

const DaypartingSchema = z.object({
  timezone: z.string(),
  schedule: z.array(DaypartingEntrySchema),
});

export const UnifiedAdSetSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  campaign_id: z.string(),
  name: z.string().min(1),
  status: StatusSchema,
  targeting: TargetingSchema,
  bid: BidSchema,
  daily_budget: z.number().positive().optional(),
  lifetime_budget: z.number().positive().optional(),
  frequency_cap: FrequencyCapSchema.optional(),
  dayparting: DaypartingSchema.optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  platform_data: z.record(z.string(), z.unknown()).optional(),
});
export type UnifiedAdSet = z.infer<typeof UnifiedAdSetSchema>;

export const CreateAdSetInputSchema = z
  .object({
    platform: PlatformSchema,
    campaign_id: z.string(),
    name: z.string().min(1),
    status: StatusSchema,
    targeting: TargetingSchema,
    bid: BidSchema,
    daily_budget: z.number().positive().optional(),
    lifetime_budget: z.number().positive().optional(),
    frequency_cap: FrequencyCapSchema.optional(),
    dayparting: DaypartingSchema.optional(),
  })
  .strict();
export type CreateAdSetInput = z.infer<typeof CreateAdSetInputSchema>;
