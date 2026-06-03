import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount, validatePlatformOptions } from './register.js';
import { enforceWritable } from '../safety/read-only.js';
import { AdsError } from '../utils/errors.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
}

function asRecord(v: unknown): Record<string, unknown> {
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return {};
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
// adTools
// ---------------------------------------------------------------------------

export function adTools(ctx: ToolContext) {
  return {

    // ─── list_ads ──────────────────────────────────────────────────────────

    async list_ads(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adsetId = str(args['adset_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listAds(
          adapterCtx,
          adsetId,
          typeof args['limit'] === 'number' ? args['limit'] : 20,
          args['cursor'] as string | undefined,
        );
      });
    },

    // ─── get_ad ────────────────────────────────────────────────────────────

    async get_ad(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adId = str(args['ad_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getAd(adapterCtx, adId);
      });
    },

    // ─── create_ad ─────────────────────────────────────────────────────────

    async create_ad(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('create_ad');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adapter = getAdapter(ctx, platform);
      const platformOptions = args['platform_options'] as Record<string, unknown> | undefined;
      validatePlatformOptions(adapter, platformOptions);

      const dryRun = args['dry_run'] === true;
      const input: Record<string, unknown> = {
        ...(asRecord(args['input'])),
        ...(platformOptions ? { platform_options: platformOptions } : {}),
      };

      if (dryRun) {
        return { dry_run: true, preview: input };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.createAd(adapterCtx, input);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'create_ad',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: input,
          result: 'ok',
        });

        return result;
      });
    },

    // ─── update_ad ─────────────────────────────────────────────────────────

    async update_ad(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('update_ad');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adId = str(args['ad_id']);
      const adapter = getAdapter(ctx, platform);
      const platformOptions = args['platform_options'] as Record<string, unknown> | undefined;
      validatePlatformOptions(adapter, platformOptions);

      const dryRun = args['dry_run'] === true;
      const updates = asRecord(args['updates']);

      if (dryRun) {
        return { dry_run: true, ad_id: adId, preview: updates };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.updateAd(adapterCtx, adId, updates);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'update_ad',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { ad_id: adId, ...updates },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── delete_ad ─────────────────────────────────────────────────────────

    async delete_ad(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('delete_ad');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adId = str(args['ad_id']);

      // Step 1: if no confirmation_token provided, issue one
      const confirmationToken = args['confirmation_token'] as string | undefined;
      if (!confirmationToken) {
        return ctx.deleteGuard.requestConfirmation(
          'ad',
          adId,
          `Delete ad ${adId} on platform ${platform} / account ${account}`,
        );
      }

      // Step 2: validate the token
      const confirmed = ctx.deleteGuard.confirm(confirmationToken);
      if (!confirmed) {
        throw new AdsError(
          'CONFIRMATION_REQUIRED',
          platform,
          `Invalid or expired confirmation_token. Request a new one by calling delete_ad without confirmation_token.`,
          false,
        );
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        await adapter.deleteAd(adapterCtx, adId);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'delete_ad',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { ad_id: adId },
          result: 'ok',
        });

        return { deleted: true, ad_id: adId };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const AD_TOOL_DEFINITIONS = [
  {
    name: 'list_ads',
    description: 'List ads within an ad set.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        adset_id: { type: 'string', description: 'Ad set ID to list ads for' },
        limit: { type: 'number', description: 'Max results per page (default 20)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
      },
      required: ['platform', 'adset_id'],
    },
  },
  {
    name: 'get_ad',
    description: 'Get a single ad by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        ad_id: { type: 'string' },
      },
      required: ['platform', 'ad_id'],
    },
  },
  {
    name: 'create_ad',
    description: 'Create a new ad. Supports dry_run to preview without creating.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        input: { type: 'object', description: 'Ad fields (name, adset_id, creative_id, status, etc.)' },
        platform_options: { type: 'object', description: 'Platform-specific options' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'input'],
    },
  },
  {
    name: 'update_ad',
    description: 'Update an existing ad. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        ad_id: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update' },
        platform_options: { type: 'object' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'ad_id', 'updates'],
    },
  },
  {
    name: 'delete_ad',
    description:
      'Delete an ad. First call returns a confirmation_token. Second call with that token executes the delete.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        ad_id: { type: 'string' },
        confirmation_token: { type: 'string', description: 'Token from first call. Omit on first call to get token.' },
      },
      required: ['platform', 'ad_id'],
    },
  },
] as const;
