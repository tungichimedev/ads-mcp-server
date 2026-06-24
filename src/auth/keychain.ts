// ---------------------------------------------------------------------------
// KeychainProvider interface + keytar-backed implementation
// ---------------------------------------------------------------------------

export interface KeychainProvider {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
}

const SERVICE_NAME = 'ads-mcp';

let provider: KeychainProvider | null = null;

/**
 * Dynamically imports keytar and stores it as the active provider.
 * On Cloud Run (K_SERVICE env var set), uses Secret Manager instead.
 */
export async function initKeychain(): Promise<void> {
  if (process.env['K_SERVICE']) {
    // `as string` skips tsc module resolution — this is an optional dep only
    // present on Cloud Run (installed at deploy time, omitted from the image build).
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager' as string);
    const { SecretManagerKeychainProvider } = await import('./secret-manager.js');
    const client = new SecretManagerServiceClient();
    provider = new SecretManagerKeychainProvider(client);
    return;
  }

  // `as string` skips tsc module resolution — keytar is an optional dep,
  // omitted from the production image (Cloud Run uses Secret Manager instead).
  const keytar = await import('keytar' as string);
  provider = {
    getPassword: (service: string, account: string) => keytar.default.getPassword(service, account),
    setPassword: (service: string, account: string, password: string) =>
      keytar.default.setPassword(service, account, password),
  };
}

/**
 * Replaces the active provider — used in tests to inject a mock.
 */
export function setKeychainProvider(p: KeychainProvider): void {
  provider = p;
}

/**
 * Returns the active provider. Throws if not initialised.
 */
export function getKeychainProvider(): KeychainProvider {
  if (!provider) {
    throw new Error(
      'Keychain not initialised. Call initKeychain() or setKeychainProvider() first.',
    );
  }
  return provider;
}

/**
 * Retrieves a secret stored under SERVICE_NAME.
 */
export async function getSecret(key: string): Promise<string | null> {
  return getKeychainProvider().getPassword(SERVICE_NAME, key);
}

/**
 * Stores a secret under SERVICE_NAME.
 */
export async function setSecret(key: string, value: string): Promise<void> {
  return getKeychainProvider().setPassword(SERVICE_NAME, key, value);
}
