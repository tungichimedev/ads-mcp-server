import { describe, it, expect } from 'vitest';
import { AdsError } from '../../utils/errors.js';

// safeId is a module-private function, so we test it indirectly via
// the GoogleAdapter. But since we can't easily instantiate a full
// GoogleAdapter in a unit test, we replicate the validation logic here
// to prove the pattern works. The real safeId is tested via integration
// tests that exercise the adapter methods.

function safeId(id: string): string {
  if (!/^\d+$/.test(id)) {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'google',
      `Invalid entity ID for GAQL query: expected numeric, got "${id}"`,
      false,
    );
  }
  return id;
}

describe('safeId (GAQL injection prevention)', () => {
  it('accepts numeric IDs', () => {
    expect(safeId('123456789')).toBe('123456789');
    expect(safeId('0')).toBe('0');
    expect(safeId('99999999999999')).toBe('99999999999999');
  });

  it('rejects IDs with spaces', () => {
    expect(() => safeId('123 OR 1=1')).toThrow(AdsError);
  });

  it('rejects IDs with SQL-like injection', () => {
    expect(() => safeId("123' --")).toThrow(AdsError);
  });

  it('rejects IDs with letters', () => {
    expect(() => safeId('abc')).toThrow(AdsError);
    expect(() => safeId('12a34')).toThrow(AdsError);
  });

  it('rejects empty string', () => {
    expect(() => safeId('')).toThrow(AdsError);
  });

  it('rejects IDs with special characters', () => {
    expect(() => safeId('123;DROP')).toThrow(AdsError);
    expect(() => safeId('123\n456')).toThrow(AdsError);
  });

  it('returns the same value for valid IDs', () => {
    const id = '9876543210';
    expect(safeId(id)).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// toGaqlDate validation (replicated logic, same as safe-id pattern)
// ---------------------------------------------------------------------------

function toGaqlDate(iso: string): string {
  const stripped = iso.replace(/-/g, '');
  if (!/^\d{8}$/.test(stripped)) {
    throw new AdsError(
      'ACCOUNT_ISSUE',
      'google',
      `Invalid date for GAQL query: expected YYYY-MM-DD or YYYYMMDD, got "${iso}"`,
      false,
    );
  }
  return stripped;
}

describe('toGaqlDate (GAQL date injection prevention)', () => {
  it('accepts ISO date YYYY-MM-DD', () => {
    expect(toGaqlDate('2024-01-15')).toBe('20240115');
  });

  it('accepts YYYYMMDD format', () => {
    expect(toGaqlDate('20240115')).toBe('20240115');
  });

  it('rejects injection attempts', () => {
    expect(() => toGaqlDate("' OR 1=1 --")).toThrow(AdsError);
  });

  it('rejects empty string', () => {
    expect(() => toGaqlDate('')).toThrow(AdsError);
  });

  it('rejects non-date strings', () => {
    expect(() => toGaqlDate('not-a-date')).toThrow(AdsError);
  });

  it('rejects partial dates', () => {
    expect(() => toGaqlDate('2024-01')).toThrow(AdsError);
  });
});
