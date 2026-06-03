import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import { enforceWritable } from '../safety/read-only.js';

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
// audienceTools
// ---------------------------------------------------------------------------

export function audienceTools(ctx: ToolContext) {
  return {

    // ─── list_audiences ────────────────────────────────────────────────────

    async list_audiences(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listAudiences(
          adapterCtx,
          args['type'] as string | undefined,
          typeof args['limit'] === 'number' ? args['limit'] : 20,
          args['cursor'] as string | undefined,
        );
      });
    },

    // ─── create_audience ───────────────────────────────────────────────────

    async create_audience(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('create_audience');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const dryRun = args['dry_run'] === true;
      const input = asRecord(args['input']);

      if (dryRun) {
        return { dry_run: true, preview: input };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.createAudience(adapterCtx, input);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'create_audience',
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

    // ─── update_audience ───────────────────────────────────────────────────

    async update_audience(args: Record<string, unknown>): Promise<unknown> {
      enforceWritable('update_audience');

      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const audienceId = str(args['audience_id']);
      const dryRun = args['dry_run'] === true;
      const updates = asRecord(args['updates']);

      if (dryRun) {
        return { dry_run: true, audience_id: audienceId, preview: updates };
      }

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        const result = await adapter.updateAudience(adapterCtx, audienceId, updates);

        const fingerprint = await ctx.tokenManager
          .credentialFingerprint(platform, account)
          .catch(() => 'unknown');

        ctx.auditLog.log({
          tool: 'update_audience',
          platform,
          account,
          credential_fingerprint: fingerprint,
          dry_run: false,
          params: { audience_id: audienceId, ...updates },
          result: 'ok',
        });

        return result;
      });
    },

    // ─── get_audience_size ─────────────────────────────────────────────────

    async get_audience_size(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const targeting = asRecord(args['targeting']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getAudienceSize(adapterCtx, targeting);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const AUDIENCE_TOOL_DEFINITIONS = [
  {
    name: 'list_audiences',
    description: 'List audiences for a given platform and account.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        type: { type: 'string', description: 'Filter by audience type (custom, lookalike, saved)' },
        limit: { type: 'number', description: 'Max results per page (default 20)' },
        cursor: { type: 'string', description: 'Pagination cursor from previous response' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'create_audience',
    description: 'Create a new audience. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        input: { type: 'object', description: 'Audience definition (name, type, rules, etc.)' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'input'],
    },
  },
  {
    name: 'update_audience',
    description: 'Update an existing audience. Supports dry_run.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        audience_id: { type: 'string' },
        updates: { type: 'object', description: 'Fields to update' },
        dry_run: { type: 'boolean' },
      },
      required: ['platform', 'audience_id', 'updates'],
    },
  },
  {
    name: 'get_audience_size',
    description: 'Estimate the reach for a given targeting specification.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        targeting: { type: 'object', description: 'Targeting spec to estimate reach for' },
      },
      required: ['platform', 'targeting'],
    },
  },
] as const;
