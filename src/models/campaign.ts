import { z } from 'zod';
import { PlatformSchema, StatusSchema, ObjectiveSchema, ChannelSchema } from './platform.js';

const BudgetSchema = z.object({
  type: z.enum(['daily', 'lifetime']),
  amount: z.number().positive({ message: 'Budget amount must be positive' }),
  currency: z.string().length(3, { message: 'Currency must be a 3-character ISO 4217 code' }),
});

const CampaignScheduleSchema = z
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

export const UnifiedCampaignSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  name: z.string().min(1),
  status: StatusSchema,
  objective: ObjectiveSchema,
  channel: ChannelSchema.optional(),
  budget: BudgetSchema,
  schedule: CampaignScheduleSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  /** READ-ONLY: raw platform-specific data, never sent on write */
  platform_data: z.record(z.string(), z.unknown()).optional(),
});
export type UnifiedCampaign = z.infer<typeof UnifiedCampaignSchema>;

/**
 * Input schema for creating a campaign.
 * Uses .strict() so that any extra keys (including platform_data) are rejected.
 * platform_data is not included in this schema — it is a read-only field.
 */
export const CreateCampaignInputSchema = z
  .object({
    platform: PlatformSchema,
    name: z.string().min(1),
    status: StatusSchema,
    objective: ObjectiveSchema,
    channel: ChannelSchema.optional(),
    budget: BudgetSchema,
    schedule: CampaignScheduleSchema,
  })
  .strict();
export type CreateCampaignInput = z.infer<typeof CreateCampaignInputSchema>;
