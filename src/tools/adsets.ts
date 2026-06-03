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
// adsetTools
// ---------------------------------------------------------------------------

export function adsetTools(ctx: ToolContext) {
  return {

    // ─── list_adsets ───────────────────────────────────────────────────────

    async list_adsets(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const campaignId = str(args['campaign_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listAdSets(
          adapterCtx,
          campaignId,
          typeof args['limit'] === 'number' ? args['limit'] : 20,
          args['cursor'] as string | undefined,
        );
      });
    },

    // ─── get_adset ─────────────────────────────────────────────────────────

    async get_adset(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adsetId = str(args['adset_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getAdSet(adapterCtx, adsetId);
      });
    },

    // ─── create_adset ──────────────────────────────────────────────────────

    async create_adset(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('create_adset');

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
        const result = await adapter.createAdSet(adapterCtx, input);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'create_adset',
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

    // ─── update_adset ──────────────────────────────────────────────────────

    async update_adset(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('update_adset');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adsetId = str(args['adset_id']);
      const adapter = getAdapter(ctx, platform);
      const platformOptions = args['platform_options'] as Record<string, unknown> | undefined;
      validatePlatformOptions(adapter, platformOptions);

      const dryRun = args['dry_run'] === true;
      const updates = asRecord(args['updates']);

      if (dryRun) {
        return { dry_run: true, adset_id: adsetId, preview: updates };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.updateAdSet(adapterCtx, adsetId, updates);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'update_adset',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { adset_id: adsetId, ...updates },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── set_adset_status ──────────────────────────────────────────────────

    async set_adset_status(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('set_adset_status');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adsetId = str(args['adset_id']);
      const status = str(args['status']);
      const dryRun = args['dry_run'] === true;

      if (dryRun) {
        return { dry_run: true, adset_id: adsetId, status };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.setAdSetStatus(adapterCtx, adsetId, status);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'set_adset_status',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { adset_id: adsetId, status },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── delete_adset ──────────────────────────────────────────────────────

    async delete_adset(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('delete_adset');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const adsetId = str(args['adset_id']);

      // Step 1: if no confirmation_token provided, issue one
      const confirmationToken = args['confirmation_token'] as string | undefined;
      if (!confirmationToken) {
        return ctx.deleteGuard.requestConfirmation(
          'adset',
          adsetId,
          `Delete ad set ${adsetId} on platform ${platform} / account ${account}`,
        );
      }

      // Step 2: validate the token
      const confirmed = ctx.deleteGuard.confirm(confirmationToken);
      if (!confirmed) {
        throw new AdsError(
          'CONFIRMATION_REQUIRED',
          platform,
          `Invalid or expired confirmation_token. Request a new one by calling delete_adset without confirmation_token.`,
          false,
        );
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        await adapter.deleteAdSet(adapterCtx, adsetId);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'delete_adset',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { adset_id: adsetId },
          result: 'ok',
        });

        return { deleted: true, adset_id: adsetId };
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const ADSET_TOOL_DEFINITIONS = [
  {
    name: 'list_adsets',
    description: 'List ad sets within a campaign.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        campaign_id: { type: 'string', description: 'Campaign ID to list ad sets for' },
        limit: { type: 'number', description: 'Max results per page (default 20)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
      },
      required: ['platform', 'campaign_id'],
    },
  },
  {
    name: 'get_adset',
    description: 'Get a single ad set by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        adset_id: { type: 'string' },
      },
      required: ['platform', 'adset_id'],
    },
  },
  {
    name: 'create_adset',
    description: 'Create a new ad set. Supports dry_run to preview without creating.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        input: { type: 'object', description: 'Ad set fields (name, campaign_id, targeting, budget, schedule, etc.)' },
        platform_options: { type: 'object', description: 'Platform-specific options' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'input'],
    },
  },
  {
    name: 'update_adset',
    description: 'Update an existing ad set. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        adset_id: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update' },
        platform_options: { type: 'object' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'adset_id', 'updates'],
    },
  },
  {
    name: 'set_adset_status',
    description: 'Set the status of an ad set. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        adset_id: { type: 'string' },
        status: { type: 'string', enum: ['active', 'paused', 'archived'] },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'adset_id', 'status'],
    },
  },
  {
    name: 'delete_adset',
    description:
      'Delete an ad set. First call returns a confirmation_token. Second call with that token executes the delete.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        adset_id: { type: 'string' },
        confirmation_token: { type: 'string', description: 'Token from first call. Omit on first call to get token.' },
      },
      required: ['platform', 'adset_id'],
    },
  },
] as const;
