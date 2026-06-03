import { z } from 'zod';
import { PlatformSchema } from './platform.js';

// ─── Pixel Status ─────────────────────────────────────────────────────────────

export const PixelStatusSchema = z.object({
  platform: PlatformSchema,
  pixel_id: z.string(),
  name: z.string(),
  status: z.enum(['active', 'inactive', 'unverified']),
  last_fired_at: z.string().datetime().optional(),
  events_received_last_7d: z.number().int().nonnegative().optional(),
  match_rate_pct: z.number().min(0).max(100).optional(),
});
export type PixelStatus = z.infer<typeof PixelStatusSchema>;

// ─── Conversion Event ─────────────────────────────────────────────────────────

export const ConversionEventSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  pixel_id: z.string(),
  name: z.string().min(1),
  event_type: z.enum([
    'purchase',
    'lead',
    'add_to_cart',
    'view_content',
    'complete_registration',
    'subscribe',
    'contact',
    'find_location',
    'schedule',
    'custom',
  ]),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  count_method: z.enum(['every', 'once']).optional(),
  attribution_window_click_days: z.number().int().positive().optional(),
  attribution_window_view_days: z.number().int().positive().optional(),
  created_at: z.string().datetime(),
});
export type ConversionEvent = z.infer<typeof ConversionEventSchema>;

// ─── Tracking URL Validation ──────────────────────────────────────────────────

export const TrackingUrlValidationSchema = z.object({
  url: z
    .string()
    .url()
    .refine((url) => url.startsWith('https://'), { message: 'Tracking URL must use https://' }),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_content: z.string().optional(),
  utm_term: z.string().optional(),
  custom_parameters: z.record(z.string(), z.string()).optional(),
});
export type TrackingUrlValidation = z.infer<typeof TrackingUrlValidationSchema>;
