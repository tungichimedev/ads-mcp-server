import {
  normalizeAssetType,
  normalizeFieldType,
  extractAssetContent,
  mapAdAsset,
} from './asset.js';

describe('asset enum normalization', () => {
  it('maps asset type', () => {
    expect(normalizeAssetType(4)).toBe('IMAGE');
    expect(normalizeAssetType(2)).toBe('YOUTUBE_VIDEO');
    expect(normalizeAssetType(5)).toBe('TEXT');
  });

  it('maps field type', () => {
    expect(normalizeFieldType(2)).toBe('HEADLINE');
    expect(normalizeFieldType(5)).toBe('MARKETING_IMAGE');
    expect(normalizeFieldType(20)).toBe('SQUARE_MARKETING_IMAGE');
  });

  it('passes through strings and falls back', () => {
    expect(normalizeAssetType('image')).toBe('IMAGE');
    expect(normalizeFieldType(999)).toBe('UNKNOWN(999)');
    expect(normalizeAssetType(undefined)).toBe('UNSPECIFIED');
  });
});

describe('extractAssetContent', () => {
  it('extracts text', () => {
    expect(extractAssetContent({ text_asset: { text: 'Scan your stamps' } })).toEqual({
      text: 'Scan your stamps',
    });
  });

  it('extracts image url + dimensions', () => {
    expect(
      extractAssetContent({
        image_asset: { full_size: { url: 'https://img/x.png', width_pixels: 1200, height_pixels: 628 } },
      }),
    ).toEqual({ image_url: 'https://img/x.png', dimensions: '1200x628' });
  });

  it('extracts youtube video', () => {
    expect(extractAssetContent({ youtube_video_asset: { youtube_video_id: 'abc123', youtube_video_title: 'Demo' } })).toEqual({
      youtube_video_id: 'abc123',
      youtube_url: 'https://www.youtube.com/watch?v=abc123',
      youtube_title: 'Demo',
    });
  });

  it('returns {} for empty asset', () => {
    expect(extractAssetContent({})).toEqual({});
    expect(extractAssetContent(undefined)).toEqual({});
  });
});

describe('mapAdAsset', () => {
  it('maps a full image asset row', () => {
    const row = {
      asset: {
        id: '111',
        name: 'Hero',
        type: 4,
        image_asset: { full_size: { url: 'https://img/hero.png', width_pixels: 1200, height_pixels: 1200 } },
      },
      ad_group_ad_asset_view: { field_type: 20, policy_summary: { approval_status: 3 } },
      ad_group: { id: '22', name: 'Ad group 1' },
      campaign: { id: '33', name: 'Stampscan_CPI_US' },
    };
    expect(mapAdAsset(row)).toEqual({
      asset_id: '111',
      asset_type: 'IMAGE',
      field_type: 'SQUARE_MARKETING_IMAGE',
      name: 'Hero',
      approval_status: 'APPROVED_LIMITED',
      content: { image_url: 'https://img/hero.png', dimensions: '1200x1200' },
      campaign_id: '33',
      campaign_name: 'Stampscan_CPI_US',
      ad_group_id: '22',
      ad_group_name: 'Ad group 1',
    });
  });
});
