import type { BaseAdapter, AdapterContext } from '../base.js';
import type { PaginatedResponse } from '../../models/pagination.js';
import type { UnifiedCampaign } from '../../models/campaign.js';
import type { UnifiedAdSet } from '../../models/adset.js';
import type { UnifiedAd } from '../../models/ad.js';
import type { DateRange, AttributionWindow } from '../../models/platform.js';
import { AdsError } from '../../utils/errors.js';
import {
  fromTikTokCampaign,
  toTikTokCampaign,
  toTikTokObjective,
  toTikTokStatus,
  toTikTokBudgetMode,
  fromTikTokStatus,
  type TikTokCampaignData,
} from './mapper.js';
import {
  TikTokResponseSchema,
  TikTokCampaignSchema,
  TikTokAdGroupSchema,
  TikTokAdSchema,
  type TikTokCampaign,
  type TikTokAdGroup,
  type TikTokAd,
} from './schemas.js';
import { z } from 'zod';

const TIKTOK_API_BASE = 'https://business-api.tiktok.com/open_api/v1.3';

function tiktokApiUrl(path: string): string {
  return `${TIKTOK_API_BASE}${path}`;
}

// ─── Internal list response shapes ───────────────────────────────────────────

interface TikTokListData<T> {
  list: T[];
  page_info: {
    total_number: number;
    page: number;
    page_size: number;
    total_page?: number;
  };
}

// ─── AdGroup raw shape ───────────────────────────────────────────────────────

function mapTikTokAdGroup(adGroup: TikTokAdGroup): UnifiedAdSet {
  const bidStrategyMap: Record<string, UnifiedAdSet['bid']['strategy']> = {
    BID_TYPE_CUSTOM: 'bid_cap',
    BID_TYPE_NO_BID: 'lowest_cost',
    BID_TYPE_MAX_CONVERSION: 'maximize_conversions',
    BID_TYPE_TARGET_CPA: 'target_cpa',
  };
  const bidStrategy: UnifiedAdSet['bid']['strategy'] =
    bidStrategyMap[adGroup.bid_type ?? ''] ?? 'lowest_cost';

  return {
    id: String(adGroup.adgroup_id),
    platform: 'tiktok',
    campaign_id: String(adGroup.campaign_id),
    name: adGroup.adgroup_name,
    status: fromTikTokStatus(adGroup.status),
    targeting: {
      locations: [],
      interests: [],
      behaviors: [],
      audiences: [],
      languages: [],
      devices: [],
      os: [],
    },
    bid: {
      strategy: bidStrategy,
      ...(adGroup.bid_price !== undefined && { amount: adGroup.bid_price }),
    },
    ...(adGroup.budget !== undefined && adGroup.budget_mode === 'BUDGET_MODE_DAY'
      ? { daily_budget: adGroup.budget }
      : {}),
    ...(adGroup.budget !== undefined && adGroup.budget_mode === 'BUDGET_MODE_TOTAL'
      ? { lifetime_budget: adGroup.budget }
      : {}),
    created_at: adGroup.create_time,
    updated_at: adGroup.modify_time,
    platform_data: adGroup as unknown as Record<string, unknown>,
  };
}

// ─── Ad raw shape ─────────────────────────────────────────────────────────────

function mapTikTokAd(ad: TikTokAd): UnifiedAd {
  const rawAd = ad as unknown as Record<string, unknown>;
  const landingUrl =
    (rawAd['landing_page_url'] as string | undefined) ?? 'https://www.tiktok.com';
  const headline = (rawAd['ad_text'] as string | undefined) ?? ad.ad_name;
  const imageUrl =
    (rawAd['image_url'] as string | undefined) ?? 'https://example.com/placeholder.jpg';

  return {
    id: String(ad.ad_id),
    platform: 'tiktok',
    adset_id: String(ad.adgroup_id),
    campaign_id: (rawAd['campaign_id'] as string | undefined) ?? '',
    name: ad.ad_name,
    status: fromTikTokStatus(ad.status) as UnifiedAd['status'],
    creative: {
      type: 'image',
      headline: String(headline),
      image_url: imageUrl.startsWith('https://') ? (imageUrl as `https://${string}`) : 'https://example.com/placeholder.jpg',
      landing_url: landingUrl.startsWith('https://') ? (landingUrl as `https://${string}`) : 'https://www.tiktok.com',
    },
    created_at: ad.create_time,
    updated_at: ad.modify_time,
    platform_data: rawAd,
  };
}

// ─── TikTokAdapter ────────────────────────────────────────────────────────────

export class TikTokAdapter implements BaseAdapter {
  readonly platform = 'tiktok' as const;
  readonly allowedPlatformOptions = [
    'optimization_event',
    'bid_type',
    'pacing',
    'identity_id',
  ];

  constructor(private readonly getToken: (account: string) => Promise<string>) {}

  // ─── Private helpers ────────────────────────────────────────────────────────

  private advertiserId(ctx: AdapterContext): string {
    // Prefer an explicit `advertiser_id`, falling back to `account_id` so
    // TikTok accounts can be configured like every other platform.
    const id =
      (ctx.accountMeta['advertiser_id'] as string | undefined) ??
      (ctx.accountMeta['account_id'] as string | undefined);
    if (!id) {
      throw new AdsError(
        'ACCOUNT_ISSUE',
        'tiktok',
        'advertiser_id (or account_id) missing from accountMeta',
        false
      );
    }
    return id;
  }

  private handleError(code: number, message: string): never {
    if (code === 40100) throw new AdsError('AUTH_EXPIRED', 'tiktok', message, false, String(code));
    if (code === 40002 || code === 40003) throw new AdsError('RATE_LIMITED', 'tiktok', message, true, String(code));
    if (code === 40401) throw new AdsError('NOT_FOUND', 'tiktok', message, false, String(code));
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', message, false, String(code));
  }

  private async request<T>(
    ctx: AdapterContext,
    method: 'GET' | 'POST',
    path: string,
    params?: Record<string, unknown>,
    body?: Record<string, unknown>
  ): Promise<T> {
    const token = await this.getToken(ctx.account);
    const url = new URL(tiktokApiUrl(path));

    if (method === 'GET' && params) {
      for (const [k, v] of Object.entries(params)) {
        url.searchParams.set(
          k,
          typeof v === 'object' ? JSON.stringify(v) : String(v)
        );
      }
    }

    const res = await globalThis.fetch(url.toString(), {
      method,
      headers: {
        'Access-Token': token,
        'Content-Type': 'application/json',
      },
      body: method === 'POST' ? JSON.stringify(body ?? params) : undefined,
    });

    const json = await res.json();
    const parsed = TikTokResponseSchema.parse(json);

    if (parsed.code !== 0) {
      this.handleError(parsed.code, parsed.message);
    }

    return parsed.data as T;
  }

  // ─── Campaigns ──────────────────────────────────────────────────────────────

  async listCampaigns(
    ctx: AdapterContext,
    filters: { status?: string; dateRange?: DateRange },
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedCampaign>> {
    const advertiserId = this.advertiserId(ctx);
    const page = cursor ? parseInt(cursor, 10) : 1;

    const params: Record<string, unknown> = {
      advertiser_id: advertiserId,
      page,
      page_size: limit,
    };

    if (filters.status) {
      params['filtering'] = { status: toTikTokStatus(filters.status as Parameters<typeof toTikTokStatus>[0]) };
    }

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/campaign/get/',
      params
    );

    const rawList = (data?.list ?? []) as unknown[];
    const campaigns = rawList.map((item) =>
      fromTikTokCampaign(TikTokCampaignSchema.parse(item) as TikTokCampaignData)
    );

    const pageInfo = data?.page_info;
    const currentPage = pageInfo?.page ?? page;
    const totalPage = pageInfo?.total_page ?? 1;

    return {
      data: campaigns,
      pagination: {
        total: pageInfo?.total_number,
        page: currentPage,
        page_size: limit,
        has_next_page: currentPage < totalPage,
        ...(currentPage < totalPage ? { next_cursor: String(currentPage + 1) } : {}),
        ...(currentPage > 1 ? { prev_cursor: String(currentPage - 1) } : {}),
      },
    };
  }

  async getCampaign(ctx: AdapterContext, campaignId: string): Promise<UnifiedCampaign> {
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/campaign/get/',
      {
        advertiser_id: advertiserId,
        filtering: { campaign_ids: [campaignId] },
        page_size: 1,
      }
    );

    const rawList = data?.list ?? [];
    if (!rawList.length) {
      throw new AdsError('NOT_FOUND', 'tiktok', `Campaign ${campaignId} not found`, false);
    }

    return fromTikTokCampaign(TikTokCampaignSchema.parse(rawList[0]) as TikTokCampaignData);
  }

  async createCampaign(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedCampaign> {
    const advertiserId = this.advertiserId(ctx);

    // Build TikTok payload from input (can be a UnifiedCampaign-like or raw payload)
    let payload: Record<string, unknown>;
    if (typeof input['name'] === 'string' && typeof input['objective'] === 'string') {
      const unified = input as unknown as UnifiedCampaign;
      const tiktokPayload = toTikTokCampaign(unified);
      payload = {
        advertiser_id: advertiserId,
        campaign_name: tiktokPayload['campaign_name'],
        objective_type: tiktokPayload['objective_type'],
        budget: tiktokPayload['budget'],
        budget_mode: tiktokPayload['budget_mode'],
      };
    } else {
      payload = { advertiser_id: advertiserId, ...input };
    }

    const result = await this.request<{ campaign_id: string }>(
      ctx,
      'POST',
      '/campaign/create/',
      undefined,
      payload
    );

    return this.getCampaign(ctx, String(result.campaign_id));
  }

  async updateCampaign(
    ctx: AdapterContext,
    campaignId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedCampaign> {
    const advertiserId = this.advertiserId(ctx);
    const payload: Record<string, unknown> = {
      advertiser_id: advertiserId,
      campaign_id: campaignId,
    };

    if (updates['name'] !== undefined) {
      payload['campaign_name'] = updates['name'];
    }
    if (updates['status'] && typeof updates['status'] === 'string') {
      payload['status'] = toTikTokStatus(updates['status'] as Parameters<typeof toTikTokStatus>[0]);
    }
    if (updates['objective'] && typeof updates['objective'] === 'string') {
      payload['objective_type'] = toTikTokObjective(updates['objective'] as Parameters<typeof toTikTokObjective>[0]);
    }
    if (updates['budget'] !== undefined) {
      const budget = updates['budget'] as { type: string; amount: number };
      payload['budget'] = budget.amount;
      payload['budget_mode'] = toTikTokBudgetMode(budget.type as 'daily' | 'lifetime');
    }

    // Merge any remaining raw fields
    for (const [k, v] of Object.entries(updates)) {
      if (!['name', 'status', 'objective', 'budget'].includes(k)) {
        payload[k] = v;
      }
    }

    await this.request<unknown>(ctx, 'POST', '/campaign/update/', undefined, payload);
    return this.getCampaign(ctx, campaignId);
  }

  async setCampaignStatus(
    ctx: AdapterContext,
    campaignId: string,
    status: string
  ): Promise<UnifiedCampaign> {
    const advertiserId = this.advertiserId(ctx);
    const optStatus = toTikTokStatus(status as Parameters<typeof toTikTokStatus>[0]);

    await this.request<unknown>(ctx, 'POST', '/campaign/status/update/', undefined, {
      advertiser_id: advertiserId,
      campaign_ids: [campaignId],
      opt_status: optStatus,
    });

    return this.getCampaign(ctx, campaignId);
  }

  async deleteCampaign(ctx: AdapterContext, campaignId: string): Promise<void> {
    await this.setCampaignStatus(ctx, campaignId, 'archived');
  }

  async cloneCampaign(
    ctx: AdapterContext,
    campaignId: string,
    name?: string
  ): Promise<UnifiedCampaign> {
    const existing = await this.getCampaign(ctx, campaignId);
    const tiktokPayload = toTikTokCampaign(existing);
    if (name) {
      tiktokPayload['campaign_name'] = name;
    } else {
      tiktokPayload['campaign_name'] = `${existing.name} (copy)`;
    }

    return this.createCampaign(ctx, {
      name: tiktokPayload['campaign_name'] as string,
      objective: existing.objective,
      budget: { type: existing.budget.type, amount: existing.budget.amount },
      status: 'paused',
    } as unknown as Record<string, unknown>);
  }

  // ─── Ad Sets ─────────────────────────────────────────────────────────────────

  async listAdSets(
    ctx: AdapterContext,
    campaignId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAdSet>> {
    const advertiserId = this.advertiserId(ctx);
    const page = cursor ? parseInt(cursor, 10) : 1;

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/adgroup/get/',
      {
        advertiser_id: advertiserId,
        filtering: { campaign_ids: [campaignId] },
        page,
        page_size: limit,
      }
    );

    const rawList = (data?.list ?? []) as unknown[];
    const adSets = rawList.map((item) => mapTikTokAdGroup(TikTokAdGroupSchema.parse(item)));

    const pageInfo = data?.page_info;
    const currentPage = pageInfo?.page ?? page;
    const totalPage = pageInfo?.total_page ?? 1;

    return {
      data: adSets,
      pagination: {
        total: pageInfo?.total_number,
        page: currentPage,
        page_size: limit,
        has_next_page: currentPage < totalPage,
        ...(currentPage < totalPage ? { next_cursor: String(currentPage + 1) } : {}),
        ...(currentPage > 1 ? { prev_cursor: String(currentPage - 1) } : {}),
      },
    };
  }

  async getAdSet(ctx: AdapterContext, adsetId: string): Promise<UnifiedAdSet> {
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/adgroup/get/',
      {
        advertiser_id: advertiserId,
        filtering: { adgroup_ids: [adsetId] },
        page_size: 1,
      }
    );

    const rawList = data?.list ?? [];
    if (!rawList.length) {
      throw new AdsError('NOT_FOUND', 'tiktok', `Ad group ${adsetId} not found`, false);
    }

    return mapTikTokAdGroup(TikTokAdGroupSchema.parse(rawList[0]));
  }

  async createAdSet(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const advertiserId = this.advertiserId(ctx);
    const payload = { advertiser_id: advertiserId, ...input };

    const result = await this.request<{ adgroup_id: string }>(
      ctx,
      'POST',
      '/adgroup/create/',
      undefined,
      payload
    );

    return this.getAdSet(ctx, String(result.adgroup_id));
  }

  async updateAdSet(
    ctx: AdapterContext,
    adsetId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const advertiserId = this.advertiserId(ctx);
    const payload: Record<string, unknown> = {
      advertiser_id: advertiserId,
      adgroup_id: adsetId,
      ...updates,
    };

    if (updates['status'] && typeof updates['status'] === 'string') {
      payload['status'] = toTikTokStatus(updates['status'] as Parameters<typeof toTikTokStatus>[0]);
    }

    await this.request<unknown>(ctx, 'POST', '/adgroup/update/', undefined, payload);
    return this.getAdSet(ctx, adsetId);
  }

  async setAdSetStatus(
    ctx: AdapterContext,
    adsetId: string,
    status: string
  ): Promise<UnifiedAdSet> {
    const advertiserId = this.advertiserId(ctx);
    const optStatus = toTikTokStatus(status as Parameters<typeof toTikTokStatus>[0]);

    await this.request<unknown>(ctx, 'POST', '/adgroup/status/update/', undefined, {
      advertiser_id: advertiserId,
      adgroup_ids: [adsetId],
      opt_status: optStatus,
    });

    return this.getAdSet(ctx, adsetId);
  }

  async deleteAdSet(ctx: AdapterContext, adsetId: string): Promise<void> {
    await this.setAdSetStatus(ctx, adsetId, 'archived');
  }

  // ─── Ads ──────────────────────────────────────────────────────────────────────

  async listAds(
    ctx: AdapterContext,
    adsetId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAd>> {
    const advertiserId = this.advertiserId(ctx);
    const page = cursor ? parseInt(cursor, 10) : 1;

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/ad/get/',
      {
        advertiser_id: advertiserId,
        filtering: { adgroup_ids: [adsetId] },
        page,
        page_size: limit,
      }
    );

    const rawList = (data?.list ?? []) as unknown[];
    const ads = rawList.map((item) => mapTikTokAd(TikTokAdSchema.parse(item)));

    const pageInfo = data?.page_info;
    const currentPage = pageInfo?.page ?? page;
    const totalPage = pageInfo?.total_page ?? 1;

    return {
      data: ads,
      pagination: {
        total: pageInfo?.total_number,
        page: currentPage,
        page_size: limit,
        has_next_page: currentPage < totalPage,
        ...(currentPage < totalPage ? { next_cursor: String(currentPage + 1) } : {}),
        ...(currentPage > 1 ? { prev_cursor: String(currentPage - 1) } : {}),
      },
    };
  }

  async getAd(ctx: AdapterContext, adId: string): Promise<UnifiedAd> {
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/ad/get/',
      {
        advertiser_id: advertiserId,
        filtering: { ad_ids: [adId] },
        page_size: 1,
      }
    );

    const rawList = data?.list ?? [];
    if (!rawList.length) {
      throw new AdsError('NOT_FOUND', 'tiktok', `Ad ${adId} not found`, false);
    }

    return mapTikTokAd(TikTokAdSchema.parse(rawList[0]));
  }

  async createAd(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAd> {
    const advertiserId = this.advertiserId(ctx);
    const payload = { advertiser_id: advertiserId, ...input };

    const result = await this.request<{ ad_id: string }>(
      ctx,
      'POST',
      '/ad/create/',
      undefined,
      payload
    );

    return this.getAd(ctx, String(result.ad_id));
  }

  async updateAd(
    ctx: AdapterContext,
    adId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAd> {
    const advertiserId = this.advertiserId(ctx);
    const payload: Record<string, unknown> = {
      advertiser_id: advertiserId,
      ad_id: adId,
      ...updates,
    };

    if (updates['status'] && typeof updates['status'] === 'string') {
      payload['status'] = toTikTokStatus(updates['status'] as Parameters<typeof toTikTokStatus>[0]);
    }

    await this.request<unknown>(ctx, 'POST', '/ad/update/', undefined, payload);
    return this.getAd(ctx, adId);
  }

  async deleteAd(ctx: AdapterContext, adId: string): Promise<void> {
    const advertiserId = this.advertiserId(ctx);
    await this.request<unknown>(ctx, 'POST', '/ad/status/update/', undefined, {
      advertiser_id: advertiserId,
      ad_ids: [adId],
      opt_status: 'DELETE',
    });
  }

  // ─── Creatives + Audience Files ──────────────────────────────────────────────

  async uploadCreative(
    ctx: AdapterContext,
    filePath: string,
    mediaType: string
  ): Promise<{ creative_id: string; url: string }> {
    const advertiserId = this.advertiserId(ctx);

    if (mediaType.startsWith('video')) {
      const result = await this.request<{ video_id: string; url: string }>(
        ctx,
        'POST',
        '/file/video/ad/upload/',
        undefined,
        {
          advertiser_id: advertiserId,
          video_url: filePath,
          file_name: filePath.split('/').pop() ?? 'video',
        }
      );
      return { creative_id: result.video_id, url: result.url ?? filePath };
    } else {
      const result = await this.request<{ image_id: string; url: string }>(
        ctx,
        'POST',
        '/file/image/ad/upload/',
        undefined,
        {
          advertiser_id: advertiserId,
          upload_type: 'UPLOAD_BY_URL',
          image_url: filePath,
        }
      );
      return { creative_id: result.image_id, url: result.url ?? filePath };
    }
  }

  async uploadAudienceFile(
    ctx: AdapterContext,
    filePath: string
  ): Promise<{ uploaded_file_id: string }> {
    const advertiserId = this.advertiserId(ctx);

    const result = await this.request<{ audience_id: string }>(
      ctx,
      'POST',
      '/custom_audience/create/',
      undefined,
      {
        advertiser_id: advertiserId,
        name: `Uploaded audience ${Date.now()}`,
        file_paths: [filePath],
        calculate_type: 'UPLOAD',
        retain_days: 365,
      }
    );
    return { uploaded_file_id: String(result.audience_id) };
  }

  // ─── Audiences ───────────────────────────────────────────────────────────────

  async listAudiences(
    ctx: AdapterContext,
    type: string | undefined,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    const advertiserId = this.advertiserId(ctx);
    const page = cursor ? parseInt(cursor, 10) : 1;

    const params: Record<string, unknown> = {
      advertiser_id: advertiserId,
      page,
      page_size: limit,
    };

    if (type) {
      params['filtering'] = { audience_type: type.toUpperCase() };
    }

    const data = await this.request<TikTokListData<Record<string, unknown>>>(
      ctx,
      'GET',
      '/custom_audience/get/',
      params
    );

    const rawList = data?.list ?? [];
    const pageInfo = data?.page_info;
    const currentPage = pageInfo?.page ?? page;
    const totalPage = pageInfo?.total_page ?? 1;

    return {
      data: rawList,
      pagination: {
        total: pageInfo?.total_number,
        page: currentPage,
        page_size: limit,
        has_next_page: currentPage < totalPage,
        ...(currentPage < totalPage ? { next_cursor: String(currentPage + 1) } : {}),
        ...(currentPage > 1 ? { prev_cursor: String(currentPage - 1) } : {}),
      },
    };
  }

  async createAudience(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const advertiserId = this.advertiserId(ctx);
    const payload = { advertiser_id: advertiserId, ...input };
    const result = await this.request<Record<string, unknown>>(
      ctx,
      'POST',
      '/custom_audience/create/',
      undefined,
      payload
    );
    return result;
  }

  async updateAudience(
    ctx: AdapterContext,
    audienceId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const advertiserId = this.advertiserId(ctx);
    const payload = {
      advertiser_id: advertiserId,
      custom_audience_id: audienceId,
      ...updates,
    };
    await this.request<unknown>(ctx, 'POST', '/custom_audience/update/', undefined, payload);
    return { audience_id: audienceId, ...updates };
  }

  async getAudienceSize(
    ctx: AdapterContext,
    targeting: Record<string, unknown>
  ): Promise<{ estimated_reach: number; range?: { min: number; max: number } }> {
    const advertiserId = this.advertiserId(ctx);

    const result = await this.request<{ audience_size: number }>(
      ctx,
      'POST',
      '/audiencesize/estimate/',
      undefined,
      {
        advertiser_id: advertiserId,
        targeting,
      }
    );

    const reach = result?.audience_size ?? 0;
    return {
      estimated_reach: reach,
      range: reach > 0 ? { min: Math.floor(reach * 0.8), max: Math.ceil(reach * 1.2) } : undefined,
    };
  }

  // ─── Reporting ───────────────────────────────────────────────────────────────

  async getPerformance(
    ctx: AdapterContext,
    entityType: string,
    entityId: string,
    dateRange: DateRange,
    granularity: string,
    _attributionWindow?: AttributionWindow
  ): Promise<Record<string, unknown>[]> {
    const advertiserId = this.advertiserId(ctx);

    const dataLevelMap: Record<string, string> = {
      campaign: 'AUCTION_CAMPAIGN',
      adset: 'AUCTION_ADGROUP',
      adgroup: 'AUCTION_ADGROUP',
      ad: 'AUCTION_AD',
    };
    const dataLevel = dataLevelMap[entityType.toLowerCase()] ?? 'AUCTION_CAMPAIGN';

    const dimensionMap: Record<string, string[]> = {
      hourly: ['stat_time_hour'],
      daily: ['stat_time_day'],
      weekly: ['stat_time_day'],
      monthly: ['stat_time_day'],
    };
    const dimensions = dimensionMap[granularity] ?? ['stat_time_day'];

    const metrics = [
      'impressions',
      'clicks',
      'spend',
      'ctr',
      'cpc',
      'cpm',
      'conversions',
      'cost_per_conversion',
      'conversion_rate',
    ];

    const params: Record<string, unknown> = {
      advertiser_id: advertiserId,
      report_type: 'AUCTION',
      data_level: dataLevel,
      dimensions,
      metrics,
      start_date: dateRange.start_date,
      end_date: dateRange.end_date ?? dateRange.start_date,
      filtering: [{ field_name: `${dataLevel.toLowerCase().replace('auction_', '')}_id`, filter_type: 'IN', filter_value: `["${entityId}"]` }],
    };

    const data = await this.request<TikTokListData<Record<string, unknown>>>(
      ctx,
      'GET',
      '/report/integrated/get/',
      params
    );

    const rawList = data?.list ?? [];
    // Parse string metrics to numbers
    return rawList.map((item) => {
      const row: Record<string, unknown> = { ...item };
      const metricsData = (item['metrics'] as Record<string, string> | undefined) ?? {};
      const numericMetrics: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(metricsData)) {
        const parsed = parseFloat(v);
        numericMetrics[k] = isNaN(parsed) ? v : parsed;
      }
      row['metrics'] = numericMetrics;
      return row;
    });
  }

  async getInsights(
    ctx: AdapterContext,
    entityId: string,
    breakdowns: string[],
    dateRange: DateRange
  ): Promise<Record<string, unknown>[]> {
    const advertiserId = this.advertiserId(ctx);

    const breakdownDimensionMap: Record<string, string> = {
      age: 'age',
      gender: 'gender',
      country: 'country_code',
      device: 'platform',
      placement: 'placement_type',
    };

    const dimensions = breakdowns
      .map((b) => breakdownDimensionMap[b] ?? b)
      .filter(Boolean);

    // Always include time dimension
    if (!dimensions.includes('stat_time_day')) {
      dimensions.push('stat_time_day');
    }

    const params: Record<string, unknown> = {
      advertiser_id: advertiserId,
      report_type: 'AUDIENCE',
      data_level: 'AUCTION_CAMPAIGN',
      dimensions,
      metrics: ['impressions', 'clicks', 'spend', 'ctr', 'cpc', 'cpm'],
      start_date: dateRange.start_date,
      end_date: dateRange.end_date ?? dateRange.start_date,
      filtering: [{ field_name: 'campaign_id', filter_type: 'IN', filter_value: `["${entityId}"]` }],
    };

    const data = await this.request<TikTokListData<Record<string, unknown>>>(
      ctx,
      'GET',
      '/report/integrated/get/',
      params
    );

    return data?.list ?? [];
  }

  // ─── Budget ───────────────────────────────────────────────────────────────────

  async getBudget(
    ctx: AdapterContext,
    campaignId: string
  ): Promise<Record<string, unknown>> {
    const campaign = await this.getCampaign(ctx, campaignId);

    // Fetch today's spend via reporting
    const today = new Date().toISOString().slice(0, 10);
    let todaySpend = 0;

    try {
      const rows = await this.getPerformance(
        ctx,
        'campaign',
        campaignId,
        { start_date: today, end_date: today },
        'daily'
      );
      const firstRow = rows[0];
      if (firstRow) {
        const metrics = firstRow['metrics'] as Record<string, unknown> | undefined;
        const spendVal = metrics?.['spend'] ?? firstRow['spend'];
        if (typeof spendVal === 'number') {
          todaySpend = spendVal;
        } else if (typeof spendVal === 'string') {
          todaySpend = parseFloat(spendVal) || 0;
        }
      }
    } catch {
      // spend data unavailable — proceed with 0
    }

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
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<unknown>>(
      ctx,
      'GET',
      '/campaign/get/',
      {
        advertiser_id: advertiserId,
        filtering: { status: 'CAMPAIGN_STATUS_ENABLE' },
        page_size: 200,
      }
    );

    const rawList = (data?.list ?? []) as unknown[];
    return rawList.map((item) => {
      const parsed = TikTokCampaignSchema.parse(item);
      return parsed.budget ?? 0;
    });
  }

  // ─── Rules (not supported) ────────────────────────────────────────────────────

  async listRules(_ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    return [];
  }

  async createRule(
    _ctx: AdapterContext,
    _input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'tiktok',
      'TikTok automated rules are not supported via API',
      false
    );
  }

  async updateRule(
    _ctx: AdapterContext,
    _ruleId: string,
    _updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'tiktok',
      'TikTok automated rules are not supported via API',
      false
    );
  }

  async deleteRule(_ctx: AdapterContext, _ruleId: string): Promise<void> {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'tiktok',
      'TikTok automated rules are not supported via API',
      false
    );
  }

  async getRuleHistory(
    _ctx: AdapterContext,
    _ruleId: string,
    _dateRange?: DateRange
  ): Promise<Record<string, unknown>[]> {
    return [];
  }

  // ─── Tracking ─────────────────────────────────────────────────────────────────

  async listPixels(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<Record<string, unknown>>>(
      ctx,
      'GET',
      '/pixel/get/',
      { advertiser_id: advertiserId }
    );

    return data?.list ?? [];
  }

  async getPixelStatus(
    ctx: AdapterContext,
    pixelId: string
  ): Promise<Record<string, unknown>> {
    const pixels = await this.listPixels(ctx);
    const pixel = pixels.find((p) => String(p['pixel_id']) === pixelId || String(p['id']) === pixelId);

    if (!pixel) {
      throw new AdsError('NOT_FOUND', 'tiktok', `Pixel ${pixelId} not found`, false);
    }
    return pixel;
  }

  async listConversionEvents(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<Record<string, unknown>>>(
      ctx,
      'GET',
      '/offline_event/track_event_sets/',
      { advertiser_id: advertiserId }
    );

    return data?.list ?? [];
  }

  async getEventMatchQuality(
    ctx: AdapterContext,
    pixelId: string
  ): Promise<Record<string, unknown>> {
    const advertiserId = this.advertiserId(ctx);

    const result = await this.request<Record<string, unknown>>(
      ctx,
      'GET',
      '/pixel/get/',
      { advertiser_id: advertiserId, pixel_id: pixelId }
    );

    return result ?? { pixel_id: pixelId, match_quality: 'unknown' };
  }

  async validateTrackingUrls(
    ctx: AdapterContext,
    entityType: string,
    entityId: string
  ): Promise<Record<string, unknown>[]> {
    // TikTok does not have a dedicated URL validation API
    // Return the ad's tracking URLs by fetching the entity
    try {
      let trackingUrl: string | undefined;

      if (entityType === 'ad') {
        const advertiserId = this.advertiserId(ctx);
        const data = await this.request<TikTokListData<unknown>>(
          ctx,
          'GET',
          '/ad/get/',
          {
            advertiser_id: advertiserId,
            filtering: { ad_ids: [entityId] },
            page_size: 1,
          }
        );
        const rawList = data?.list ?? [];
        if (rawList.length) {
          const adData = rawList[0] as Record<string, unknown>;
          trackingUrl = adData['tracking_url'] as string | undefined;
        }
      }

      return [
        {
          entity_type: entityType,
          entity_id: entityId,
          tracking_url: trackingUrl ?? null,
          validated: false,
          note: 'TikTok does not provide URL validation API; manual verification required',
        },
      ];
    } catch {
      return [
        {
          entity_type: entityType,
          entity_id: entityId,
          tracking_url: null,
          validated: false,
          note: 'Could not retrieve tracking URL',
        },
      ];
    }
  }

  // ─── Keywords (not supported on TikTok — defense-in-depth: tool layer also blocks non-Google)

  async listKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Keyword tools are only available for Google Ads', false);
  }

  async addKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Keyword tools are only available for Google Ads', false);
  }

  async removeKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Keyword tools are only available for Google Ads', false);
  }

  async listNegativeKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Keyword tools are only available for Google Ads', false);
  }

  async addNegativeKeywords(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Keyword tools are only available for Google Ads', false);
  }

  async getSearchTerms(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Keyword tools are only available for Google Ads', false);
  }

  // ─── Policy (not yet supported on TikTok — Google Ads only) ────────────────────

  async getAdPolicy(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Policy tools are only available for Google Ads', false);
  }

  async getPolicyIssues(): Promise<never> {
    throw new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Policy tools are only available for Google Ads', false);
  }

  // ─── Account ──────────────────────────────────────────────────────────────────

  async getAccountHealth(ctx: AdapterContext): Promise<Record<string, unknown>> {
    const advertiserId = this.advertiserId(ctx);

    const data = await this.request<TikTokListData<Record<string, unknown>>>(
      ctx,
      'GET',
      '/advertiser/info/',
      {
        advertiser_ids: [advertiserId],
      }
    );

    const rawList = data?.list ?? [];
    const info = (rawList[0] as Record<string, unknown> | undefined) ?? {};

    return {
      advertiser_id: advertiserId,
      name: info['name'],
      status: info['status'],
      balance: info['balance'],
      currency: info['currency'],
      timezone: info['timezone'],
      role: info['role'],
      ...info,
    };
  }
}
