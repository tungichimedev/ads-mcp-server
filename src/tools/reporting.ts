import type { ToolContext } from './register.js';
import { getAdapter, resolveAccount } from './register.js';
import type { DateRange } from '../models/platform.js';

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

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

// Accept both the documented schema shape ({start, end}) and the internal
// DateRange shape ({start_date, end_date}). Without this, {start, end} is
// silently dropped, the Meta adapter serializes time_range as "{}" and the API
// rejects it with "(#100) param time_range must be non-empty".
function normalizeDateRange(v: unknown): DateRange {
  const raw = asRecord(v);
  const start = raw['start_date'] ?? raw['start'];
  const end = raw['end_date'] ?? raw['end'];
  return {
    start_date: start == null ? '' : String(start),
    end_date: end == null ? undefined : String(end),
  } as DateRange;
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
// Date range helper — shifts a date range back by N days for trend comparison
// ---------------------------------------------------------------------------

function shiftDateRange(dateRange: DateRange, days: number): DateRange {
  const shift = (iso: string, d: number): string => {
    const date = new Date(iso);
    date.setUTCDate(date.getUTCDate() - d);
    return date.toISOString().slice(0, 10);
  };

  // Calculate period length
  const start = new Date(dateRange.start_date);
  const end = new Date(dateRange.end_date ?? dateRange.start_date);
  const periodDays = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;

  const gap = days === 0 ? periodDays : days;

  return {
    start_date: shift(dateRange.start_date, gap),
    end_date: shift(dateRange.end_date ?? dateRange.start_date, gap),
  };
}

// ---------------------------------------------------------------------------
// reportingTools
// ---------------------------------------------------------------------------

export function reportingTools(ctx: ToolContext) {
  return {

    // ─── get_performance ───────────────────────────────────────────────────

    async get_performance(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entityType = str(args['entity_type']);
      const entityId = str(args['entity_id']);
      const dateRange = normalizeDateRange(args['date_range']);
      const granularity = str(args['granularity'] ?? 'day');
      const attributionWindow = args['attribution_window'] as
        | import('../models/platform.js').AttributionWindow
        | undefined;

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getPerformance(
          adapterCtx,
          entityType,
          entityId,
          dateRange,
          granularity,
          attributionWindow,
        );
      });
    },

    // ─── get_insights ──────────────────────────────────────────────────────

    async get_insights(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entityId = str(args['entity_id']);
      const breakdowns = asStringArray(args['breakdowns']);
      const dateRange = normalizeDateRange(args['date_range']);

      return ctx.rateLimiter.execute(platform, account, async () => {
        const adapter = getAdapter(ctx, platform);
        const adapterCtx = buildAdapterCtx(ctx, platform, account);
        return adapter.getInsights(adapterCtx, entityId, breakdowns, dateRange);
      });
    },

    // ─── compare_performance ───────────────────────────────────────────────
    // Iterates over entities array, fetches performance for each, aggregates.

    async compare_performance(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entities = Array.isArray(args['entities'])
        ? (args['entities'] as Array<Record<string, unknown>>)
        : [];
      const dateRange = normalizeDateRange(args['date_range']);
      const granularity = str(args['granularity'] ?? 'total');

      const results = await Promise.all(
        entities.map(async (entity) => {
          const entityType = str(entity['type']);
          const entityId = str(entity['id']);

          return ctx.rateLimiter.execute(platform, account, async () => {
            const adapter = getAdapter(ctx, platform);
            const adapterCtx = buildAdapterCtx(ctx, platform, account);
            const data = await adapter.getPerformance(
              adapterCtx,
              entityType,
              entityId,
              dateRange,
              granularity,
            );
            return { entity_type: entityType, entity_id: entityId, data };
          });
        }),
      );

      return { entities: results, date_range: dateRange };
    },

    // ─── get_performance_trends ────────────────────────────────────────────
    // Calls getPerformance for the current period and the comparison period,
    // then computes change_pct and direction per metric.

    async get_performance_trends(args: Record<string, unknown>): Promise<unknown> {
      const platform = str(args['platform']);
      const account = resolveAccount(ctx, platform, args['account'] as string | undefined);
      const entityType = str(args['entity_type']);
      const entityId = str(args['entity_id']);
      const dateRange = normalizeDateRange(args['date_range']);
      const granularity = str(args['granularity'] ?? 'total');
      // compare_period: 'previous_period' (default) | 'previous_year' | number (days back)
      const comparePeriod = args['compare_period'] ?? 'previous_period';

      let daysBack = 0;
      if (typeof comparePeriod === 'number') {
        daysBack = comparePeriod;
      } else if (comparePeriod === 'previous_year') {
        daysBack = 365;
      }
      // 'previous_period' uses 0 (shiftDateRange auto-detects period length)

      const priorDateRange = shiftDateRange(dateRange, daysBack);

      const [current, prior] = await Promise.all([
        ctx.rateLimiter.execute(platform, account, async () => {
          const adapter = getAdapter(ctx, platform);
          const adapterCtx = buildAdapterCtx(ctx, platform, account);
          return adapter.getPerformance(adapterCtx, entityType, entityId, dateRange, granularity);
        }),
        ctx.rateLimiter.execute(platform, account, async () => {
          const adapter = getAdapter(ctx, platform);
          const adapterCtx = buildAdapterCtx(ctx, platform, account);
          return adapter.getPerformance(adapterCtx, entityType, entityId, priorDateRange, granularity);
        }),
      ]);

      // Aggregate current and prior into a single total row each
      const aggregate = (rows: Record<string, unknown>[]): Record<string, number> => {
        const totals: Record<string, number> = {};
        for (const row of rows) {
          for (const [key, val] of Object.entries(row)) {
            if (typeof val === 'number') {
              totals[key] = (totals[key] ?? 0) + val;
            }
          }
        }
        return totals;
      };

      const currentTotals = aggregate(current);
      const priorTotals = aggregate(prior);

      const trends: Record<string, { current: number; prior: number; change_pct: number | null; direction: 'up' | 'down' | 'flat' }> = {};
      const allKeys = new Set([...Object.keys(currentTotals), ...Object.keys(priorTotals)]);

      for (const key of allKeys) {
        const c = currentTotals[key] ?? 0;
        const p = priorTotals[key] ?? 0;
        let change_pct: number | null = null;
        let direction: 'up' | 'down' | 'flat' = 'flat';

        if (p !== 0) {
          change_pct = Math.round(((c - p) / p) * 10000) / 100;
          direction = change_pct > 0 ? 'up' : change_pct < 0 ? 'down' : 'flat';
        } else if (c > 0) {
          direction = 'up';
        }

        trends[key] = { current: c, prior: p, change_pct, direction };
      }

      return {
        entity_type: entityType,
        entity_id: entityId,
        current_period: dateRange,
        comparison_period: priorDateRange,
        trends,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const REPORTING_TOOL_DEFINITIONS = [
  {
    name: 'get_performance',
    description: 'Get performance metrics for a campaign, ad set, or ad over a date range.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string', description: 'Ad platform (meta, google, tiktok)' },
        account: { type: 'string', description: 'Account name (optional if default configured)' },
        entity_type: { type: 'string', description: 'Entity type: campaign, adset, ad' },
        entity_id: { type: 'string', description: 'Entity ID' },
        date_range: {
          type: 'object',
          description: 'Date range with start and end (YYYY-MM-DD)',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
        granularity: {
          type: 'string',
          enum: ['day', 'week', 'month', 'total'],
          description: 'Time granularity for the report (default: day)',
        },
        attribution_window: {
          type: 'object',
          description: 'Attribution window config (click_days, view_days)',
        },
      },
      required: ['platform', 'entity_type', 'entity_id', 'date_range'],
    },
  },
  {
    name: 'get_insights',
    description: 'Get insights broken down by dimensions (age, gender, placement, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        entity_id: { type: 'string', description: 'Entity ID to get insights for' },
        breakdowns: {
          type: 'array',
          items: { type: 'string' },
          description: 'Breakdown dimensions (e.g. age, gender, placement, country)',
        },
        date_range: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
      },
      required: ['platform', 'entity_id', 'breakdowns', 'date_range'],
    },
  },
  {
    name: 'compare_performance',
    description: 'Compare performance metrics across multiple entities side by side.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        entities: {
          type: 'array',
          description: 'Array of entities to compare, each with type and id',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string' },
              id: { type: 'string' },
            },
            required: ['type', 'id'],
          },
        },
        date_range: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
        granularity: { type: 'string', enum: ['day', 'week', 'month', 'total'] },
      },
      required: ['platform', 'entities', 'date_range'],
    },
  },
  {
    name: 'get_performance_trends',
    description: 'Get performance metrics with period-over-period trend comparison.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: { type: 'string' },
        account: { type: 'string' },
        entity_type: { type: 'string' },
        entity_id: { type: 'string' },
        date_range: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
          },
          required: ['start', 'end'],
        },
        granularity: { type: 'string', enum: ['day', 'week', 'month', 'total'] },
        compare_period: {
          description: 'Comparison period: "previous_period" (default), "previous_year", or number of days back',
        },
      },
      required: ['platform', 'entity_type', 'entity_id', 'date_range'],
    },
  },
] as const;
