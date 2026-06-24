import type { BaseAdapter, AdapterContext } from '../base.js';
import type { PaginatedResponse } from '../../models/pagination.js';
import type { UnifiedCampaign } from '../../models/campaign.js';
import type { UnifiedAdSet } from '../../models/adset.js';
import type { UnifiedAd } from '../../models/ad.js';
import type { DateRange, AttributionWindow } from '../../models/platform.js';
import { AdsError } from '../../utils/errors.js';
import {
  toMetaObjective,
  fromMetaObjective,
  toMetaStatus,
  fromMetaStatus,
  toMetaCampaign,
  fromMetaCampaign,
  centsToDollars,
  toMinorUnits,
  fromMinorUnits,
  type MetaCampaign,
} from './mapper.js';

const META_GRAPH_BASE = 'https://graph.facebook.com/v21.0';

// ─── Internal response shapes ────────────────────────────────────────────────

interface MetaErrorBody {
  error?: {
    code?: number;
    message?: string;
    type?: string;
  };
}

interface MetaPagedResponse<T> {
  data: T[];
  paging?: {
    cursors?: {
      before?: string;
      after?: string;
    };
    next?: string;
  };
}

// ─── MetaAdSet raw shape ─────────────────────────────────────────────────────

interface MetaAdSet {
  id: string;
  name: string;
  campaign_id: string;
  status: string;
  targeting?: Record<string, unknown>;
  bid_amount?: number;
  bid_strategy?: string;
  daily_budget?: string;
  lifetime_budget?: string;
  start_time?: string;
  end_time?: string;
  created_time: string;
  updated_time: string;
  [key: string]: unknown;
}

// ─── MetaAd raw shape ────────────────────────────────────────────────────────

interface MetaAd {
  id: string;
  name: string;
  adset_id: string;
  campaign_id: string;
  status: string;
  creative?: Record<string, unknown>;
  created_time: string;
  updated_time: string;
  [key: string]: unknown;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mapMetaAdSet(meta: MetaAdSet): UnifiedAdSet {
  const targeting = (meta.targeting as Record<string, unknown>) ?? {};

  // Normalise bid
  const bidStrategy = meta.bid_strategy ?? 'LOWEST_COST_WITHOUT_CAP';
  const bidMap: Record<string, UnifiedAdSet['bid']['strategy']> = {
    LOWEST_COST_WITHOUT_CAP: 'lowest_cost',
    LOWEST_COST_WITH_BID_CAP: 'bid_cap',
    COST_CAP: 'cost_cap',
    TARGET_COST: 'target_cost',
    MINIMUM_ROAS: 'target_roas',
  };
  const unifiedBidStrategy: UnifiedAdSet['bid']['strategy'] =
    bidMap[bidStrategy] ?? 'lowest_cost';

  const locations = (targeting['geo_locations'] as { countries?: string[] } | undefined)
    ?.countries ?? [];
  const ageMin = (targeting['age_min'] as number | undefined);
  const ageMax = (targeting['age_max'] as number | undefined);
  const genderArr = targeting['genders'] as number[] | undefined;
  let gender: 'male' | 'female' | 'all' = 'all';
  if (genderArr && genderArr.length === 1) {
    gender = genderArr[0] === 1 ? 'male' : 'female';
  }

  return {
    id: String(meta.id),
    platform: 'meta',
    campaign_id: String(meta.campaign_id),
    name: meta.name,
    status: fromMetaStatus(meta.status),
    targeting: {
      locations,
      interests: [],
      behaviors: [],
      audiences: [],
      languages: [],
      devices: [],
      os: [],
      ...(ageMin !== undefined && { age_min: ageMin }),
      ...(ageMax !== undefined && { age_max: ageMax }),
      gender,
    },
    bid: {
      strategy: unifiedBidStrategy,
      ...(meta.bid_amount !== undefined && { amount: centsToDollars(meta.bid_amount) }),
    },
    ...(meta.daily_budget !== undefined && {
      daily_budget: centsToDollars(parseInt(meta.daily_budget, 10)),
    }),
    ...(meta.lifetime_budget !== undefined && {
      lifetime_budget: centsToDollars(parseInt(meta.lifetime_budget, 10)),
    }),
    created_at: meta.created_time,
    updated_at: meta.updated_time,
    platform_data: meta as Record<string, unknown>,
  };
}

function mapMetaAd(meta: MetaAd): UnifiedAd {
  // Build a minimal creative from the Meta ad creative object
  const rawCreative = (meta.creative ?? {}) as Record<string, unknown>;
  const landingUrl =
    (rawCreative['object_url'] as string | undefined) ??
    'https://www.facebook.com';
  const headline = (rawCreative['title'] as string | undefined) ?? meta.name;

  return {
    id: String(meta.id),
    platform: 'meta',
    adset_id: String(meta.adset_id),
    campaign_id: String(meta.campaign_id),
    name: meta.name,
    status: fromMetaStatus(meta.status) as UnifiedAd['status'],
    creative: {
      type: 'image',
      headline,
      image_url: (rawCreative['image_url'] as string | undefined) ?? 'https://example.com/placeholder.jpg',
      landing_url: landingUrl as `https://${string}`,
    },
    created_at: meta.created_time,
    updated_at: meta.updated_time,
    platform_data: meta as Record<string, unknown>,
  };
}

// ─── MetaAdapter ─────────────────────────────────────────────────────────────

export class MetaAdapter implements BaseAdapter {
  readonly platform = 'meta' as const;
  readonly allowedPlatformOptions = [
    'special_ad_categories',
    'bid_strategy',
    'optimization_goal',
    'promoted_object',
    'rule_custom_schedule',
  ];

  constructor(private readonly getToken: (account: string) => Promise<string>) {}

  // ─── Private fetch ──────────────────────────────────────────────────────────

  private async fetch<T = unknown>(
    path: string,
    method: 'GET' | 'POST' | 'DELETE',
    account: string,
    body?: Record<string, unknown>,
    queryParams?: Record<string, string>
  ): Promise<T> {
    const token = await this.getToken(account);

    let url: URL;
    if (path.startsWith('http')) {
      url = new URL(path);
    } else {
      url = new URL(`${META_GRAPH_BASE}${path}`);
    }

    let fetchOptions: RequestInit;

    if (method === 'GET' || method === 'DELETE') {
      // GET and DELETE: token + params go in the query string, no body. Sending a
      // JSON body on a DELETE makes the Graph API misroute it and return a
      // misleading "API version not supported" error.
      url.searchParams.set('access_token', token);
      if (queryParams) {
        for (const [k, v] of Object.entries(queryParams)) {
          url.searchParams.set(k, v);
        }
      }
      fetchOptions = { method };
    } else {
      // POST — token goes in the body
      if (queryParams) {
        for (const [k, v] of Object.entries(queryParams)) {
          url.searchParams.set(k, v);
        }
      }
      const payload = { ...body, access_token: token };
      fetchOptions = {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      };
    }

    const res = await globalThis.fetch(url.toString(), fetchOptions);
    const json = (await res.json()) as MetaErrorBody & T;

    if (!res.ok || (json as MetaErrorBody).error) {
      const errBody = (json as MetaErrorBody).error;
      const code = errBody?.code ?? 0;
      const message = errBody?.message ?? `HTTP ${res.status}`;

      if (res.status === 429 || code === 32) {
        throw new AdsError('RATE_LIMITED', 'meta', message, true, String(code));
      }
      if (res.status === 401 || code === 190) {
        throw new AdsError('AUTH_EXPIRED', 'meta', message, false, String(code));
      }
      throw new AdsError('ACCOUNT_ISSUE', 'meta', message, false, String(code));
    }

    return json as T;
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private adAccountId(ctx: AdapterContext): string {
    // Canonical config field is `account_id` (see AccountMetaSchema in
    // utils/config.ts). Fall back to the legacy `ad_account_id` key and then
    // the account name for back-compat.
    const id =
      (ctx.accountMeta['account_id'] as string | undefined) ??
      (ctx.accountMeta['ad_account_id'] as string | undefined) ??
      (ctx.account as string | undefined);
    if (!id) {
      throw new AdsError(
        'ACCOUNT_ISSUE',
        'meta',
        'account_id missing from accountMeta',
        false
      );
    }
    // Callers build URLs as `/act_${id}/...`, so return the bare id without
    // the `act_` prefix (config may store it either way).
    return id.startsWith('act_') ? id.slice(4) : id;
  }

  /** Account's ISO 4217 currency (from config), used to interpret Meta budget minor units. */
  private accountCurrency(ctx: AdapterContext): string {
    return (ctx.accountMeta['currency'] as string | undefined) ?? 'USD';
  }

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  async listCampaigns(
    ctx: AdapterContext,
    filters: { status?: string; dateRange?: DateRange },
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedCampaign>> {
    const actId = this.adAccountId(ctx);
    const params: Record<string, string> = {
      fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
      limit: String(limit),
    };
    if (filters.status) {
      params['effective_status'] = `["${toMetaStatus(filters.status as Parameters<typeof toMetaStatus>[0])  }"]`;
    }
    if (cursor) {
      params['after'] = cursor;
    }

    const resp = await this.fetch<MetaPagedResponse<MetaCampaign>>(
      `/act_${actId}/campaigns`,
      'GET',
      ctx.account,
      undefined,
      params
    );

    const currency = this.accountCurrency(ctx);
    const data = resp.data.map((c) => fromMetaCampaign(c, currency));
    const nextCursor = resp.paging?.cursors?.after;

    return {
      data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: !!resp.paging?.next,
        ...(nextCursor && { next_cursor: nextCursor }),
        ...(resp.paging?.cursors?.before && { prev_cursor: resp.paging.cursors.before }),
      },
    };
  }

  async getCampaign(ctx: AdapterContext, campaignId: string): Promise<UnifiedCampaign> {
    const meta = await this.fetch<MetaCampaign>(
      `/${campaignId}`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,status,objective,daily_budget,lifetime_budget,start_time,stop_time,created_time,updated_time',
      }
    );
    return fromMetaCampaign(meta, this.accountCurrency(ctx));
  }

  async createCampaign(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedCampaign> {
    const actId = this.adAccountId(ctx);
    // input is expected to be a UnifiedCampaign-like object or toMetaCampaign payload
    const base = typeof input['name'] === 'string' && typeof input['objective'] === 'string'
      ? toMetaCampaign(input as unknown as UnifiedCampaign)
      : { ...input };

    // platform_options (special_ad_categories, bid_strategy, …) are not part of the
    // unified campaign model, so toMetaCampaign drops them. Merge them back into the
    // payload so they reach the Meta API, then strip the wrapper key itself.
    const platformOptions =
      (input['platform_options'] as Record<string, unknown> | undefined) ?? {};
    const payload: Record<string, unknown> = {
      ...(base as Record<string, unknown>),
      ...platformOptions,
    };
    delete payload['platform_options'];

    // Meta requires special_ad_categories on every campaign create; default to none.
    if (payload['special_ad_categories'] === undefined) {
      payload['special_ad_categories'] = [];
    }

    const created = await this.fetch<{ id: string }>(
      `/act_${actId}/campaigns`,
      'POST',
      ctx.account,
      payload
    );
    return this.getCampaign(ctx, created.id);
  }

  async updateCampaign(
    ctx: AdapterContext,
    campaignId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedCampaign> {
    // Translate any unified-level keys if needed
    const payload: Record<string, unknown> = { ...updates };
    if (updates['status'] && typeof updates['status'] === 'string') {
      payload['status'] = toMetaStatus(updates['status'] as Parameters<typeof toMetaStatus>[0]);
    }
    if (updates['objective'] && typeof updates['objective'] === 'string') {
      payload['objective'] = toMetaObjective(updates['objective'] as Parameters<typeof toMetaObjective>[0]);
    }
    if (updates['budget'] !== undefined) {
      const budget = updates['budget'] as { type: string; amount: number; currency?: string };
      const budgetField = budget.type === 'daily' ? 'daily_budget' : 'lifetime_budget';
      const currency = budget.currency ?? this.accountCurrency(ctx);
      payload[budgetField] = String(toMinorUnits(budget.amount, currency));
      delete payload['budget'];
    }

    await this.fetch<{ success: boolean }>(
      `/${campaignId}`,
      'POST',
      ctx.account,
      payload
    );
    return this.getCampaign(ctx, campaignId);
  }

  async setCampaignStatus(
    ctx: AdapterContext,
    campaignId: string,
    status: string
  ): Promise<UnifiedCampaign> {
    return this.updateCampaign(ctx, campaignId, { status });
  }

  async deleteCampaign(ctx: AdapterContext, campaignId: string): Promise<void> {
    await this.fetch<{ success: boolean }>(
      `/${campaignId}`,
      'DELETE',
      ctx.account
    );
  }

  async cloneCampaign(
    ctx: AdapterContext,
    campaignId: string,
    name?: string
  ): Promise<UnifiedCampaign> {
    const existing = await this.getCampaign(ctx, campaignId);
    const payload = toMetaCampaign(existing);
    if (name) {
      payload['name'] = name;
    } else {
      payload['name'] = `${existing.name} (copy)`;
    }
    // Create in paused state
    payload['status'] = 'PAUSED';

    return this.createCampaign(ctx, payload);
  }

  // ─── Ad Sets ─────────────────────────────────────────────────────────────────

  async listAdSets(
    ctx: AdapterContext,
    campaignId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAdSet>> {
    const params: Record<string, string> = {
      fields: 'id,name,campaign_id,status,targeting,bid_amount,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,created_time,updated_time',
      limit: String(limit),
    };
    if (cursor) params['after'] = cursor;

    const resp = await this.fetch<MetaPagedResponse<MetaAdSet>>(
      `/${campaignId}/adsets`,
      'GET',
      ctx.account,
      undefined,
      params
    );

    const data = resp.data.map(mapMetaAdSet);
    const nextCursor = resp.paging?.cursors?.after;

    return {
      data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: !!resp.paging?.next,
        ...(nextCursor && { next_cursor: nextCursor }),
        ...(resp.paging?.cursors?.before && { prev_cursor: resp.paging.cursors.before }),
      },
    };
  }

  async getAdSet(ctx: AdapterContext, adsetId: string): Promise<UnifiedAdSet> {
    const meta = await this.fetch<MetaAdSet>(
      `/${adsetId}`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,campaign_id,status,targeting,bid_amount,bid_strategy,daily_budget,lifetime_budget,start_time,end_time,created_time,updated_time',
      }
    );
    return mapMetaAdSet(meta);
  }

  async createAdSet(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const actId = this.adAccountId(ctx);
    const created = await this.fetch<{ id: string }>(
      `/act_${actId}/adsets`,
      'POST',
      ctx.account,
      input
    );
    return this.getAdSet(ctx, created.id);
  }

  async updateAdSet(
    ctx: AdapterContext,
    adsetId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const payload: Record<string, unknown> = { ...updates };
    if (updates['status'] && typeof updates['status'] === 'string') {
      payload['status'] = toMetaStatus(updates['status'] as Parameters<typeof toMetaStatus>[0]);
    }

    await this.fetch<{ success: boolean }>(
      `/${adsetId}`,
      'POST',
      ctx.account,
      payload
    );
    return this.getAdSet(ctx, adsetId);
  }

  async setAdSetStatus(
    ctx: AdapterContext,
    adsetId: string,
    status: string
  ): Promise<UnifiedAdSet> {
    return this.updateAdSet(ctx, adsetId, { status });
  }

  async deleteAdSet(ctx: AdapterContext, adsetId: string): Promise<void> {
    await this.fetch<{ success: boolean }>(
      `/${adsetId}`,
      'DELETE',
      ctx.account
    );
  }

  // ─── Ads ──────────────────────────────────────────────────────────────────

  async listAds(
    ctx: AdapterContext,
    adsetId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAd>> {
    const params: Record<string, string> = {
      fields: 'id,name,adset_id,campaign_id,status,creative,created_time,updated_time',
      limit: String(limit),
    };
    if (cursor) params['after'] = cursor;

    const resp = await this.fetch<MetaPagedResponse<MetaAd>>(
      `/${adsetId}/ads`,
      'GET',
      ctx.account,
      undefined,
      params
    );

    const data = resp.data.map(mapMetaAd);
    const nextCursor = resp.paging?.cursors?.after;

    return {
      data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: !!resp.paging?.next,
        ...(nextCursor && { next_cursor: nextCursor }),
        ...(resp.paging?.cursors?.before && { prev_cursor: resp.paging.cursors.before }),
      },
    };
  }

  async getAd(ctx: AdapterContext, adId: string): Promise<UnifiedAd> {
    const meta = await this.fetch<MetaAd>(
      `/${adId}`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,adset_id,campaign_id,status,creative,created_time,updated_time',
      }
    );
    return mapMetaAd(meta);
  }

  async createAd(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAd> {
    const actId = this.adAccountId(ctx);
    const created = await this.fetch<{ id: string }>(
      `/act_${actId}/ads`,
      'POST',
      ctx.account,
      input
    );
    return this.getAd(ctx, created.id);
  }

  async updateAd(
    ctx: AdapterContext,
    adId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAd> {
    const payload: Record<string, unknown> = { ...updates };
    if (updates['status'] && typeof updates['status'] === 'string') {
      payload['status'] = toMetaStatus(updates['status'] as Parameters<typeof toMetaStatus>[0]);
    }

    await this.fetch<{ success: boolean }>(
      `/${adId}`,
      'POST',
      ctx.account,
      payload
    );
    return this.getAd(ctx, adId);
  }

  async deleteAd(ctx: AdapterContext, adId: string): Promise<void> {
    await this.fetch<{ success: boolean }>(
      `/${adId}`,
      'DELETE',
      ctx.account
    );
  }

  // ─── Creatives + Audience Files ──────────────────────────────────────────────

  async uploadCreative(
    ctx: AdapterContext,
    filePath: string,
    mediaType: string
  ): Promise<{ creative_id: string; url: string }> {
    const actId = this.adAccountId(ctx);

    if (mediaType.startsWith('video')) {
      const resp = await this.fetch<{ id: string; picture: string }>(
        `/act_${actId}/advideos`,
        'POST',
        ctx.account,
        { file_url: filePath, name: filePath.split('/').pop() ?? 'video' }
      );
      return { creative_id: resp.id, url: resp.picture ?? filePath };
    } else {
      // image
      const resp = await this.fetch<{ images: Record<string, { hash: string; url: string }> }>(
        `/act_${actId}/adimages`,
        'POST',
        ctx.account,
        { url: filePath }
      );
      const imageKey = Object.keys(resp.images)[0];
      const image = resp.images[imageKey];
      return { creative_id: image.hash, url: image.url };
    }
  }

  async uploadAudienceFile(
    ctx: AdapterContext,
    filePath: string
  ): Promise<{ uploaded_file_id: string }> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<{ id: string }>(
      `/act_${actId}/customaudiences`,
      'POST',
      ctx.account,
      {
        name: `Uploaded audience ${Date.now()}`,
        subtype: 'CUSTOM',
        description: `Uploaded from ${filePath}`,
        customer_file_source: 'USER_PROVIDED_ONLY',
      }
    );
    return { uploaded_file_id: resp.id };
  }

  // ─── Audiences ───────────────────────────────────────────────────────────────

  async listAudiences(
    ctx: AdapterContext,
    type: string | undefined,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const actId = this.adAccountId(ctx);
    const params: Record<string, string> = {
      fields: 'id,name,subtype,approximate_count,description,created_time,updated_time',
      limit: String(limit),
    };
    if (type) params['filtering'] = JSON.stringify([{ field: 'subtype', operator: 'EQUAL', value: type.toUpperCase() }]);
    if (cursor) params['after'] = cursor;

    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/act_${actId}/customaudiences`,
      'GET',
      ctx.account,
      undefined,
      params
    );

    const nextCursor = resp.paging?.cursors?.after;
    return {
      data: resp.data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: !!resp.paging?.next,
        ...(nextCursor && { next_cursor: nextCursor }),
        ...(resp.paging?.cursors?.before && { prev_cursor: resp.paging.cursors.before }),
      },
    };
  }

  async createAudience(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<Record<string, unknown>>(
      `/act_${actId}/customaudiences`,
      'POST',
      ctx.account,
      input
    );
    return resp;
  }

  async updateAudience(
    ctx: AdapterContext,
    audienceId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.fetch<{ success: boolean }>(
      `/${audienceId}`,
      'POST',
      ctx.account,
      updates
    );
    return { id: audienceId, ...updates };
  }

  async getAudienceSize(
    ctx: AdapterContext,
    targeting: Record<string, unknown>
  ): Promise<{ estimated_reach: number; range?: { min: number; max: number } }> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<{
      users: number;
      estimate_ready: boolean;
      estimate_dau?: number;
    }>(
      `/act_${actId}/reachestimate`,
      'GET',
      ctx.account,
      undefined,
      {
        targeting_spec: JSON.stringify(targeting),
        optimize_for: 'IMPRESSIONS',
      }
    );

    const reach = resp.users ?? 0;
    return {
      estimated_reach: reach,
      range: reach > 0 ? { min: Math.floor(reach * 0.8), max: Math.ceil(reach * 1.2) } : undefined,
    };
  }

  // ─── Reporting ───────────────────────────────────────────────────────────────

  async getPerformance(
    ctx: AdapterContext,
    _entityType: string,
    entityId: string,
    dateRange: DateRange,
    granularity: string,
    attributionWindow?: AttributionWindow
  ): Promise<Record<string, unknown>[]> {
    const timeIncrementMap: Record<string, string> = {
      hourly: '1',
      daily: '1',
      weekly: '7',
      monthly: 'monthly',
    };

    const params: Record<string, string> = {
      fields: 'impressions,clicks,spend,reach,frequency,ctr,cpc,cpm,conversions,actions,cost_per_action_type,date_start,date_stop',
      time_range: JSON.stringify({ since: dateRange.start_date, until: dateRange.end_date ?? dateRange.start_date }),
      time_increment: timeIncrementMap[granularity] ?? '1',
      level: 'campaign',
    };

    if (attributionWindow) {
      const clickAttr = `${attributionWindow.click_days}d_click`;
      const viewAttr = attributionWindow.view_days ? `${attributionWindow.view_days}d_view` : undefined;
      params['action_attribution_windows'] = JSON.stringify(
        viewAttr ? [clickAttr, viewAttr] : [clickAttr]
      );
    }

    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/${entityId}/insights`,
      'GET',
      ctx.account,
      undefined,
      params
    );

    return resp.data;
  }

  async getInsights(
    ctx: AdapterContext,
    entityId: string,
    breakdowns: string[],
    dateRange: DateRange
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = {
      fields: 'impressions,clicks,spend,reach,frequency,ctr,cpc,cpm',
      time_range: JSON.stringify({ since: dateRange.start_date, until: dateRange.end_date ?? dateRange.start_date }),
    };

    if (breakdowns.length > 0) {
      params['breakdowns'] = breakdowns.join(',');
    }

    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/${entityId}/insights`,
      'GET',
      ctx.account,
      undefined,
      params
    );

    return resp.data;
  }

  // ─── Budget ───────────────────────────────────────────────────────────────────

  async getBudget(
    ctx: AdapterContext,
    campaignId: string
  ): Promise<Record<string, unknown>> {
    const today = new Date().toISOString().slice(0, 10);

    const [campaign, spendData] = await Promise.all([
      this.getCampaign(ctx, campaignId),
      this.fetch<MetaPagedResponse<Record<string, unknown>>>(
        `/${campaignId}/insights`,
        'GET',
        ctx.account,
        undefined,
        {
          fields: 'spend',
          time_range: JSON.stringify({ since: today, until: today }),
        }
      ),
    ]);

    const todaySpend = parseFloat(
      (spendData.data[0]?.['spend'] as string | undefined) ?? '0'
    );

    return {
      campaign_id: campaignId,
      budget_type: campaign.budget.type,
      budget_amount: campaign.budget.amount,
      currency: campaign.budget.currency,
      today_spend: todaySpend,
      remaining: campaign.budget.amount - todaySpend,
    };
  }

  async getAllActiveCampaignBudgets(ctx: AdapterContext): Promise<number[]> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<MetaPagedResponse<MetaCampaign>>(
      `/act_${actId}/campaigns`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,daily_budget,lifetime_budget,status',
        effective_status: '["ACTIVE"]',
        limit: '200',
      }
    );

    const currency = this.accountCurrency(ctx);
    return resp.data.map((c) => {
      if (c.daily_budget && c.daily_budget !== '0') {
        return fromMinorUnits(parseInt(c.daily_budget, 10), currency);
      }
      if (c.lifetime_budget && c.lifetime_budget !== '0') {
        return fromMinorUnits(parseInt(c.lifetime_budget, 10), currency);
      }
      return 0;
    });
  }

  // ─── Rules ────────────────────────────────────────────────────────────────────

  async listRules(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/act_${actId}/adrules_library`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,status,evaluation_spec,execution_spec,schedule_spec,created_time,updated_time',
      }
    );
    return resp.data;
  }

  async createRule(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<Record<string, unknown>>(
      `/act_${actId}/adrules_library`,
      'POST',
      ctx.account,
      input
    );
    return resp;
  }

  async updateRule(
    ctx: AdapterContext,
    ruleId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    await this.fetch<{ success: boolean }>(
      `/${ruleId}`,
      'POST',
      ctx.account,
      updates
    );
    return { id: ruleId, ...updates };
  }

  async deleteRule(ctx: AdapterContext, ruleId: string): Promise<void> {
    await this.fetch<{ success: boolean }>(
      `/${ruleId}`,
      'DELETE',
      ctx.account
    );
  }

  async getRuleHistory(
    ctx: AdapterContext,
    ruleId: string,
    dateRange?: DateRange
  ): Promise<Record<string, unknown>[]> {
    const params: Record<string, string> = {
      fields: 'id,rule_id,is_manual,schedule_id,execution_type,applied_to,evaluation_results,created_time',
    };
    if (dateRange) {
      params['time_range'] = JSON.stringify({
        since: dateRange.start_date,
        until: dateRange.end_date ?? dateRange.start_date,
      });
    }

    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/${ruleId}/history`,
      'GET',
      ctx.account,
      undefined,
      params
    );
    return resp.data;
  }

  // ─── Tracking ─────────────────────────────────────────────────────────────────

  async listPixels(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/act_${actId}/adspixels`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,code,last_fired_time,is_consolidated_container,owner_business',
      }
    );
    return resp.data;
  }

  async getPixelStatus(
    ctx: AdapterContext,
    pixelId: string
  ): Promise<Record<string, unknown>> {
    const resp = await this.fetch<Record<string, unknown>>(
      `/${pixelId}`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,last_fired_time,is_consolidated_container,owner_business,code',
      }
    );
    return resp;
  }

  async listConversionEvents(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/act_${actId}/customconversions`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,event_source_type,rule,custom_event_type,creation_time,last_fired_time',
      }
    );
    return resp.data;
  }

  async getEventMatchQuality(
    ctx: AdapterContext,
    pixelId: string
  ): Promise<Record<string, unknown>> {
    const resp = await this.fetch<Record<string, unknown>>(
      `/${pixelId}/matched_data_quality`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'event_name,event_match_quality,matched_to_ad_account',
      }
    );
    return resp;
  }

  async validateTrackingUrls(
    ctx: AdapterContext,
    _entityType: string,
    entityId: string
  ): Promise<Record<string, unknown>[]> {
    const resp = await this.fetch<MetaPagedResponse<Record<string, unknown>>>(
      `/${entityId}`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,tracking_specs,url_tags',
      }
    );
    // Return a normalised list of tracking URL info
    const tracking = (resp as unknown as Record<string, unknown>)['tracking_specs'];
    if (Array.isArray(tracking)) {
      return tracking as Record<string, unknown>[];
    }
    return [resp as unknown as Record<string, unknown>];
  }

  // ─── Keywords (not supported on Meta — defense-in-depth: tool layer also blocks non-Google)

  async listKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Keyword tools are only available for Google Ads', false);
  }

  async addKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Keyword tools are only available for Google Ads', false);
  }

  async removeKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Keyword tools are only available for Google Ads', false);
  }

  async listNegativeKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Keyword tools are only available for Google Ads', false);
  }

  async addNegativeKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Keyword tools are only available for Google Ads', false);
  }

  async getSearchTerms(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Keyword tools are only available for Google Ads', false);
  }

  // ─── Policy (not yet supported on Meta — Google Ads only) ──────────────

  async getAdPolicy(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Policy tools are only available for Google Ads', false);
  }

  async getPolicyIssues(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Policy tools are only available for Google Ads', false);
  }

  async listAdAssets(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'meta', 'Asset inspection is only available for Google Ads', false);
  }

  // ─── Account ──────────────────────────────────────────────────────────

  async getAccountHealth(ctx: AdapterContext): Promise<Record<string, unknown>> {
    const actId = this.adAccountId(ctx);
    const resp = await this.fetch<Record<string, unknown>>(
      `/act_${actId}`,
      'GET',
      ctx.account,
      undefined,
      {
        fields: 'id,name,account_status,disable_reason,business,currency,timezone_name,spend_cap,amount_spent,balance,funding_source_details',
      }
    );
    return resp;
  }
}
