#!/usr/bin/env node
// ads-mcp CLI — setup / re-auth commands (separate entrypoint from the MCP server)
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { exec } from 'node:child_process';
import { initKeychain } from './auth/keychain.js';
import { runTikTokSetup, defaultDeps } from './setup/tiktok-setup.js';

const USAGE = `ads-mcp — setup commands

Usage:
  ads-mcp setup tiktok [--dry-run] [--redirect-uri <uri>]

Environment:
  ADS_MCP_HOME        Config home (default ~/.ads-mcp)
  TIKTOK_APP_ID       TikTok app id   (else prompted)
  TIKTOK_APP_SECRET   TikTok app secret (else prompted)
`;

async function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function openBrowser(url: string): Promise<void> {
  const cmd =
    process.platform === 'darwin' ? 'open' :
    process.platform === 'win32' ? 'start ""' : 'xdg-open';
  await new Promise<void>((resolve) => {
    exec(`${cmd} "${url}"`, () => resolve()); // best-effort; ignore failures
  });
}

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [command, platform] = args;

  if (command !== 'setup' || platform !== 'tiktok') {
    process.stdout.write(USAGE);
    process.exit(command === 'setup' ? 1 : 0);
  }

  await initKeychain();

  const basePath = process.env['ADS_MCP_HOME'] ?? join(homedir(), '.ads-mcp');
  const dryRun = args.includes('--dry-run');
  const redirectUri = getFlag(args, '--redirect-uri') ?? 'https://business-api.tiktok.com/portal/auth/callback';

  await runTikTokSetup(defaultDeps(prompt, openBrowser), {
    basePath,
    dryRun,
    redirectUri,
    state: randomUUID(),
  });
}

main().catch((err: unknown) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
