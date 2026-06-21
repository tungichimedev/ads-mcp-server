#!/usr/bin/env node
// Non-interactive Google Ads refresh-token flow driven by a downloaded
// Desktop OAuth client JSON. Uses only Node built-ins + curl (no npm deps),
// since the local npm tree / proxy is unreliable.
//
//   node scripts/google-get-refresh-token-from-json.mjs <client_json> <out_file>
//
// Prints AUTH_URL=..., listens on http://localhost:3001 for the redirect,
// exchanges the code via curl, writes the refresh_token to <out_file>.
import http from 'node:http';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [clientJsonPath, outFile] = process.argv.slice(2);
if (!clientJsonPath || !outFile) {
  console.error('usage: <client_json> <out_file>');
  process.exit(2);
}

const raw = JSON.parse(readFileSync(clientJsonPath, 'utf8'));
const c = raw.installed || raw.web || raw;
const PORT = 3001;
const REDIRECT = `http://localhost:${PORT}`;
const SCOPE = 'https://www.googleapis.com/auth/adwords';

const authUrl =
  'https://accounts.google.com/o/oauth2/v2/auth?' +
  new URLSearchParams({
    client_id: c.client_id,
    redirect_uri: REDIRECT,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
  }).toString();

console.log('AUTH_URL=' + authUrl);
console.log('Listening on ' + REDIRECT + ' ...');

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REDIRECT);
  const code = url.searchParams.get('code');
  const err = url.searchParams.get('error');
  if (!code) {
    res.end('Error: ' + (err || 'no code'));
    return;
  }
  try {
    const body = new URLSearchParams({
      code,
      client_id: c.client_id,
      client_secret: c.client_secret,
      redirect_uri: REDIRECT,
      grant_type: 'authorization_code',
    }).toString();
    const out = execFileSync(
      'curl',
      ['-s', '-X', 'POST', 'https://oauth2.googleapis.com/token',
       '-H', 'Content-Type: application/x-www-form-urlencoded', '-d', body],
      { encoding: 'utf8' }
    );
    const tok = JSON.parse(out);
    if (!tok.refresh_token) {
      res.end('No refresh_token returned: ' + out);
      console.error('NO_REFRESH_TOKEN ' + out);
      server.close();
      process.exit(1);
    }
    writeFileSync(outFile, tok.refresh_token, { mode: 0o600 });
    res.end('Success! Refresh token captured. Close this tab and return to the terminal.');
    console.log('REFRESH_TOKEN_WRITTEN');
    server.close();
    process.exit(0);
  } catch (e) {
    res.end('Exchange failed: ' + e.message);
    console.error('EXCHANGE_FAILED ' + e.message);
    server.close();
    process.exit(1);
  }
});
server.listen(PORT);
