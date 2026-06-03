export type ErrorCode =
  | 'AUTH_EXPIRED'
  | 'RATE_LIMITED'
  | 'BUDGET_EXCEEDED'
  | 'ACCOUNT_SPEND_LIMIT'
  | 'CURRENCY_MISMATCH'
  | 'INVALID_TARGETING'
  | 'INVALID_BREAKDOWN'
  | 'CREATIVE_REJECTED'
  | 'ACCOUNT_ISSUE'
  | 'NOT_FOUND'
  | 'READ_ONLY_MODE'
  | 'INVALID_PATH'
  | 'CONFIRMATION_REQUIRED'
  | 'INVALID_STATUS_TRANSITION';

export class AdsError extends Error {
  constructor(
    public readonly code: ErrorCode,
    public readonly platform: string,
    message: string,
    public readonly retryable: boolean,
    public readonly platformErrorCode?: string,
  ) {
    super(message);
    this.name = 'AdsError';
  }

  toJSON() {
    return {
      code: this.code,
      platform: this.platform,
      platform_error_code: this.platformErrorCode,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export function isRetryable(err: AdsError): boolean {
  return err.retryable;
}
