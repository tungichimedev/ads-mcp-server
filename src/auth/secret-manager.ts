import type { KeychainProvider } from './keychain.js';

/**
 * Subset of SecretManagerServiceClient methods used by this provider.
 * Uses `any` for GCP response types to avoid coupling to their complex internal types.
 */
export interface SecretManagerClient {
  getProjectId(): Promise<string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  accessSecretVersion(request: { name: string }): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  addSecretVersion(request: { parent: string; payload: { data: Buffer } }): Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  createSecret(request: { parent: string; secretId: string; secret: Record<string, unknown> }): Promise<any>;
}

/** Converts keychain account keys (colon-separated) to Secret Manager IDs (double-dash). */
export function toSecretName(account: string): string {
  return account.replace(/:/g, '--');
}

export class SecretManagerKeychainProvider implements KeychainProvider {
  constructor(private readonly client: SecretManagerClient) {}

  async getPassword(_service: string, account: string): Promise<string | null> {
    const secretName = toSecretName(account);
    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/-/secrets/${secretName}/versions/latest`,
      });
      return version.payload?.data?.toString() ?? null;
    } catch (err: any) {
      if (err.code === 5) return null;
      throw err;
    }
  }

  async setPassword(_service: string, account: string, password: string): Promise<void> {
    const secretName = toSecretName(account);
    const projectId = await this.client.getProjectId();
    try {
      await this.client.addSecretVersion({
        parent: `projects/-/secrets/${secretName}`,
        payload: { data: Buffer.from(password) },
      });
    } catch (err: any) {
      if (err.code === 5) {
        // Secret doesn't exist — create it (requires explicit project ID), then add version
        await this.client.createSecret({
          parent: `projects/${projectId}`,
          secretId: secretName,
          secret: { replication: { automatic: {} } },
        });
        await this.client.addSecretVersion({
          parent: `projects/-/secrets/${secretName}`,
          payload: { data: Buffer.from(password) },
        });
        return;
      }
      throw err;
    }
  }
}
