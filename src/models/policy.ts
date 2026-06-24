// Unified policy / ad-review model.
//
// Google Ads exposes ad- and asset-level policy decisions through the
// `policy_summary` field on `ad_group_ad` and `ad_group_ad_asset_view`.
// The google-ads-api client returns enum fields as their numeric proto
// values, so the helpers below normalize both numeric and string inputs to
// stable, human-readable strings.

export interface PolicyTopic {
  /** Policy topic name, e.g. "Trademarks", "Destination not working". */
  topic: string;
  /** Entry type: PROHIBITED, LIMITED, FULLY_LIMITED, DESCRIPTIVE, etc. */
  type: string;
}

export interface PolicySummary {
  approval_status: string;
  review_status: string;
  policy_topics: PolicyTopic[];
  /** True when the decision can be appealed (anything other than fully approved). */
  appealable: boolean;
}

export interface AdPolicy extends PolicySummary {
  level: 'ad';
  platform: string;
  ad_id: string;
  ad_group_id: string;
  ad_group_name: string;
  campaign_id: string;
  campaign_name: string;
}

export interface AssetPolicy extends PolicySummary {
  level: 'asset';
  platform: string;
  asset_id: string;
  asset_type: string;
  /** Where the asset is used, e.g. HEADLINE, DESCRIPTION, MARKETING_IMAGE, YOUTUBE_VIDEO. */
  field_type: string;
  ad_group_id: string;
  ad_group_name: string;
  campaign_id: string;
  campaign_name: string;
}

export type PolicyIssue = AdPolicy | AssetPolicy;

// ─── Google enum maps (proto numeric value → name) ──────────────────────────

// PolicyApprovalStatusEnum
const APPROVAL_STATUS: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'DISAPPROVED',
  3: 'APPROVED_LIMITED',
  4: 'APPROVED',
  5: 'AREA_OF_INTEREST_ONLY',
};

// PolicyReviewStatusEnum
const REVIEW_STATUS: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'REVIEW_IN_PROGRESS',
  3: 'REVIEWED',
  4: 'UNDER_APPEAL',
  5: 'ELIGIBLE_MAY_SERVE',
};

// PolicyTopicEntryTypeEnum
const TOPIC_ENTRY_TYPE: Record<number, string> = {
  0: 'UNSPECIFIED',
  1: 'UNKNOWN',
  2: 'PROHIBITED',
  3: 'LIMITED',
  4: 'FULLY_LIMITED',
  5: 'DESCRIPTIVE',
  6: 'BROADENING',
  7: 'AREA_OF_INTEREST_ONLY',
};

function normalizeEnum(value: unknown, map: Record<number, string>): string {
  if (typeof value === 'number') {
    return map[value] ?? `UNKNOWN(${value})`;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    // Already a name (some client versions return strings); upper-case for stability.
    return value.toUpperCase();
  }
  return 'UNSPECIFIED';
}

export function normalizeApprovalStatus(value: unknown): string {
  return normalizeEnum(value, APPROVAL_STATUS);
}

export function normalizeReviewStatus(value: unknown): string {
  return normalizeEnum(value, REVIEW_STATUS);
}

export function normalizeTopicType(value: unknown): string {
  return normalizeEnum(value, TOPIC_ENTRY_TYPE);
}

/** Returns true only for the fully-approved, unrestricted state. */
export function isApproved(approvalStatus: string): boolean {
  return approvalStatus === 'APPROVED';
}

/** Normalize a raw `policy_topic_entries` array into `{ topic, type }` records. */
export function normalizePolicyTopics(entries: unknown): PolicyTopic[] {
  if (!Array.isArray(entries)) return [];
  return entries.map((e) => {
    const entry = (e ?? {}) as Record<string, unknown>;
    return {
      topic: typeof entry['topic'] === 'string' ? entry['topic'] : String(entry['topic'] ?? ''),
      type: normalizeTopicType(entry['type']),
    };
  });
}

/**
 * Build a normalized PolicySummary from a raw Google `policy_summary` object.
 * Returns undefined when no policy data is present (e.g. resource has no summary).
 */
export function buildPolicySummary(raw: unknown): PolicySummary {
  const summary = (raw ?? {}) as Record<string, unknown>;
  const approval_status = normalizeApprovalStatus(summary['approval_status']);
  const review_status = normalizeReviewStatus(summary['review_status']);
  const policy_topics = normalizePolicyTopics(summary['policy_topic_entries']);
  return {
    approval_status,
    review_status,
    policy_topics,
    appealable: !isApproved(approval_status) && approval_status !== 'UNSPECIFIED',
  };
}
