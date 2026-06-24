import {
  normalizeApprovalStatus,
  normalizeReviewStatus,
  normalizeTopicType,
  normalizePolicyTopics,
  isApproved,
  buildPolicySummary,
} from './policy.js';

describe('policy enum normalization', () => {
  it('maps numeric approval status to names', () => {
    expect(normalizeApprovalStatus(2)).toBe('DISAPPROVED');
    expect(normalizeApprovalStatus(3)).toBe('APPROVED_LIMITED');
    expect(normalizeApprovalStatus(4)).toBe('APPROVED');
  });

  it('passes through string approval status (upper-cased)', () => {
    expect(normalizeApprovalStatus('disapproved')).toBe('DISAPPROVED');
    expect(normalizeApprovalStatus('APPROVED')).toBe('APPROVED');
  });

  it('falls back for unknown / empty values', () => {
    expect(normalizeApprovalStatus(99)).toBe('UNKNOWN(99)');
    expect(normalizeApprovalStatus(undefined)).toBe('UNSPECIFIED');
    expect(normalizeApprovalStatus('')).toBe('UNSPECIFIED');
  });

  it('maps review status', () => {
    expect(normalizeReviewStatus(2)).toBe('REVIEW_IN_PROGRESS');
    expect(normalizeReviewStatus(4)).toBe('UNDER_APPEAL');
  });

  it('maps topic entry type', () => {
    expect(normalizeTopicType(2)).toBe('PROHIBITED');
    expect(normalizeTopicType(3)).toBe('LIMITED');
    expect(normalizeTopicType(4)).toBe('FULLY_LIMITED');
  });
});

describe('isApproved', () => {
  it('is true only for APPROVED', () => {
    expect(isApproved('APPROVED')).toBe(true);
    expect(isApproved('APPROVED_LIMITED')).toBe(false);
    expect(isApproved('DISAPPROVED')).toBe(false);
  });
});

describe('normalizePolicyTopics', () => {
  it('normalizes entries with numeric types', () => {
    const topics = normalizePolicyTopics([
      { topic: 'Trademarks', type: 3 },
      { topic: 'Destination not working', type: 2 },
    ]);
    expect(topics).toEqual([
      { topic: 'Trademarks', type: 'LIMITED' },
      { topic: 'Destination not working', type: 'PROHIBITED' },
    ]);
  });

  it('returns [] for non-array input', () => {
    expect(normalizePolicyTopics(undefined)).toEqual([]);
    expect(normalizePolicyTopics(null)).toEqual([]);
  });
});

describe('buildPolicySummary', () => {
  it('builds a normalized summary and marks limited ads appealable', () => {
    const summary = buildPolicySummary({
      approval_status: 3, // APPROVED_LIMITED
      review_status: 3, // REVIEWED
      policy_topic_entries: [{ topic: 'Trademarks', type: 3 }],
    });
    expect(summary).toEqual({
      approval_status: 'APPROVED_LIMITED',
      review_status: 'REVIEWED',
      policy_topics: [{ topic: 'Trademarks', type: 'LIMITED' }],
      appealable: true,
    });
  });

  it('marks fully approved ads not appealable', () => {
    const summary = buildPolicySummary({ approval_status: 4, review_status: 5 });
    expect(summary.approval_status).toBe('APPROVED');
    expect(summary.appealable).toBe(false);
    expect(summary.policy_topics).toEqual([]);
  });

  it('handles missing policy data', () => {
    const summary = buildPolicySummary(undefined);
    expect(summary.approval_status).toBe('UNSPECIFIED');
    expect(summary.appealable).toBe(false);
  });
});
