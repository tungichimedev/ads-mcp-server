import { z } from 'zod';
import { PlatformSchema, AdStatusSchema } from './platform.js';

const httpsUrl = z.string().url().refine((url) => url.startsWith('https://'), {
  message: 'URL must use https://',
});

// ─── Creative Types ────────────────────────────────────────────────────────────

const ImageCreativeSchema = z.object({
  type: z.literal('image'),
  headline: z.string().min(1),
  body: z.string().optional(),
  image_url: httpsUrl,
  landing_url: httpsUrl,
  cta: z.string().optional(),
});

const VideoCreativeSchema = z.object({
  type: z.literal('video'),
  headline: z.string().min(1),
  body: z.string().optional(),
  video_url: httpsUrl,
  thumbnail_url: httpsUrl.optional(),
  landing_url: httpsUrl,
  cta: z.string().optional(),
});

const CarouselCardSchema = z.object({
  headline: z.string().min(1),
  image_url: httpsUrl,
  landing_url: httpsUrl,
  body: z.string().optional(),
});

const CarouselCreativeSchema = z.object({
  type: z.literal('carousel'),
  cards: z.array(CarouselCardSchema).min(2).max(10),
  landing_url: httpsUrl.optional(),
});

const ResponsiveSearchCreativeSchema = z.object({
  type: z.literal('responsive_search'),
  headlines: z
    .array(z.string().min(1))
    .min(3, { message: 'At least 3 headlines required' })
    .max(15, { message: 'Maximum 15 headlines allowed' }),
  descriptions: z
    .array(z.string().min(1))
    .min(2, { message: 'At least 2 descriptions required' })
    .max(4, { message: 'Maximum 4 descriptions allowed' }),
  final_url: httpsUrl,
  display_url: z.string().optional(),
});

const PerformanceMaxCreativeSchema = z.object({
  type: z.literal('performance_max'),
  headlines: z.array(z.string().min(1)).min(1),
  long_headlines: z.array(z.string().min(1)).min(1),
  descriptions: z.array(z.string().min(1)).min(1),
  image_urls: z.array(httpsUrl).min(1),
  logo_urls: z.array(httpsUrl).min(1),
  video_urls: z.array(httpsUrl).optional(),
  final_url: httpsUrl,
  business_name: z.string().min(1),
});

// ─── Discriminated Union ───────────────────────────────────────────────────────

export const UnifiedCreativeSchema = z.discriminatedUnion('type', [
  ImageCreativeSchema,
  VideoCreativeSchema,
  CarouselCreativeSchema,
  ResponsiveSearchCreativeSchema,
  PerformanceMaxCreativeSchema,
]);
export type UnifiedCreative = z.infer<typeof UnifiedCreativeSchema>;

// ─── Ad ───────────────────────────────────────────────────────────────────────

export const UnifiedAdSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  adset_id: z.string(),
  campaign_id: z.string(),
  name: z.string().min(1),
  status: AdStatusSchema,
  creative: UnifiedCreativeSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  platform_data: z.record(z.string(), z.unknown()).optional(),
});
export type UnifiedAd = z.infer<typeof UnifiedAdSchema>;

export const CreateAdInputSchema = z
  .object({
    platform: PlatformSchema,
    adset_id: z.string(),
    campaign_id: z.string(),
    name: z.string().min(1),
    status: AdStatusSchema,
    creative: UnifiedCreativeSchema,
  })
  .strict();
export type CreateAdInput = z.infer<typeof CreateAdInputSchema>;
