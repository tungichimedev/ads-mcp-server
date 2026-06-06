import { z } from 'zod';

export const MatchTypeSchema = z.enum(['BROAD', 'PHRASE', 'EXACT']);
export type MatchType = z.infer<typeof MatchTypeSchema>;

export const KeywordStatusSchema = z.enum(['ENABLED', 'PAUSED', 'REMOVED']);
export type KeywordStatus = z.infer<typeof KeywordStatusSchema>;

export const UnifiedKeywordSchema = z.object({
  id: z.string(),
  text: z.string(),
  // String (not enum) because platform APIs may return non-standard values
  match_type: MatchTypeSchema.or(z.string()),
  status: KeywordStatusSchema.or(z.string()),
  ad_group_id: z.string().optional(),
  negative: z.boolean().optional(),
  entity_type: z.enum(['campaign', 'ad_group']).optional(),
  entity_id: z.string().optional(),
});
export type UnifiedKeyword = z.infer<typeof UnifiedKeywordSchema>;

export const UnifiedSearchTermSchema = z.object({
  search_term: z.string(),
  status: z.string(),
  impressions: z.number().nonnegative(),
  clicks: z.number().nonnegative(),
  spend: z.number().nonnegative(),
  ctr: z.number().nonnegative(),
  cpc: z.number().nonnegative(),
  conversions: z.number().nonnegative(),
  date: z.string().optional(),
  ad_group_id: z.string(),
});
export type UnifiedSearchTerm = z.infer<typeof UnifiedSearchTermSchema>;

export const KeywordMutationResultSchema = z.object({
  ad_group_id: z.string().optional(),
  entity_id: z.string().optional(),
  entity_type: z.enum(['campaign', 'ad_group']).optional(),
  keywords_added: z.number().nonnegative(),
});
export type KeywordMutationResult = z.infer<typeof KeywordMutationResultSchema>;
