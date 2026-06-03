import { AdsError } from '../utils/errors.js';

let readOnlyEnabled = false;

export function setReadOnly(enabled: boolean): void {
  readOnlyEnabled = enabled;
}

export function isReadOnly(): boolean {
  return readOnlyEnabled;
}

export function enforceWritable(toolName: string): void {
  if (readOnlyEnabled) {
    throw new AdsError(
      'READ_ONLY_MODE',
      'safety',
      `Tool "${toolName}" cannot be used in read-only mode`,
      false,
    );
  }
}
