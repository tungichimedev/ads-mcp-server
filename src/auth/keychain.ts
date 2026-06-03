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
 * Must be called once at startup before any getSecret / setSecret calls.
 */
export async function initKeychain(): Promise<void> {
  const keytar = await import('keytar');
  provider = {
    getPassword: (service, account) => keytar.default.getPassword(service, account),
    setPassword: (service, account, password) =>
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
