import { extractGoogleErrorMessage } from './client.js';

describe('extractGoogleErrorMessage', () => {
  it('extracts messages from a GoogleAdsFailure errors array', () => {
    const failure = {
      errors: [
        { error_code: { query_error: 32 }, message: "Unrecognized field in the query: 'x.y'." },
      ],
      '@type': 'type.googleapis.com/google.ads.googleads.v24.errors.GoogleAdsFailure',
    };
    expect(extractGoogleErrorMessage(failure)).toBe("Unrecognized field in the query: 'x.y'.");
  });

  it('joins multiple error messages', () => {
    const failure = { errors: [{ message: 'one' }, { message: 'two' }] };
    expect(extractGoogleErrorMessage(failure)).toBe('one; two');
  });

  it('uses a standard Error message', () => {
    expect(extractGoogleErrorMessage(new Error('boom'))).toBe('boom');
  });

  it('falls back to message field then JSON', () => {
    expect(extractGoogleErrorMessage({ message: 'plain' })).toBe('plain');
    expect(extractGoogleErrorMessage({ foo: 1 })).toBe('{"foo":1}');
  });

  it('never returns [object Object]', () => {
    expect(extractGoogleErrorMessage({ errors: [{ message: 'real reason' }] })).not.toContain('[object Object]');
  });
});
