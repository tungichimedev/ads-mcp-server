import type { BaseAdapter, AdapterContext } from '../base.js';
import type { PaginatedResponse } from '../../models/pagination.js';
import type { UnifiedCampaign } from '../../models/campaign.js';
import type { UnifiedAdSet } from '../../models/adset.js';
import type { UnifiedAd } from '../../models/ad.js';
import type { DateRange, AttributionWindow, Status } from '../../models/platform.js';
import { AdsError } from '../../utils/errors.js';
import {
  toGoogleCampaignType,
  fromGoogleCampaign,
  toGoogleStatus,
  fromGoogleStatus,
  baseToMicros,
  microsToBase,
  type GoogleCampaign,
} from './mapper.js';

// ─── Raw Google API shapes ─────────────────────────────────────────────────

interface GoogleAdGroup {
  ad_group: {
    resource_name: string;
    id: string;
    name: string;
    status: string;
    campaign: string; // resource name
    type: string;
    cpc_bid_micros?: string;
    target_cpa_micros?: string;
  };
}

interface GoogleAd {
  ad_group_ad: {
    resource_name: string;
    status: string;
    ad: {
      id: string;
      name?: string;
      type: string;
      final_urls?: string[];
      responsive_search_ad?: {
        headlines: Array<{ text: string }>;
        descriptions: Array<{ text: string }>;
      };
      expanded_text_ad?: {
        headline_part1: string;
        headline_part2: string;
        description: string;
      };
    };
  };
  campaign: { id: string };
  ad_group: { id: string };
}

interface GoogleKeyword {
  ad_group_criterion: {
    resource_name: string;
    criterion_id: string;
    status: string;
    keyword: {
      text: string;
      match_type: string;
    };
  };
  ad_group: { id: string };
}

interface GoogleSearchTerm {
  search_term_view: {
    search_term: string;
    status: string;
  };
  metrics: {
    impressions: string;
    clicks: string;
    cost_micros: string;
    conversions: string;
    ctr: number;
    average_cpc: string;
  };
  segments: { date: string };
  ad_group: { id: string };
  campaign: { id: string };
}

// ─── Mapping helpers ───────────────────────────────────────────────────────

function mapGoogleAdGroup(row: GoogleAdGroup, campaignId: string): UnifiedAdSet {
  const now = new Date().toISOString();
  const bidStrategy =
    row.ad_group.target_cpa_micros ? 'target_cpa' : 'lowest_cost';
  const bidAmount = row.ad_group.target_cpa_micros
    ? microsToBase(parseInt(row.ad_group.target_cpa_micros, 10))
    : row.ad_group.cpc_bid_micros
    ? microsToBase(parseInt(row.ad_group.cpc_bid_micros, 10))
    : undefined;

  return {
    id: String(row.ad_group.id),
    platform: 'google',
    campaign_id: campaignId,
    name: row.ad_group.name,
    status: fromGoogleStatus(row.ad_group.status),
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
      ...(bidAmount !== undefined && { amount: bidAmount }),
    },
    created_at: now,
    updated_at: now,
    platform_data: row as unknown as Record<string, unknown>,
  };
}

function mapGoogleAd(row: GoogleAd): UnifiedAd {
  const now = new Date().toISOString();
  const ad = row.ad_group_ad.ad;

  let headline = ad.name ?? `Ad ${ad.id}`;
  let landingUrl: `https://${string}` = 'https://example.com';

  if (ad.responsive_search_ad?.headlines?.length) {
    headline = ad.responsive_search_ad.headlines[0].text;
  } else if (ad.expanded_text_ad) {
    headline = ad.expanded_text_ad.headline_part1;
  }

  if (ad.final_urls?.length) {
    const url = ad.final_urls[0];
    landingUrl = (url.startsWith('https://') ? url : `https://${url}`) as `https://${string}`;
  }

  return {
    id: String(ad.id),
    platform: 'google',
    adset_id: String(row.ad_group.id),
    campaign_id: String(row.campaign.id),
    name: ad.name ?? `Ad ${ad.id}`,
    status: fromGoogleStatus(row.ad_group_ad.status) as UnifiedAd['status'],
    creative: {
      type: 'responsive_search',
      headlines: ad.responsive_search_ad?.headlines?.map((h) => h.text) ?? [headline],
      descriptions: ad.responsive_search_ad?.descriptions?.map((d) => d.text) ?? [''],
      final_url: landingUrl,
    },
    created_at: now,
    updated_at: now,
    platform_data: row as unknown as Record<string, unknown>,
  };
}

// ─── Date conversion ───────────────────────────────────────────────────────

/** ISO date YYYY-MM-DD → YYYYMMDD for GAQL WHERE clauses */
function toGaqlDate(iso: string): string {
  return iso.replace(/-/g, '');
}

// ─── GoogleAdapter ─────────────────────────────────────────────────────────

export class GoogleAdapter implements BaseAdapter {
  readonly platform = 'google' as const;
  readonly allowedPlatformOptions = [
    'campaign_type',
    'bidding_strategy_type',
    'network_settings',
    'geo_target_type',
  ];

  constructor(private readonly getClient: (account: string) => Promise<any>) {}

  // ─── Private helpers ─────────────────────────────────────────────────────

  private customerId(ctx: AdapterContext): string {
    const id =
      (ctx.accountMeta['customer_id'] as string | undefined) ??
      (ctx.accountMeta['customerId'] as string | undefined) ??
      ctx.account;
    return id.replace(/-/g, '');
  }

  private async query(ctx: AdapterContext, gaql: string): Promise<any[]> {
    try {
      const customer = await this.getClient(ctx.account);
      const rows = await customer.query(gaql);
      return Array.isArray(rows) ? rows : [];
    } catch (err) {
      throw this.handleError(err);
    }
  }

  private async mutate(
    ctx: AdapterContext,
    resource: string,
    operation: 'create' | 'update' | 'remove',
    data: Record<string, unknown>
  ): Promise<any> {
    try {
      const customer = await this.getClient(ctx.account);
      const svc = customer[resource];
      if (!svc) {
        throw new AdsError(
          'ACCOUNT_ISSUE',
          'google',
          `Unknown resource: ${resource}`,
          false
        );
      }
      if (operation === 'remove') {
        return await svc.remove(data);
      }
      return await svc[operation](data);
    } catch (err) {
      if (err instanceof AdsError) throw err;
      throw this.handleError(err);
    }
  }

  private handleError(err: unknown): never {
    const message = err instanceof Error ? err.message : String(err);
    const upper = message.toUpperCase();

    if (upper.includes('RATE_EXCEEDED') || upper.includes('RESOURCE_EXHAUSTED')) {
      throw new AdsError('RATE_LIMITED', 'google', message, true);
    }
    if (upper.includes('AUTHENTICATION_ERROR') || upper.includes('AUTHORIZATION_ERROR')) {
      throw new AdsError('AUTH_EXPIRED', 'google', message, false);
    }
    if (upper.includes('NOT_FOUND')) {
      throw new AdsError('NOT_FOUND', 'google', message, false);
    }
    throw new AdsError('ACCOUNT_ISSUE', 'google', message, false);
  }

  // ─── Campaigns ────────────────────────────────────────────────────────────

  async listCampaigns(
    ctx: AdapterContext,
    filters: { status?: string; dateRange?: DateRange },
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedCampaign>> {
    let gaql = `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign.start_date, campaign.end_date,
             campaign_budget.amount_micros, campaign_budget.period
      FROM campaign
      WHERE campaign.status != 'REMOVED'
    `;

    if (filters.status) {
      const googleStatus = toGoogleStatus(filters.status as Status);
      gaql += ` AND campaign.status = '${googleStatus}'`;
    }

    gaql += ` LIMIT ${limit}`;

    const rows = await this.query(ctx, gaql);
    const data = rows.map((r) => fromGoogleCampaign(r as GoogleCampaign));

    // Google GAQL doesn't return cursors; use offset-based pagination via the cursor as offset
    const offset = cursor ? parseInt(cursor, 10) : 0;
    const hasMore = rows.length === limit;

    return {
      data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: hasMore,
        ...(hasMore && { next_cursor: String(offset + limit) }),
        ...(offset > 0 && { prev_cursor: String(Math.max(0, offset - limit)) }),
      },
    };
  }

  async getCampaign(ctx: AdapterContext, campaignId: string): Promise<UnifiedCampaign> {
    const gaql = `
      SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type,
             campaign.start_date, campaign.end_date,
             campaign_budget.amount_micros, campaign_budget.period
      FROM campaign
      WHERE campaign.id = ${campaignId}
      LIMIT 1
    `;
    const rows = await this.query(ctx, gaql);
    if (!rows.length) {
      throw new AdsError('NOT_FOUND', 'google', `Campaign ${campaignId} not found`, false);
    }
    return fromGoogleCampaign(rows[0] as GoogleCampaign);
  }

  async createCampaign(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedCampaign> {
    // Build campaign payload from input
    const name = String(input['name'] ?? 'New Campaign');
    const status = toGoogleStatus((input['status'] as Status | undefined) ?? 'paused');
    const objective = (input['objective'] as string | undefined) ?? 'conversions';
    const channel = input['channel'] as string | undefined;
    const channelType = toGoogleCampaignType(
      objective as any,
      channel as any
    );
    const budget = input['budget'] as { amount?: number; type?: string } | undefined;
    const budgetMicros = budget?.amount ? baseToMicros(budget.amount) : baseToMicros(10);
    const budgetPeriod = budget?.type === 'lifetime' ? 'CUSTOM_PERIOD' : 'DAILY';
    const schedule = input['schedule'] as { start_date?: string; end_date?: string } | undefined;
    const startDate = schedule?.start_date
      ? toGaqlDate(schedule.start_date)
      : toGaqlDate(new Date().toISOString().slice(0, 10));

    // First create the budget
    const budgetResult = await this.mutate(ctx, 'campaignBudgets', 'create', {
      name: `Budget for ${name}`,
      amount_micros: budgetMicros,
      period: budgetPeriod,
    });

    const budgetResourceName =
      budgetResult?.resource_name ?? budgetResult?.results?.[0]?.resource_name;

    // Then create the campaign
    const campaignPayload: Record<string, unknown> = {
      name,
      status,
      advertising_channel_type: channelType,
      campaign_budget: budgetResourceName,
      start_date: startDate,
    };
    if (schedule?.end_date) {
      campaignPayload['end_date'] = toGaqlDate(schedule.end_date);
    }

    const result = await this.mutate(ctx, 'campaigns', 'create', campaignPayload);
    const resourceName =
      result?.resource_name ?? result?.results?.[0]?.resource_name;

    // Extract id from resource name: customers/{cid}/campaigns/{id}
    const idMatch = String(resourceName ?? '').match(/campaigns\/(\d+)/);
    const newId = idMatch ? idMatch[1] : String(Date.now());

    return this.getCampaign(ctx, newId);
  }

  async updateCampaign(
    ctx: AdapterContext,
    campaignId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedCampaign> {
    const customerId = this.customerId(ctx);
    const payload: Record<string, unknown> = {
      resource_name: `customers/${customerId}/campaigns/${campaignId}`,
    };

    if (updates['name']) payload['name'] = updates['name'];
    if (updates['status']) {
      payload['status'] = toGoogleStatus(updates['status'] as Status);
    }
    if (updates['budget']) {
      const b = updates['budget'] as { amount?: number };
      if (b.amount !== undefined) {
        // Update the campaign budget separately
        const gaql = `
          SELECT campaign_budget.resource_name
          FROM campaign
          WHERE campaign.id = ${campaignId}
          LIMIT 1
        `;
        const rows = await this.query(ctx, gaql);
        const budgetResourceName = rows[0]?.campaign_budget?.resource_name;
        if (budgetResourceName) {
          await this.mutate(ctx, 'campaignBudgets', 'update', {
            resource_name: budgetResourceName,
            amount_micros: baseToMicros(b.amount),
          });
        }
      }
    }
    if (updates['schedule']) {
      const s = updates['schedule'] as { start_date?: string; end_date?: string };
      if (s.start_date) payload['start_date'] = toGaqlDate(s.start_date);
      if (s.end_date) payload['end_date'] = toGaqlDate(s.end_date);
    }

    await this.mutate(ctx, 'campaigns', 'update', payload);
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
    // Google uses REMOVED status rather than hard delete
    const customerId = this.customerId(ctx);
    await this.mutate(ctx, 'campaigns', 'update', {
      resource_name: `customers/${customerId}/campaigns/${campaignId}`,
      status: 'REMOVED',
    });
  }

  async cloneCampaign(
    ctx: AdapterContext,
    campaignId: string,
    name?: string
  ): Promise<UnifiedCampaign> {
    const existing = await this.getCampaign(ctx, campaignId);
    return this.createCampaign(ctx, {
      name: name ?? `${existing.name} (copy)`,
      status: 'paused',
      objective: existing.objective,
      channel: existing.channel,
      budget: { ...existing.budget },
      schedule: { start_date: existing.schedule.start_date },
    });
  }

  // ─── Ad Sets (Ad Groups) ─────────────────────────────────────────────────

  async listAdSets(
    ctx: AdapterContext,
    campaignId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAdSet>> {
    // Check if this is a keyword listing operation (passed from keyword tools)
    const gaql = `
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.campaign,
             ad_group.type, ad_group.cpc_bid_micros, ad_group.target_cpa_micros
      FROM ad_group
      WHERE ad_group.campaign.id = ${campaignId}
        AND ad_group.status != 'REMOVED'
      LIMIT ${limit}
    `;
    const rows = await this.query(ctx, gaql);
    const data = rows.map((r) => mapGoogleAdGroup(r as GoogleAdGroup, campaignId));
    const hasMore = rows.length === limit;
    const offset = cursor ? parseInt(cursor, 10) : 0;

    return {
      data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: hasMore,
        ...(hasMore && { next_cursor: String(offset + limit) }),
        ...(offset > 0 && { prev_cursor: String(Math.max(0, offset - limit)) }),
      },
    };
  }

  async getAdSet(ctx: AdapterContext, adsetId: string): Promise<UnifiedAdSet> {
    const gaql = `
      SELECT ad_group.id, ad_group.name, ad_group.status, ad_group.campaign,
             ad_group.type, ad_group.cpc_bid_micros, ad_group.target_cpa_micros
      FROM ad_group
      WHERE ad_group.id = ${adsetId}
      LIMIT 1
    `;
    const rows = await this.query(ctx, gaql);
    if (!rows.length) {
      throw new AdsError('NOT_FOUND', 'google', `Ad group ${adsetId} not found`, false);
    }
    const row = rows[0] as GoogleAdGroup;
    // Extract campaign id from resource name
    const campaignMatch = String(row.ad_group.campaign ?? '').match(/campaigns\/(\d+)/);
    const campaignId = campaignMatch ? campaignMatch[1] : '';
    return mapGoogleAdGroup(row, campaignId);
  }

  async createAdSet(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    // Handle keyword add operations routed through createAdSet
    if (input['operation'] === 'add_keywords') {
      return this._addKeywordsViaAdSet(ctx, input);
    }

    const customerId = this.customerId(ctx);
    const campaignId = String(input['campaign_id'] ?? '');
    const name = String(input['name'] ?? 'New Ad Group');
    const status = toGoogleStatus((input['status'] as Status | undefined) ?? 'paused');
    const bid = input['bid'] as { amount?: number } | undefined;
    const bidMicros = bid?.amount ? baseToMicros(bid.amount) : baseToMicros(1);

    const payload: Record<string, unknown> = {
      name,
      status,
      campaign: `customers/${customerId}/campaigns/${campaignId}`,
      cpc_bid_micros: bidMicros,
    };

    const result = await this.mutate(ctx, 'adGroups', 'create', payload);
    const resourceName =
      result?.resource_name ?? result?.results?.[0]?.resource_name;
    const idMatch = String(resourceName ?? '').match(/adGroups\/(\d+)/);
    const newId = idMatch ? idMatch[1] : String(Date.now());
    return this.getAdSet(ctx, newId);
  }

  private async _addKeywordsViaAdSet(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const customerId = this.customerId(ctx);
    const adGroupId = String(input['ad_group_id'] ?? '');
    const keywords = (input['keywords'] as string[] | undefined) ?? [];
    const matchType = String(input['match_type'] ?? 'BROAD').toUpperCase();

    const criteriaPayloads = keywords.map((kw) => ({
      ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
      status: 'ENABLED',
      keyword: { text: kw, match_type: matchType },
    }));

    for (const payload of criteriaPayloads) {
      await this.mutate(ctx, 'adGroupCriteria', 'create', payload);
    }

    return this.getAdSet(ctx, adGroupId);
  }

  async updateAdSet(
    ctx: AdapterContext,
    adsetId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    // Handle keyword operations routed through updateAdSet
    if (updates['operation'] === 'remove_keywords') {
      return this._removeKeywordsViaAdSet(ctx, adsetId, updates);
    }
    if (updates['operation'] === 'add_negative_keywords') {
      return this._addNegativeKeywordsViaAdSet(ctx, adsetId, updates);
    }

    const customerId = this.customerId(ctx);
    const payload: Record<string, unknown> = {
      resource_name: `customers/${customerId}/adGroups/${adsetId}`,
    };

    if (updates['name']) payload['name'] = updates['name'];
    if (updates['status']) {
      payload['status'] = toGoogleStatus(updates['status'] as Status);
    }
    if (updates['bid']) {
      const b = updates['bid'] as { amount?: number };
      if (b.amount !== undefined) {
        payload['cpc_bid_micros'] = baseToMicros(b.amount);
      }
    }

    await this.mutate(ctx, 'adGroups', 'update', payload);
    return this.getAdSet(ctx, adsetId);
  }

  private async _removeKeywordsViaAdSet(
    ctx: AdapterContext,
    adGroupId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const customerId = this.customerId(ctx);
    const keywordIds = (updates['keyword_ids'] as string[] | undefined) ?? [];

    for (const kwId of keywordIds) {
      await this.mutate(ctx, 'adGroupCriteria', 'remove', {
        resource_name: `customers/${customerId}/adGroupCriteria/${adGroupId}~${kwId}`,
      });
    }

    return this.getAdSet(ctx, adGroupId);
  }

  private async _addNegativeKeywordsViaAdSet(
    ctx: AdapterContext,
    entityId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAdSet> {
    const customerId = this.customerId(ctx);
    const keywords = (updates['keywords'] as string[] | undefined) ?? [];
    const matchType = String(updates['match_type'] ?? 'BROAD').toUpperCase();
    const entityType = String(updates['entity_type'] ?? 'campaign');

    if (entityType === 'campaign') {
      for (const kw of keywords) {
        await this.mutate(ctx, 'campaignCriteria', 'create', {
          campaign: `customers/${customerId}/campaigns/${entityId}`,
          negative: true,
          keyword: { text: kw, match_type: matchType },
        });
      }
    } else {
      // ad_group level
      for (const kw of keywords) {
        await this.mutate(ctx, 'adGroupCriteria', 'create', {
          ad_group: `customers/${customerId}/adGroups/${entityId}`,
          negative: true,
          keyword: { text: kw, match_type: matchType },
        });
      }
    }

    // Return a placeholder adset shape (entityId may be a campaign id)
    return this.getAdSet(ctx, entityId).catch(() => ({
      id: entityId,
      platform: 'google' as const,
      campaign_id: entityId,
      name: entityId,
      status: 'active' as const,
      targeting: {
        locations: [],
        interests: [],
        behaviors: [],
        audiences: [],
        languages: [],
        devices: [],
        os: [],
      },
      bid: { strategy: 'lowest_cost' as const },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));
  }

  async setAdSetStatus(
    ctx: AdapterContext,
    adsetId: string,
    status: string
  ): Promise<UnifiedAdSet> {
    return this.updateAdSet(ctx, adsetId, { status });
  }

  async deleteAdSet(ctx: AdapterContext, adsetId: string): Promise<void> {
    const customerId = this.customerId(ctx);
    await this.mutate(ctx, 'adGroups', 'update', {
      resource_name: `customers/${customerId}/adGroups/${adsetId}`,
      status: 'REMOVED',
    });
  }

  // ─── Ads ──────────────────────────────────────────────────────────────────

  async listAds(
    ctx: AdapterContext,
    adsetId: string,
    limit: number,
    cursor?: string
  ): Promise<PaginatedResponse<UnifiedAd>> {
    const gaql = `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
             ad_group_ad.ad.final_urls, ad_group_ad.status,
             ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions,
             ad_group_ad.ad.expanded_text_ad.headline_part1,
             ad_group_ad.ad.expanded_text_ad.description,
             campaign.id, ad_group.id
      FROM ad_group_ad
      WHERE ad_group.id = ${adsetId}
        AND ad_group_ad.status != 'REMOVED'
      LIMIT ${limit}
    `;
    const rows = await this.query(ctx, gaql);
    const data = rows.map((r) => mapGoogleAd(r as GoogleAd));
    const hasMore = rows.length === limit;
    const offset = cursor ? parseInt(cursor, 10) : 0;

    return {
      data,
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: hasMore,
        ...(hasMore && { next_cursor: String(offset + limit) }),
        ...(offset > 0 && { prev_cursor: String(Math.max(0, offset - limit)) }),
      },
    };
  }

  async getAd(ctx: AdapterContext, adId: string): Promise<UnifiedAd> {
    const gaql = `
      SELECT ad_group_ad.ad.id, ad_group_ad.ad.name, ad_group_ad.ad.type,
             ad_group_ad.ad.final_urls, ad_group_ad.status,
             ad_group_ad.ad.responsive_search_ad.headlines,
             ad_group_ad.ad.responsive_search_ad.descriptions,
             ad_group_ad.ad.expanded_text_ad.headline_part1,
             ad_group_ad.ad.expanded_text_ad.description,
             campaign.id, ad_group.id
      FROM ad_group_ad
      WHERE ad_group_ad.ad.id = ${adId}
      LIMIT 1
    `;
    const rows = await this.query(ctx, gaql);
    if (!rows.length) {
      throw new AdsError('NOT_FOUND', 'google', `Ad ${adId} not found`, false);
    }
    return mapGoogleAd(rows[0] as GoogleAd);
  }

  async createAd(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<UnifiedAd> {
    const customerId = this.customerId(ctx);
    const adGroupId = String(input['adset_id'] ?? input['ad_group_id'] ?? '');
    const creative = input['creative'] as Record<string, unknown> | undefined;
    const name = String(input['name'] ?? 'New Ad');

    const adPayload: Record<string, unknown> = {
      name,
      type: 'RESPONSIVE_SEARCH_AD',
    };

    if (creative?.type === 'responsive_search') {
      const headlines = (creative['headlines'] as string[] | undefined) ?? [];
      const descriptions = (creative['descriptions'] as string[] | undefined) ?? [];
      const finalUrl = String(creative['final_url'] ?? 'https://example.com');
      adPayload['responsive_search_ad'] = {
        headlines: headlines.map((text, idx) => ({ text, pin_field: idx === 0 ? 'HEADLINE_1' : undefined })).filter(h => h.text),
        descriptions: descriptions.map((text) => ({ text })),
      };
      adPayload['final_urls'] = [finalUrl];
    } else if (creative?.type === 'image') {
      adPayload['type'] = 'IMAGE_AD';
      adPayload['final_urls'] = [String(creative['landing_url'] ?? 'https://example.com')];
    }

    const adGroupAdPayload = {
      ad_group: `customers/${customerId}/adGroups/${adGroupId}`,
      status: toGoogleStatus((input['status'] as Status | undefined) ?? 'active'),
      ad: adPayload,
    };

    const result = await this.mutate(ctx, 'adGroupAds', 'create', adGroupAdPayload);
    const resourceName =
      result?.resource_name ?? result?.results?.[0]?.resource_name;

    // Resource name pattern: customers/{cid}/adGroupAds/{adGroupId}~{adId}
    const idMatch = String(resourceName ?? '').match(/adGroupAds\/\d+~(\d+)/);
    const newId = idMatch ? idMatch[1] : String(Date.now());
    return this.getAd(ctx, newId);
  }

  async updateAd(
    ctx: AdapterContext,
    adId: string,
    updates: Record<string, unknown>
  ): Promise<UnifiedAd> {
    // To find the ad_group_id for the resource name, look it up first
    const existing = await this.getAd(ctx, adId);
    const customerId = this.customerId(ctx);
    const payload: Record<string, unknown> = {
      resource_name: `customers/${customerId}/adGroupAds/${existing.adset_id}~${adId}`,
    };

    if (updates['status']) {
      payload['status'] = toGoogleStatus(updates['status'] as Status);
    }

    await this.mutate(ctx, 'adGroupAds', 'update', payload);
    return this.getAd(ctx, adId);
  }

  async deleteAd(ctx: AdapterContext, adId: string): Promise<void> {
    const existing = await this.getAd(ctx, adId);
    const customerId = this.customerId(ctx);
    await this.mutate(ctx, 'adGroupAds', 'update', {
      resource_name: `customers/${customerId}/adGroupAds/${existing.adset_id}~${adId}`,
      status: 'REMOVED',
    });
  }

  // ─── Creatives + Audience Files ───────────────────────────────────────────

  async uploadCreative(
    _ctx: AdapterContext,
    filePath: string,
    _mediaType: string
  ): Promise<{ creative_id: string; url: string }> {
    // Google Ads does not have a generic creative upload endpoint via the Ads API.
    // Assets are created inline when creating ads or via the AssetService.
    // Return the file path as both ID and URL for now.
    return {
      creative_id: `asset:${filePath}`,
      url: filePath.startsWith('https://') ? filePath : `https://storage.googleapis.com/${filePath}`,
    };
  }

  async uploadAudienceFile(
    _ctx: AdapterContext,
    filePath: string
  ): Promise<{ uploaded_file_id: string }> {
    // Google Ads audience uploads use OfflineUserDataJobService — not supported in this adapter.
    return { uploaded_file_id: `file:${filePath}` };
  }

  // ─── Audiences ────────────────────────────────────────────────────────────

  async listAudiences(
    ctx: AdapterContext,
    type: string | undefined,
    limit: number,
    _cursor?: string
  ): Promise<PaginatedResponse<Record<string, unknown>>> {
    let gaql = `
      SELECT user_list.id, user_list.name, user_list.type,
             user_list.size_for_display, user_list.size_for_search,
             user_list.membership_status
      FROM user_list
    `;
    if (type) {
      gaql += ` WHERE user_list.type = '${type.toUpperCase()}'`;
    }
    gaql += ` LIMIT ${limit}`;

    const rows = await this.query(ctx, gaql);

    return {
      data: rows.map((r) => {
        const ul = (r as any).user_list ?? r;
        return {
          id: String(ul.id ?? ''),
          name: String(ul.name ?? ''),
          type: String(ul.type ?? ''),
          size_for_display: ul.size_for_display ?? 0,
          size_for_search: ul.size_for_search ?? 0,
          status: String(ul.membership_status ?? ''),
        };
      }),
      pagination: {
        page: 1,
        page_size: limit,
        has_next_page: rows.length === limit,
      },
    };
  }

  async createAudience(
    ctx: AdapterContext,
    input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const result = await this.mutate(ctx, 'userLists', 'create', input);
    return { ...input, resource_name: result?.resource_name };
  }

  async updateAudience(
    ctx: AdapterContext,
    audienceId: string,
    updates: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const customerId = this.customerId(ctx);
    await this.mutate(ctx, 'userLists', 'update', {
      resource_name: `customers/${customerId}/userLists/${audienceId}`,
      ...updates,
    });
    return { id: audienceId, ...updates };
  }

  async getAudienceSize(
    _ctx: AdapterContext,
    targeting: Record<string, unknown>
  ): Promise<{ estimated_reach: number; range?: { min: number; max: number } }> {
    // Google Ads does not have a direct reach estimation API like Meta.
    // Return a placeholder based on targeting complexity.
    const reach = 100_000;
    return {
      estimated_reach: reach,
      range: { min: Math.floor(reach * 0.8), max: Math.ceil(reach * 1.2) },
    };
  }

  // ─── Reporting ─────────────────────────────────────────────────────────────

  async getPerformance(
    ctx: AdapterContext,
    entityType: string,
    entityId: string,
    dateRange: DateRange,
    granularity: string,
    _attributionWindow?: AttributionWindow
  ): Promise<Record<string, unknown>[]> {
    // Handle negative keyword listing routed from keyword tools
    if (entityType.includes('negative_keywords')) {
      return this._listNegativeKeywords(ctx, entityId, entityType);
    }

    const startDate = toGaqlDate(dateRange.start_date);
    const endDate = dateRange.end_date
      ? toGaqlDate(dateRange.end_date)
      : toGaqlDate(dateRange.start_date);

    const entityField =
      entityType === 'campaign' ? 'campaign' :
      entityType === 'ad_group' ? 'ad_group' :
      'campaign';

    let gaql = `
      SELECT segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc, metrics.conversions,
             metrics.cost_per_conversion, metrics.conversions_value
      FROM ${entityType === 'ad_group' ? 'ad_group' : 'campaign'}
      WHERE ${entityField}.id = ${entityId}
        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    if (granularity === 'total') {
      // Remove segments.date for aggregated view
      gaql = `
        SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
               metrics.ctr, metrics.average_cpc, metrics.conversions,
               metrics.cost_per_conversion, metrics.conversions_value
        FROM ${entityType === 'ad_group' ? 'ad_group' : 'campaign'}
        WHERE ${entityField}.id = ${entityId}
          AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      `;
    }

    const rows = await this.query(ctx, gaql);

    return rows.map((r) => {
      const metrics = (r as any).metrics ?? {};
      const segments = (r as any).segments ?? {};
      return {
        date: segments.date,
        impressions: parseInt(metrics.impressions ?? '0', 10),
        clicks: parseInt(metrics.clicks ?? '0', 10),
        spend: microsToBase(parseInt(metrics.cost_micros ?? '0', 10)),
        ctr: metrics.ctr ?? 0,
        cpc: microsToBase(parseInt(metrics.average_cpc ?? '0', 10)),
        conversions: parseFloat(metrics.conversions ?? '0'),
        cost_per_conversion: microsToBase(parseInt(metrics.cost_per_conversion ?? '0', 10)),
        conversion_value: parseFloat(metrics.conversions_value ?? '0'),
      };
    });
  }

  private async _listNegativeKeywords(
    ctx: AdapterContext,
    entityId: string,
    entityType: string
  ): Promise<Record<string, unknown>[]> {
    const isCampaign = entityType.includes('campaign');

    if (isCampaign) {
      const gaql = `
        SELECT campaign_criterion.keyword.text, campaign_criterion.keyword.match_type,
               campaign_criterion.status, campaign_criterion.criterion_id
        FROM campaign_criterion
        WHERE campaign.id = ${entityId}
          AND campaign_criterion.negative = TRUE
          AND campaign_criterion.type = 'KEYWORD'
        LIMIT 1000
      `;
      const rows = await this.query(ctx, gaql);
      return rows.map((r) => {
        const cc = (r as any).campaign_criterion ?? {};
        return {
          id: String(cc.criterion_id ?? ''),
          text: cc.keyword?.text ?? '',
          match_type: cc.keyword?.match_type ?? '',
          status: cc.status ?? '',
          negative: true,
          entity_type: 'campaign',
          entity_id: entityId,
        };
      });
    } else {
      const gaql = `
        SELECT ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type,
               ad_group_criterion.status, ad_group_criterion.criterion_id
        FROM ad_group_criterion
        WHERE ad_group.id = ${entityId}
          AND ad_group_criterion.negative = TRUE
          AND ad_group_criterion.type = 'KEYWORD'
        LIMIT 1000
      `;
      const rows = await this.query(ctx, gaql);
      return rows.map((r) => {
        const ac = (r as any).ad_group_criterion ?? {};
        return {
          id: String(ac.criterion_id ?? ''),
          text: ac.keyword?.text ?? '',
          match_type: ac.keyword?.match_type ?? '',
          status: ac.status ?? '',
          negative: true,
          entity_type: 'ad_group',
          entity_id: entityId,
        };
      });
    }
  }

  async getInsights(
    ctx: AdapterContext,
    entityId: string,
    breakdowns: string[],
    dateRange: DateRange
  ): Promise<Record<string, unknown>[]> {
    // Handle search terms report routed from keyword tools
    if (breakdowns.includes('search_term')) {
      return this._getSearchTerms(ctx, entityId, dateRange);
    }

    const startDate = toGaqlDate(dateRange.start_date);
    const endDate = dateRange.end_date
      ? toGaqlDate(dateRange.end_date)
      : toGaqlDate(dateRange.start_date);

    // Map unified breakdowns to Google segments
    const segmentMap: Record<string, string> = {
      age: 'segments.age_range',
      gender: 'segments.gender',
      device: 'segments.device',
      network: 'segments.ad_network_type',
    };

    const selectedSegments = breakdowns
      .map((b) => segmentMap[b])
      .filter(Boolean);

    const segmentSelect = selectedSegments.length
      ? ', ' + selectedSegments.join(', ')
      : '';

    const gaql = `
      SELECT metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc${segmentSelect}
      FROM campaign
      WHERE campaign.id = ${entityId}
        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
    `;

    const rows = await this.query(ctx, gaql);
    return rows.map((r) => {
      const metrics = (r as any).metrics ?? {};
      const segments = (r as any).segments ?? {};
      return {
        impressions: parseInt(metrics.impressions ?? '0', 10),
        clicks: parseInt(metrics.clicks ?? '0', 10),
        spend: microsToBase(parseInt(metrics.cost_micros ?? '0', 10)),
        ctr: metrics.ctr ?? 0,
        cpc: microsToBase(parseInt(metrics.average_cpc ?? '0', 10)),
        ...breakdowns.reduce((acc, b) => {
          const segKey = segmentMap[b];
          if (segKey) {
            const segParts = segKey.split('.');
            acc[b] = segments[segParts[segParts.length - 1]];
          }
          return acc;
        }, {} as Record<string, unknown>),
      };
    });
  }

  private async _getSearchTerms(
    ctx: AdapterContext,
    adGroupId: string,
    dateRange: DateRange
  ): Promise<Record<string, unknown>[]> {
    const startDate = toGaqlDate(dateRange.start_date);
    const endDate = dateRange.end_date
      ? toGaqlDate(dateRange.end_date)
      : toGaqlDate(dateRange.start_date);

    const gaql = `
      SELECT search_term_view.search_term, search_term_view.status,
             metrics.impressions, metrics.clicks, metrics.cost_micros,
             metrics.ctr, metrics.average_cpc, metrics.conversions,
             segments.date, ad_group.id, campaign.id
      FROM search_term_view
      WHERE ad_group.id = ${adGroupId}
        AND segments.date BETWEEN '${startDate}' AND '${endDate}'
      LIMIT 1000
    `;

    const rows = await this.query(ctx, gaql);
    return rows.map((r) => {
      const stv = (r as GoogleSearchTerm).search_term_view ?? {};
      const metrics = (r as GoogleSearchTerm).metrics ?? {};
      return {
        search_term: stv.search_term ?? '',
        status: stv.status ?? '',
        impressions: parseInt(String(metrics.impressions ?? '0'), 10),
        clicks: parseInt(String(metrics.clicks ?? '0'), 10),
        spend: microsToBase(parseInt(String(metrics.cost_micros ?? '0'), 10)),
        ctr: metrics.ctr ?? 0,
        cpc: microsToBase(parseInt(String(metrics.average_cpc ?? '0'), 10)),
        conversions: parseFloat(String(metrics.conversions ?? '0')),
        date: (r as GoogleSearchTerm).segments?.date,
        ad_group_id: adGroupId,
      };
    });
  }

  // ─── Budget ────────────────────────────────────────────────────────────────

  async getBudget(ctx: AdapterContext, campaignId: string): Promise<Record<string, unknown>> {
    const gaql = `
      SELECT campaign.id, campaign_budget.amount_micros, campaign_budget.period,
             metrics.cost_micros
      FROM campaign
      WHERE campaign.id = ${campaignId}
        AND segments.date = '${toGaqlDate(new Date().toISOString().slice(0, 10))}'
      LIMIT 1
    `;

    const rows = await this.query(ctx, gaql).catch(() => []);
    const row = rows[0] as any;
    const budgetMicros = parseInt(row?.campaign_budget?.amount_micros ?? '0', 10);
    const spendMicros = parseInt(row?.metrics?.cost_micros ?? '0', 10);
    const budgetAmount = microsToBase(budgetMicros);
    const todaySpend = microsToBase(spendMicros);

    return {
      campaign_id: campaignId,
      budget_type: row?.campaign_budget?.period === 'CUSTOM_PERIOD' ? 'lifetime' : 'daily',
      budget_amount: budgetAmount,
      currency: 'USD',
      today_spend: todaySpend,
      remaining: budgetAmount - todaySpend,
    };
  }

  async getAllActiveCampaignBudgets(ctx: AdapterContext): Promise<number[]> {
    const gaql = `
      SELECT campaign_budget.amount_micros, campaign_budget.period
      FROM campaign
      WHERE campaign.status = 'ENABLED'
      LIMIT 200
    `;
    const rows = await this.query(ctx, gaql);
    return rows.map((r) => {
      const micros = parseInt((r as any).campaign_budget?.amount_micros ?? '0', 10);
      return microsToBase(micros);
    });
  }

  // ─── Rules (NOT supported via API) ────────────────────────────────────────

  async listRules(_ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    return [];
  }

  async createRule(
    _ctx: AdapterContext,
    _input: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'google',
      'Use Google Ads Scripts',
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
      'google',
      'Use Google Ads Scripts',
      false
    );
  }

  async deleteRule(_ctx: AdapterContext, _ruleId: string): Promise<void> {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'google',
      'Use Google Ads Scripts',
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

  // ─── Tracking ─────────────────────────────────────────────────────────────

  async listPixels(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    // Google uses conversion tracking tags, not pixels in the Meta sense.
    // Query conversion actions as the Google equivalent.
    const gaql = `
      SELECT conversion_action.id, conversion_action.name, conversion_action.type,
             conversion_action.status, conversion_action.tag_snippets
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      LIMIT 100
    `;
    const rows = await this.query(ctx, gaql);
    return rows.map((r) => {
      const ca = (r as any).conversion_action ?? r;
      return {
        id: String(ca.id ?? ''),
        name: String(ca.name ?? ''),
        type: String(ca.type ?? ''),
        status: String(ca.status ?? ''),
        tag_snippets: ca.tag_snippets ?? [],
      };
    });
  }

  async getPixelStatus(
    ctx: AdapterContext,
    pixelId: string
  ): Promise<Record<string, unknown>> {
    const gaql = `
      SELECT conversion_action.id, conversion_action.name, conversion_action.type,
             conversion_action.status, conversion_action.tag_snippets
      FROM conversion_action
      WHERE conversion_action.id = ${pixelId}
      LIMIT 1
    `;
    const rows = await this.query(ctx, gaql);
    if (!rows.length) {
      throw new AdsError('NOT_FOUND', 'google', `Conversion action ${pixelId} not found`, false);
    }
    const ca = (rows[0] as any).conversion_action ?? rows[0];
    return {
      id: String(ca.id ?? ''),
      name: String(ca.name ?? ''),
      type: String(ca.type ?? ''),
      status: String(ca.status ?? ''),
      tag_snippets: ca.tag_snippets ?? [],
    };
  }

  async listConversionEvents(ctx: AdapterContext): Promise<Record<string, unknown>[]> {
    const gaql = `
      SELECT conversion_action.id, conversion_action.name, conversion_action.type,
             conversion_action.status, conversion_action.counting_type,
             conversion_action.value_settings.default_value,
             conversion_action.attribution_model_settings.attribution_model
      FROM conversion_action
      WHERE conversion_action.status != 'REMOVED'
      LIMIT 100
    `;
    const rows = await this.query(ctx, gaql);
    return rows.map((r) => {
      const ca = (r as any).conversion_action ?? r;
      return {
        id: String(ca.id ?? ''),
        name: String(ca.name ?? ''),
        type: String(ca.type ?? ''),
        status: String(ca.status ?? ''),
        counting_type: String(ca.counting_type ?? ''),
      };
    });
  }

  async getEventMatchQuality(
    _ctx: AdapterContext,
    pixelId: string
  ): Promise<Record<string, unknown>> {
    // Google does not have an equivalent to Meta's Event Match Quality.
    return {
      id: pixelId,
      note: 'Event match quality is not available via Google Ads API. Use Google Ads UI or Tag Manager.',
    };
  }

  async validateTrackingUrls(
    ctx: AdapterContext,
    entityType: string,
    entityId: string
  ): Promise<Record<string, unknown>[]> {
    const resourceField =
      entityType === 'campaign' ? 'campaign' :
      entityType === 'ad_group' ? 'ad_group' :
      'campaign';

    const gaql = `
      SELECT ad_group_ad.ad.final_urls, ad_group_ad.ad.tracking_url_template,
             ad_group_ad.ad.url_custom_parameters, ad_group_ad.ad.id,
             ad_group.id, campaign.id
      FROM ad_group_ad
      WHERE ${resourceField}.id = ${entityId}
        AND ad_group_ad.status != 'REMOVED'
      LIMIT 100
    `;
    const rows = await this.query(ctx, gaql);
    return rows.map((r) => {
      const ad = (r as any).ad_group_ad?.ad ?? {};
      return {
        ad_id: String(ad.id ?? ''),
        final_urls: ad.final_urls ?? [],
        tracking_url_template: ad.tracking_url_template ?? null,
        url_custom_parameters: ad.url_custom_parameters ?? [],
      };
    });
  }

  // ─── Account ──────────────────────────────────────────────────────────────

  async getAccountHealth(ctx: AdapterContext): Promise<Record<string, unknown>> {
    const gaql = `
      SELECT customer.id, customer.descriptive_name, customer.status,
             customer.currency_code, customer.time_zone,
             customer.auto_tagging_enabled,
             metrics.impressions, metrics.clicks, metrics.cost_micros
      FROM customer
      LIMIT 1
    `;
    const rows = await this.query(ctx, gaql);
    const row = rows[0] as any;
    const customer = row?.customer ?? {};
    const metrics = row?.metrics ?? {};

    return {
      id: String(customer.id ?? this.customerId(ctx)),
      name: String(customer.descriptive_name ?? ''),
      status: String(customer.status ?? 'ENABLED'),
      currency: String(customer.currency_code ?? 'USD'),
      timezone: String(customer.time_zone ?? ''),
      auto_tagging_enabled: customer.auto_tagging_enabled ?? false,
      impressions_30d: parseInt(metrics.impressions ?? '0', 10),
      clicks_30d: parseInt(metrics.clicks ?? '0', 10),
      spend_30d: microsToBase(parseInt(metrics.cost_micros ?? '0', 10)),
    };
  }
}
