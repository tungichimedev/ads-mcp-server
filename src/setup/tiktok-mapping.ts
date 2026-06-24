import type { AdsConfig } from '../utils/config.js';

const CAMPAIGN_GET_URL = 'https://business-api.tiktok.com/open_api/v1.3/campaign/get/';

export interface MappedAdvertiser {
  advertiserId: string;
  accountName: string;
}

export interface MappingResult {
  matched: MappedAdvertiser[];
  unknown: string[];
}

/** Maps each granted advertiser id to a configured tiktok account (by advertiser_id, else account_id). */
export function mapAdvertisers(config: AdsConfig, advertiserIds: string[]): MappingResult {
  const accounts = config.platforms?.['tiktok']?.accounts ?? {};
  const byId = new Map<string, string>();
  for (const [name, meta] of Object.entries(accounts)) {
    byId.set(meta.advertiser_id ?? meta.account_id, name);
  }

  const matched: MappedAdvertiser[] = [];
  const unknown: string[] = [];
  for (const id of advertiserIds) {
    const accountName = byId.get(id);
    if (accountName) matched.push({ advertiserId: id, accountName });
    else unknown.push(id);
  }
  return { matched, unknown };
}

/** Probes campaign/get to check whether the token carries campaign-management scope. */
export async function probeCampaignScope(
  fetchFn: typeof globalThis.fetch,
  token: string,
  advertiserId: string,
): Promise<boolean> {
  const url = new URL(CAMPAIGN_GET_URL);
  url.searchParams.set('advertiser_id', advertiserId);
  url.searchParams.set('page_size', '1');

  const res = await fetchFn(url.toString(), {
    method: 'GET',
    headers: { 'Access-Token': token, 'Content-Type': 'application/json' },
  });

  const json = (await res.json()) as { code: number; message: string };
  if (json.code === 0) return true;
  if (json.code === 40001) return false;
  throw new Error(`Unexpected TikTok response probing scope (code ${json.code}): ${json.message}`);
}
