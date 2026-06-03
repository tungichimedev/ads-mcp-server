import { z } from 'zod';
import { PlatformSchema, RuleMetricSchema } from './platform.js';

// ─── Condition ────────────────────────────────────────────────────────────────

const RuleConditionSchema = z.object({
  metric: RuleMetricSchema,
  operator: z.enum(['gt', 'lt', 'gte', 'lte', 'eq', 'neq']),
  value: z.number(),
  time_window_days: z.number().int().positive().optional(),
});

// ─── Action ───────────────────────────────────────────────────────────────────

const PauseActionSchema = z.object({
  type: z.literal('pause'),
});

const EnableActionSchema = z.object({
  type: z.literal('enable'),
});

const AdjustBudgetActionSchema = z.object({
  type: z.literal('adjust_budget'),
  adjustment_type: z.enum(['increase_by_pct', 'decrease_by_pct', 'set_to']),
  value: z.number().positive(),
  max_budget: z.number().positive().optional(),
  min_budget: z.number().positive().optional(),
});

const AdjustBidActionSchema = z.object({
  type: z.literal('adjust_bid'),
  adjustment_type: z.enum(['increase_by_pct', 'decrease_by_pct', 'set_to']),
  value: z.number().positive(),
  max_bid: z.number().positive().optional(),
  min_bid: z.number().positive().optional(),
});

const SendNotificationActionSchema = z.object({
  type: z.literal('send_notification'),
  message: z.string().min(1),
  channels: z.array(z.enum(['email', 'slack', 'webhook'])).min(1),
  webhook_url: z.string().url().optional(),
});

const RuleActionSchema = z.discriminatedUnion('type', [
  PauseActionSchema,
  EnableActionSchema,
  AdjustBudgetActionSchema,
  AdjustBidActionSchema,
  SendNotificationActionSchema,
]);

// ─── Schedule ─────────────────────────────────────────────────────────────────

const RuleScheduleSchema = z.object({
  frequency: z.enum(['hourly', 'daily']),
});

// ─── Rule ─────────────────────────────────────────────────────────────────────

export const UnifiedRuleSchema = z.object({
  id: z.string(),
  platform: PlatformSchema,
  name: z.string().min(1),
  enabled: z.boolean(),
  applies_to: z.object({
    entity_type: z.enum(['campaign', 'adset', 'ad']),
    entity_ids: z.array(z.string()).optional(),
    all_in_account: z.boolean().optional(),
  }),
  conditions: z.array(RuleConditionSchema).min(1),
  condition_operator: z.enum(['AND', 'OR']).default('AND'),
  actions: z.array(RuleActionSchema).min(1),
  schedule: RuleScheduleSchema,
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
export type UnifiedRule = z.infer<typeof UnifiedRuleSchema>;

export const CreateRuleInputSchema = z
  .object({
    platform: PlatformSchema,
    name: z.string().min(1),
    enabled: z.boolean(),
    applies_to: z.object({
      entity_type: z.enum(['campaign', 'adset', 'ad']),
      entity_ids: z.array(z.string()).optional(),
      all_in_account: z.boolean().optional(),
    }),
    conditions: z.array(RuleConditionSchema).min(1),
    condition_operator: z.enum(['AND', 'OR']).default('AND'),
    actions: z.array(RuleActionSchema).min(1),
    schedule: RuleScheduleSchema,
  })
  .strict();
export type CreateRuleInput = z.infer<typeof CreateRuleInputSchema>;
