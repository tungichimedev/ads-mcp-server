import { describe, it, expect } from 'vitest';
import { AdsError, isRetryable } from './errors.js';

describe('AdsError', () => {
  it('creates an instance with all fields populated', () => {
    const err = new AdsError(
      'AUTH_EXPIRED',
      'meta',
      'Token has expired',
      true,
      'OAuthException-190',
    );

    expect(err.code).toBe('AUTH_EXPIRED');
    expect(err.platform).toBe('meta');
    expect(err.message).toBe('Token has expired');
    expect(err.retryable).toBe(true);
    expect(err.platformErrorCode).toBe('OAuthException-190');
    expect(err.name).toBe('AdsError');
  });

  it('is an instance of Error', () => {
    const err = new AdsError('NOT_FOUND', 'google', 'Campaign not found', false);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(AdsError);
  });

  it('works without platformErrorCode (optional)', () => {
    const err = new AdsError('INVALID_PATH', 'tiktok', 'Bad path', false);
    expect(err.platformErrorCode).toBeUndefined();
  });

  it('toJSON returns all expected keys', () => {
    const err = new AdsError('BUDGET_EXCEEDED', 'meta', 'Over budget', false, 'ERR_123');
    const json = err.toJSON();

    expect(json).toEqual({
      code: 'BUDGET_EXCEEDED',
      platform: 'meta',
      platform_error_code: 'ERR_123',
      message: 'Over budget',
      retryable: false,
    });
  });

  it('toJSON includes platform_error_code as undefined when not provided', () => {
    const err = new AdsError('NOT_FOUND', 'google', 'Missing', false);
    const json = err.toJSON();
    expect(json.platform_error_code).toBeUndefined();
  });
});

describe('isRetryable', () => {
  it('returns true for RATE_LIMITED errors', () => {
    const err = new AdsError('RATE_LIMITED', 'meta', 'Too many requests', true);
    expect(isRetryable(err)).toBe(true);
  });

  it('returns false for BUDGET_EXCEEDED errors', () => {
    const err = new AdsError('BUDGET_EXCEEDED', 'meta', 'Campaign budget exceeded', false);
    expect(isRetryable(err)).toBe(false);
  });

  it('returns false for AUTH_EXPIRED', () => {
    const err = new AdsError('AUTH_EXPIRED', 'google', 'Token expired', false);
    expect(isRetryable(err)).toBe(false);
  });

  it('reflects the retryable flag set at construction', () => {
    const retryable = new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Temporary issue', true);
    const nonRetryable = new AdsError('ACCOUNT_ISSUE', 'tiktok', 'Permanent issue', false);
    expect(isRetryable(retryable)).toBe(true);
    expect(isRetryable(nonRetryable)).toBe(false);
  });
});
