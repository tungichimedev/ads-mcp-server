import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';

// ---------------------------------------------------------------------------
// Input shape helpers
// ---------------------------------------------------------------------------

function str(v: unknown): string {
  return typeof v === 'string' ? v : String(v ?? '');
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
// trackingTools
// ---------------------------------------------------------------------------

export function trackingTools(ctx: ToolContext) {
  return {

    // ─── list_pixels ───────────────────────────────────────────────────────

    async list_pixels(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listPixels(adapterCtx);
      });
    },

    // ─── get_pixel_status ──────────────────────────────────────────────────

    async get_pixel_status(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const pixelId = str(args['pixel_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getPixelStatus(adapterCtx, pixelId);
      });
    },

    // ─── list_conversion_events ────────────────────────────────────────────

    async list_conversion_events(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.listConversionEvents(adapterCtx);
      });
    },

    // ─── get_event_match_quality ───────────────────────────────────────────

    async get_event_match_quality(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const pixelId = str(args['pixel_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getEventMatchQuality(adapterCtx, pixelId);
      });
    },

    // ─── validate_tracking_urls ────────────────────────────────────────────

    async validate_tracking_urls(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entityType = str(args['entity_type']);
      const entityId = str(args['entity_id']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.validateTrackingUrls(adapterCtx, entityType, entityId);
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const TRACKING_TOOL_DEFINITIONS = [
  {
    name: 'list_pixels',
    description: 'List tracking pixels (Meta Pixel, Google Tag, etc.) for an account.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'get_pixel_status',
    description: 'Get the health and firing status of a specific pixel.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        pixel_id: { type: 'string', description: 'Pixel ID to check' },
      },
      required: ['platform', 'pixel_id'],
    },
  },
  {
    name: 'list_conversion_events',
    description: 'List all configured conversion events for an account.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
      },
      required: ['platform'],
    },
  },
  {
    name: 'get_event_match_quality',
    description: 'Get the event match quality (EMQ) score for a pixel.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        pixel_id: { type: 'string', description: 'Pixel ID to check event match quality for' },
      },
      required: ['platform', 'pixel_id'],
    },
  },
  {
    name: 'validate_tracking_urls',
    description: 'Validate tracking URLs on ads or ad sets to check for broken links or missing parameters.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        entity_type: { type: 'string', description: 'Entity type: ad or adset' },
        entity_id: { type: 'string', description: 'Entity ID to validate URLs for' },
      },
      required: ['platform', 'entity_type', 'entity_id'],
    },
  },
] as const;
