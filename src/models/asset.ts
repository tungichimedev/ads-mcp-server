// Unified creative-asset model.
//
// Surfaces the actual creative content (image URLs, YouTube videos, text)
// attached to Google ads/asset-groups via `ad_group_ad_asset_view`, so the
// caller can SEE the creative — e.g. to identify which asset triggered a
// policy flag like MISLEADING_AD_DESIGN.

import { normalizeApprovalStatus } from './policy.js';

export interface AdAsset {
  asset_id: string;
  /** IMAGE, YOUTUBE_VIDEO, TEXT, MEDIA_BUNDLE, etc. */
  asset_type: string;
  /** Where it's used: HEADLINE, DESCRIPTION, MARKETING_IMAGE, YOUTUBE_VIDEO, LOGO, etc. */
  field_type: string;
  name: string;
  /** Policy approval status for this asset, when available. */
  approval_status: string;
  /** Type-specific content: text, image_url + dimensions, or youtube video id/url. */
  content: Record<string, unknown>;
  campaign_id: string;
  campaign_name: string;
  ad_group_id: string;
  ad_group_name: string;
}

// AssetTypeEnum (proto numeric → name), common subset.
const ASSET_TYPE: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'YOUTUBE_VIDEO',
  3: 'MEDIA_BUNDLE',
  4: 'IMAGE',
  5: 'TEXT',
  18: 'CALL_TO_ACTION',
};

// AssetFieldTypeEnum (proto numeric → name), App-campaign-relevant subset.
const FIELD_TYPE: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'HEADLINE',
  3: 'DESCRIPTION',
  5: 'MARKETING_IMAGE',
  6: 'MEDIA_BUNDLE',
  7: 'YOUTUBE_VIDEO',
  18: 'LONG_HEADLINE',
  19: 'BUSINESS_NAME',
  20: 'SQUARE_MARKETING_IMAGE',
  21: 'PORTRAIT_MARKETING_IMAGE',
  22: 'LOGO',
  23: 'LANDSCAPE_LOGO',
  24: 'VIDEO',
};

function mapEnum(value: unknown, map: Record<number, string>): string {
  if (typeof value === 'number') return map[value] ?? `UNKNOWN(${value})`;
  if (typeof value === 'string' && value.trim() !== '') return value.toUpperCase();
  return 'UNSPECIFIED';
}

export function normalizeAssetType(value: unknown): string {
  return mapEnum(value, ASSET_TYPE);
}

export function normalizeFieldType(value: unknown): string {
  return mapEnum(value, FIELD_TYPE);
}

/** Extract type-specific creative content from a raw Google `asset` object. */
export function extractAssetContent(asset: unknown): Record<string, unknown> {
  const a = (asset ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  const textAsset = a['text_asset'] as Record<string, unknown> | undefined;
  if (textAsset?.['text']) out['text'] = textAsset['text'];

  const imageAsset = a['image_asset'] as Record<string, unknown> | undefined;
  const fullSize = imageAsset?.['full_size'] as Record<string, unknown> | undefined;
  if (fullSize?.['url']) {
    out['image_url'] = fullSize['url'];
    if (fullSize['width_pixels'] && fullSize['height_pixels']) {
      out['dimensions'] = `${fullSize['width_pixels']}x${fullSize['height_pixels']}`;
    }
  }

  const ytAsset = a['youtube_video_asset'] as Record<string, unknown> | undefined;
  if (ytAsset?.['youtube_video_id']) {
    out['youtube_video_id'] = ytAsset['youtube_video_id'];
    out['youtube_url'] = `https://www.youtube.com/watch?v=${ytAsset['youtube_video_id']}`;
    if (ytAsset['youtube_video_title']) out['youtube_title'] = ytAsset['youtube_video_title'];
  }

  return out;
}

/** Build a unified AdAsset from a raw `ad_group_ad_asset_view` GAQL row. */
export function mapAdAsset(row: unknown): AdAsset {
  const r = (row ?? {}) as Record<string, unknown>;
  const view = (r['ad_group_ad_asset_view'] ?? {}) as Record<string, unknown>;
  const asset = (r['asset'] ?? {}) as Record<string, unknown>;
  const adGroup = (r['ad_group'] ?? {}) as Record<string, unknown>;
  const campaign = (r['campaign'] ?? {}) as Record<string, unknown>;

  return {
    asset_id: String(asset['id'] ?? ''),
    asset_type: normalizeAssetType(asset['type']),
    field_type: normalizeFieldType(view['field_type']),
    name: String(asset['name'] ?? ''),
    approval_status: normalizeApprovalStatus(
      (view['policy_summary'] as Record<string, unknown> | undefined)?.['approval_status'],
    ),
    content: extractAssetContent(asset),
    campaign_id: String(campaign['id'] ?? ''),
    campaign_name: String(campaign['name'] ?? ''),
    ad_group_id: String(adGroup['id'] ?? ''),
    ad_group_name: String(adGroup['name'] ?? ''),
  };
}
