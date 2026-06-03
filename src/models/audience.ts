import { z } from 'zod';
import { PlatformSchema } from './platform.js';

// ─── Audience Definition Types ─────────────────────────────────────────────────

const CustomerListDefinitionSchema = z.object({
  type: z.literal('customer_list'),
  uploaded_file_id: z.string(),
  match_keys: z.array(
    z.enum(['email', 'phone', 'mobile_advertiser_id', 'first_name', 'last_name', 'zip', 'country'])
  ),
});

const WebsiteVisitorDefinitionSchema = z.object({
  type: z.literal('website_visitor'),
  pixel_id: z.string(),
  events: z.array(z.string()).optional(),
  retention_days: z.number().int().min(1).max(180),
});

const AppUserDefinitionSchema = z.object({
  type: z.literal('app_user'),
  app_id: z.string(),
  events: z.array(z.string()).optional(),
  retention_days: z.number().int().min(1).max(180),
});

const EngagementDefinitionSchema = z.object({
  type: z.literal('engagement'),
  engagement_type: z.enum(['page_fans', 'video_viewers', 'lead_form', 'event_responders', 'ig_business_profile']),
  object_id: z.string(),
  retention_days: z.number().int().min(1).max(365),
});

const LookalikeDefinitionSchema = z.object({
  type: z.literal('lookalike'),
  seed_audience_id: z.string(),
  country: z.string().length(2, { message: 'Country must be a 2-character ISO country code' }),
  similarity_percentage: z.number().int().min(1).max(10),
});

// ─── Discriminated Union ───────────────────────────────────────────────────────

export const UnifiedAudienceDefinitionSchema = z.discriminatedUnion('type', [
  CustomerListDefinitionSchema,
  WebsiteVisitorDefinitionSchema,
  AppUserDefinitionSchema,
  EngagementDefinitionSchema,
  LookalikeDefinitionSchema,
]);
export type UnifiedAudienceDefinition = z.infer<typeof UnifiedAudienceDefinitionSchema>;

// ─── Audience ─────────────────────────────────────────────────────────────────

export const UnifiedAudienceSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  name: z.string().min(1),
  description: z.string().optional(),
  definition: UnifiedAudienceDefinitionSchema,
  estimated_size: z.number().int().nonnegative().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  platform_data: z.record(z.string(), z.unknown()).optional(),
});
export type UnifiedAudience = z.infer<typeof UnifiedAudienceSchema>;

export const CreateAudienceInputSchema = z
  .object({
    platform: PlatformSchema,
    name: z.string().min(1),
    description: z.string().optional(),
    definition: UnifiedAudienceDefinitionSchema,
  })
  .strict();
export type CreateAudienceInput = z.infer<typeof CreateAudienceInputSchema>;

// ─── Audience Size Estimate ────────────────────────────────────────────────────

export const AudienceSizeEstimateSchema = z.object({
  platform: PlatformSchema,
  lower_bound: z.number().int().nonnegative(),
  upper_bound: z.number().int().nonnegative(),
  confidence: z.enum(['low', 'medium', 'high']).optional(),
  estimated_at: z.string().datetime(),
});
export type AudienceSizeEstimate = z.infer<typeof AudienceSizeEstimateSchema>;
