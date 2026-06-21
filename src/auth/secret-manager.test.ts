import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SecretManagerKeychainProvider, toSecretName } from './secret-manager.js';

describe('toSecretName', () => {
  it('converts colon-separated keys to double-dash', () => {
    expect(toSecretName('meta:my-account')).toBe('meta--my-account');
  });

  it('handles multiple colons', () => {
    expect(toSecretName('google:acct:expires')).toBe('google--acct--expires');
  });

  it('handles keys with no colons', () => {
    expect(toSecretName('simple')).toBe('simple');
  });
});

describe('SecretManagerKeychainProvider', () => {
  let mockClient: any;
  let provider: SecretManagerKeychainProvider;

  beforeEach(() => {
    mockClient = {
      getProjectId: vi.fn().mockResolvedValue('test-project'),
      accessSecretVersion: vi.fn(),
      addSecretVersion: vi.fn(),
      createSecret: vi.fn(),
    };
    provider = new SecretManagerKeychainProvider(mockClient);
  });

  it('getPassword returns secret value', async () => {
    mockClient.accessSecretVersion.mockResolvedValue([{
      payload: { data: Buffer.from('my-token') },
    }]);
    const result = await provider.getPassword('ads-mcp', 'meta:my-account');
    expect(result).toBe('my-token');
    expect(mockClient.accessSecretVersion).toHaveBeenCalledWith({
      name: 'projects/test-project/secrets/meta--my-account/versions/latest',
    });
  });

  it('getPassword returns null when secret not found', async () => {
    mockClient.accessSecretVersion.mockRejectedValue({ code: 5 });
    const result = await provider.getPassword('ads-mcp', 'meta:missing');
    expect(result).toBeNull();
  });

  it('getPassword re-throws non-NOT_FOUND errors', async () => {
    mockClient.accessSecretVersion.mockRejectedValue({ code: 7 });
    await expect(provider.getPassword('ads-mcp', 'x')).rejects.toEqual({ code: 7 });
  });

  it('setPassword creates or updates a secret version', async () => {
    mockClient.addSecretVersion.mockResolvedValue([{}]);
    await provider.setPassword('ads-mcp', 'meta:my-account', 'new-token');
    expect(mockClient.addSecretVersion).toHaveBeenCalledWith({
      parent: 'projects/test-project/secrets/meta--my-account',
      payload: { data: Buffer.from('new-token') },
    });
  });

  it('setPassword creates secret if addSecretVersion fails with NOT_FOUND', async () => {
    mockClient.addSecretVersion
      .mockRejectedValueOnce({ code: 5 })
      .mockResolvedValueOnce([{}]);
    mockClient.createSecret.mockResolvedValue([{}]);
    await provider.setPassword('ads-mcp', 'meta:new-account', 'token');
    expect(mockClient.createSecret).toHaveBeenCalledWith({
      parent: 'projects/test-project',
      secretId: 'meta--new-account',
      secret: { replication: { automatic: {} } },
    });
    expect(mockClient.addSecretVersion).toHaveBeenCalledTimes(2);
  });
});
