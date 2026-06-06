import type { KeychainProvider } from './keychain.js';

/** Converts keychain account keys (colon-separated) to Secret Manager IDs (double-dash). */
export function toSecretName(account: string): string {
  return account.replace(/:/g, '--');
}

export class SecretManagerKeychainProvider implements KeychainProvider {
  private projectId: string | null = null;

  constructor(private readonly client: any) {}

  private async getProjectId(): Promise<string> {
    if (!this.projectId) {
      this.projectId = await this.client.getProjectId();
    }
    return this.projectId!;
  }

  async getPassword(_service: string, account: string): Promise<string | null> {
    const projectId = await this.getProjectId();
    const secretName = toSecretName(account);
    try {
      const [version] = await this.client.accessSecretVersion({
        name: `projects/${projectId}/secrets/${secretName}/versions/latest`,
      });
      return version.payload?.data?.toString() ?? null;
    } catch (err: any) {
      if (err.code === 5) return null;
      throw err;
    }
  }

  async setPassword(_service: string, account: string, password: string): Promise<void> {
    const projectId = await this.getProjectId();
    const secretName = toSecretName(account);
    try {
      await this.client.addSecretVersion({
        parent: `projects/${projectId}/secrets/${secretName}`,
        payload: { data: Buffer.from(password) },
      });
    } catch (err: any) {
      if (err.code === 5) {
        await this.client.createSecret({
          parent: `projects/${projectId}`,
          secretId: secretName,
          secret: { replication: { automatic: {} } },
        });
        await this.client.addSecretVersion({
          parent: `projects/${projectId}/secrets/${secretName}`,
          payload: { data: Buffer.from(password) },
        });
        return;
      }
      throw err;
    }
  }
}
