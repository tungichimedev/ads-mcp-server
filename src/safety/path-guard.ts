import { resolve, extname } from 'node:path';
import { lstatSync } from 'node:fs';
import { AdsError } from '../utils/errors.js';

export const CREATIVE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.mp4', '.mov'];
export const AUDIENCE_FILE_EXTENSIONS = ['.csv'];

export function validatePath(
  filePath: string,
  allowedDirectory: string,
  allowedExtensions: string[],
): string {
  // Resolve to absolute path
  const resolved = resolve(filePath);
  const allowedResolved = resolve(allowedDirectory);

  // Check containment within allowedDirectory
  if (!resolved.startsWith(allowedResolved + '/') && resolved !== allowedResolved) {
    throw new AdsError(
      'INVALID_PATH',
      'safety',
      `Path "${filePath}" is outside the allowed directory "${allowedDirectory}"`,
      false,
    );
  }

  // Check for symlinks
  try {
    const stat = lstatSync(resolved);
    if (stat.isSymbolicLink()) {
      throw new AdsError(
        'INVALID_PATH',
        'safety',
        `Path "${filePath}" is a symbolic link, which is not allowed`,
        false,
      );
    }
  } catch (err: unknown) {
    if (err instanceof AdsError) {
      throw err;
    }
    // File doesn't exist yet — that's allowed (pre-write validation)
    const nodeErr = err as NodeJS.ErrnoException;
    if (nodeErr.code !== 'ENOENT') {
      throw new AdsError(
        'INVALID_PATH',
        'safety',
        `Cannot stat path "${filePath}": ${nodeErr.message}`,
        false,
      );
    }
  }

  // Check extension
  const ext = extname(resolved).toLowerCase();
  if (!allowedExtensions.includes(ext)) {
    throw new AdsError(
      'INVALID_PATH',
      'safety',
      `File extension "${ext}" is not allowed. Allowed: ${allowedExtensions.join(', ')}`,
      false,
    );
  }

  return resolved;
}
