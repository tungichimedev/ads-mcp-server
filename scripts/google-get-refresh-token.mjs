#!/usr/bin/env node
// Generate a Google Ads API refresh token via the OAuth loopback flow.
//
//   node scripts/google-get-refresh-token.mjs
//
// Prereqs: an OAuth 2.0 Client ID of type "Desktop app" (Google Cloud Console
// → APIs & Services → Credentials). Desktop clients allow http://localhost
// redirects without pre-registration.
//
// Prints a refresh_token at the end — paste it into ./scripts/setup-local-google.sh
import http from 'node:http';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { google } from 'googleapis';

const SCOPE = 'https://www.googleapis.com/auth/adwords';
const PORT = 3001;
const REDIRECT = `http://localhost:${PORT}`;

const rl = readline.createInterface({ input: stdin, output: stdout });
const clientId = (await rl.question('OAuth Client ID: ')).trim();
const clientSecret = (await rl.question('OAuth Client Secret: ')).trim();
rl.close();

const oauth2 = new google.auth.OAuth2(clientId, clientSecret, REDIRECT);
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent', // force a refresh_token even on re-auth
  scope: [SCOPE],
});

console.log('\n1) Open this URL in your browser and approve access:\n');
console.log(authUrl);
console.log(`\n2) After approving you'll be redirected to ${REDIRECT} — this script is listening there.\n`);

const code = await new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, REDIRECT);
    const c = url.searchParams.get('code');
    const err = url.searchParams.get('error');
    res.end(c ? 'Authorization received. You can close this tab and return to the terminal.' : `Error: ${err || 'no code'}`);
    server.close();
    if (c) resolve(c); else reject(new Error(err || 'no code returned'));
  });
  server.listen(PORT);
});

const { tokens } = await oauth2.getToken(code);
if (!tokens.refresh_token) {
  console.error('\nNo refresh_token returned. Revoke prior access at https://myaccount.google.com/permissions and retry.');
  process.exit(1);
}
console.log('\n✅ refresh_token (copy this into setup-local-google.sh):\n');
console.log(tokens.refresh_token);
console.log();
