import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { validatePath, CREATIVE_EXTENSIONS, AUDIENCE_FILE_EXTENSIONS } from './path-guard.js';
import { AdsError } from '../utils/errors.js';

const ALLOWED_DIR = '/tmp/ads-mcp-test-allowed';

describe('validatePath', () => {
  it('accepts a valid path within the allowed directory', () => {
    const filePath = `${ALLOWED_DIR}/image.jpg`;
    const result = validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS);
    expect(result).toBe(resolve(filePath));
  });

  it('rejects a path outside the allowed directory', () => {
    const filePath = '/tmp/other-dir/image.jpg';
    expect(() => validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS)).toThrow(AdsError);
    expect(() => validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS)).toThrow(
      /outside the allowed directory/,
    );
  });

  it('rejects a path traversal (../)', () => {
    const filePath = `${ALLOWED_DIR}/../etc/passwd`;
    expect(() => validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS)).toThrow(AdsError);
    expect(() => validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS)).toThrow(
      /outside the allowed directory/,
    );
  });

  it('rejects a disallowed extension', () => {
    const filePath = `${ALLOWED_DIR}/script.sh`;
    expect(() => validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS)).toThrow(AdsError);
    expect(() => validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS)).toThrow(
      /not allowed/,
    );
  });

  it('throws AdsError with code INVALID_PATH for disallowed extension', () => {
    const filePath = `${ALLOWED_DIR}/data.xml`;
    try {
      validatePath(filePath, ALLOWED_DIR, AUDIENCE_FILE_EXTENSIONS);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdsError);
      expect((err as AdsError).code).toBe('INVALID_PATH');
    }
  });

  it('throws AdsError with code INVALID_PATH for path outside directory', () => {
    const filePath = '/etc/passwd';
    try {
      validatePath(filePath, ALLOWED_DIR, CREATIVE_EXTENSIONS);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AdsError);
      expect((err as AdsError).code).toBe('INVALID_PATH');
    }
  });

  it('accepts a .csv file with AUDIENCE_FILE_EXTENSIONS', () => {
    const filePath = `${ALLOWED_DIR}/audience.csv`;
    const result = validatePath(filePath, ALLOWED_DIR, AUDIENCE_FILE_EXTENSIONS);
    expect(result).toBe(resolve(filePath));
  });
});
