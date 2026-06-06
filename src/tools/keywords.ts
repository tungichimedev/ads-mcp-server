import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import { enforceWritable } from '../safety/read-only.js';
import { AdsError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

// ---------------------------------------------------------------------------
// Build AdapterContext
// ---------------------------------------------------------------------------

function buildAdapterCtx(
  ctx: ToolContext,
  platform: string,
  account: string,
): import('../adapters/base.js').AdapterContext {
  const accountMeta =
    (ctx.config.platforms?.[platform]?.accounts?.[account] as Record<string, unknown>) ?? {};
  return { account, accountMeta };
}

// ---------------------------------------------------------------------------
// Google-only guard
// ---------------------------------------------------------------------------

function assertGoogle(platform: string): void {
  if (platform !== 'google') {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      platform,
      `Keyword tools are only available for the Google Ads platform. Got: "${platform}"`,
      false,
    );
  }
}

// ---------------------------------------------------------------------------
// keywordTools
// ---------------------------------------------------------------------------

export function keywordTools(ctx: ToolContext) {
  return {

    // ─── list_keywords ─────────────────────────────────────────────────────

    async list_keywords(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adGroupId = str(args['ad_group_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listKeywords(
          adapterCtx,
          adGroupId,
          typeof args['limit'] === 'number' ? args['limit'] : 50,
          args['cursor'] as string | undefined,
        );
      });
    },

    // ─── add_keywords ──────────────────────────────────────────────────────

    async add_keywords(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      enforceWritable('add_keywords');

      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adGroupId = str(args['ad_group_id']);
      const keywords = asStringArray(args['keywords']);
      const matchType = str(args['match_type'] ?? 'broad');
      const dryRun = args['dry_run'] === true;

      if (dryRun) {
        return { dry_run: true, ad_group_id: adGroupId, keywords, match_type: matchType };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.addKeywords(adapterCtx, adGroupId, keywords, matchType);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'add_keywords',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { ad_group_id: adGroupId, keywords, match_type: matchType },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── remove_keywords ───────────────────────────────────────────────────

    async remove_keywords(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      enforceWritable('remove_keywords');

      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adGroupId = str(args['ad_group_id']);
      const keywordIds = asStringArray(args['keyword_ids']);
      const dryRun = args['dry_run'] === true;

      if (dryRun) {
        return { dry_run: true, ad_group_id: adGroupId, keyword_ids: keywordIds };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        await adapter.removeKeywords(adapterCtx, adGroupId, keywordIds);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'remove_keywords',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { ad_group_id: adGroupId, keyword_ids: keywordIds },
          result: 'ok',
        });

        return { ad_group_id: adGroupId, removed: keywordIds.length };
      });
    },

    // ─── list_negative_keywords ────────────────────────────────────────────

    async list_negative_keywords(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entityId = str(args['entity_id']);
      const entityType = (str(args['entity_type'] ?? 'campaign')) as 'campaign' | 'ad_group';

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listNegativeKeywords(adapterCtx, entityId, entityType);
      });
    },

    // ─── add_negative_keywords ─────────────────────────────────────────────

    async add_negative_keywords(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      enforceWritable('add_negative_keywords');

      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entityId = str(args['entity_id']);
      const entityType = (str(args['entity_type'] ?? 'campaign')) as 'campaign' | 'ad_group';
      const keywords = asStringArray(args['keywords']);
      const matchType = str(args['match_type'] ?? 'broad');
      const dryRun = args['dry_run'] === true;

      if (dryRun) {
        return { dry_run: true, entity_id: entityId, entity_type: entityType, keywords, match_type: matchType };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.addNegativeKeywords(adapterCtx, entityId, entityType, keywords, matchType);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'add_negative_keywords',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { entity_id: entityId, entity_type: entityType, keywords, match_type: matchType },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── get_search_terms ──────────────────────────────────────────────────

    async get_search_terms(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      assertGoogle(platform);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adGroupId = str(args['ad_group_id']);
      const dateRange = (args['date_range'] ?? {}) as import('../models/platform.js').DateRange;

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getSearchTerms(adapterCtx, adGroupId, dateRange);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const KEYWORD_TOOL_DEFINITIONS = [
  {
    name: 'list_keywords',
    description: 'List keywords for a Google Ads ad group. Google only.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['google'], description: 'Must be "google"' },
        account: { type: 'string' },
        ad_group_id: { type: 'string', description: 'Ad group ID to list keywords for' },
        limit: { type: 'number' },
        cursor: { type: 'string' },
      },
      required: ['platform', 'ad_group_id'],
    },
  },
  {
    name: 'add_keywords',
    description: 'Add keywords to a Google Ads ad group. Google only. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['google'] },
        account: { type: 'string' },
        ad_group_id: { type: 'string' },
        keywords: { type: 'array', items: { type: 'string' }, description: 'List of keyword text strings' },
        match_type: { type: 'string', enum: ['broad', 'phrase', 'exact'], description: 'Keyword match type (default: broad)' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'ad_group_id', 'keywords'],
    },
  },
  {
    name: 'remove_keywords',
    description: 'Remove keywords from a Google Ads ad group by ID. Google only. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['google'] },
        account: { type: 'string' },
        ad_group_id: { type: 'string' },
        keyword_ids: { type: 'array', items: { type: 'string' }, description: 'IDs of keywords to remove' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'ad_group_id', 'keyword_ids'],
    },
  },
  {
    name: 'list_negative_keywords',
    description: 'List negative keywords for a Google Ads campaign or ad group. Google only.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['google'] },
        account: { type: 'string' },
        entity_id: { type: 'string', description: 'Campaign or ad group ID' },
        entity_type: { type: 'string', enum: ['campaign', 'ad_group'], description: 'Entity type (default: campaign)' },
      },
      required: ['platform', 'entity_id'],
    },
  },
  {
    name: 'add_negative_keywords',
    description: 'Add negative keywords to a Google Ads campaign or ad group. Google only. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['google'] },
        account: { type: 'string' },
        entity_id: { type: 'string', description: 'Campaign or ad group ID' },
        entity_type: { type: 'string', enum: ['campaign', 'ad_group'], description: 'Entity type (default: campaign)' },
        keywords: { type: 'array', items: { type: 'string' } },
        match_type: { type: 'string', enum: ['broad', 'phrase', 'exact'] },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'entity_id', 'keywords'],
    },
  },
  {
    name: 'get_search_terms',
    description: 'Get search terms report for a Google Ads ad group. Google only.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: ['google'] },
        account: { type: 'string' },
        ad_group_id: { type: 'string' },
        date_range: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
      },
      required: ['platform', 'ad_group_id', 'date_range'],
    },
  },
] as const;
