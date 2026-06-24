# Design: `ads-mcp setup tiktok` re-auth command

**Date:** 2026-06-24
**Status:** Approved (design)
**Author:** brainstorming session

## Problem

The TikTok access tokens stored for all 7 advertiser accounts are **scope-limited**.
Live probing shows `advertiser/info` works but `campaign/get` returns TikTok error
`40001` ("the access token lacks the required scope"). Audience and conversion-event
endpoints are likewise unavailable. The tokens were minted before the app's ad-management
scopes were enabled, and TikTok tokens **cannot be refreshed programmatically**
(`src/adapters/tiktok/auth.ts` throws on refresh, by design). The code references an
`ads-mcp setup` command for re-auth, but no such command exists in the repo
(`package.json` has only `main`, no `bin`; no `cli.ts`).

This design adds that command, scoped to TikTok.

## Key constraint

TikTok API scopes are enabled at the **app level in the developer portal**, not
requested at authorize-time. No CLI flow can grant scopes by itself. The user must
enable the ad-management scopes on the app first; the command's job is to mint and
store a **fresh token that carries those scopes**.

## Decisions (from brainstorming)

- **Capture mechanism:** auth-code exchange flow (not paste-token, not localhost callback server).
- **Platform scope:** TikTok only. Meta and Google tokens currently work; extend later if needed.
- **App credentials:** `app_id` + `app_secret` from env (`TIKTOK_APP_ID` / `TIKTOK_APP_SECRET`)
  if set, else interactive prompt. Never persisted to disk.
- **auth_code capture:** manual paste (no localhost listener), robust regardless of the
  app's registered `redirect_uri`.

## Architecture

A new CLI entrypoint, separate from the MCP server:

- `package.json` → add `"bin": { "ads-mcp": "dist/cli.js" }`.
- `src/cli.ts` — thin arg dispatcher. `setup tiktok` is the only subcommand; unknown
  args print usage. Does **not** touch `src/index.ts` (the MCP stdio/HTTP server).
- `src/setup/tiktok-setup.ts` — the flow logic (unit-testable; `fetch`, keychain, prompt,
  and browser-opener injected/mocked at the boundary).

**Reused modules:**
- `utils/config.ts` — `loadConfig` (existing) + new `saveConfig` writer.
- `auth/keychain.ts` — `initKeychain`, `setSecret` (service `ads-mcp`, account key `tiktok:<accountName>`).
- `adapters/tiktok/auth.ts` — `tiktokApiUrl(path)` for endpoint construction.

## Flow

1. **Resolve app credentials** — `app_id` + `app_secret` from env or interactive prompt.
   Never written to disk.
2. **Print authorize URL** — `https://business-api.tiktok.com/portal/auth?app_id=<id>&state=<nonce>&redirect_uri=<uri>`
   and attempt to open it in the browser. Print a reminder to enable all ad scopes on
   the app in the portal first.
3. **Capture `auth_code`** — user authorizes, copies the `auth_code` query param from the
   redirect URL, pastes it at the prompt. No localhost listener.
4. **Exchange** — `POST /oauth2/access_token/` with `app_id`, `secret` (= app_secret),
   `auth_code`. On success returns `access_token` and the list of granted `advertiser_ids`.
5. **Map → store** — for each returned `advertiser_id`, match against existing `config.json`
   accounts (keyed by `advertiser_id`) and store the token in keychain under
   `tiktok:<accountName>`. Reuses the 7 existing named accounts; no config churn on the
   normal re-auth path.
6. **Unknown advertisers** — any granted `advertiser_id` not present in config is listed
   with a prompt to add it (short key + label → write account stanza to `config.json`) or skip.
7. **Verify** — after storing, call `campaign/get` once per stored account as a live scope
   check; print ✓/✗ per account so the user immediately knows whether the new token has
   campaign permission.

## Error handling

TikTok wraps responses in `{ code, message, data }`; `code: 0` = success.

- **Exchange failure** (bad/expired/used `auth_code`, wrong `app_secret`) → non-zero `code`;
  print the message verbatim plus the common cause ("auth_code is single-use and expires
  in ~10 min — re-run with a fresh one"). Exit non-zero.
- **Scopes still missing** — step-7 `campaign/get` probe returns `40001` → loud warning:
  "Token stored but campaign scope still missing — enable Campaign Management on the app
  in the portal, then re-run." (This is the exact gap found on 2026-06-24.)
- **Keychain write failure** (keytar unavailable) → abort before writing config; report
  which accounts did not store.
- **Network/timeout** → retry the exchange once, then fail with a clear message.
- **Partial success** — report per-account status. `config.json` is written **last**, only
  after all keychain writes succeed, so it is never left half-written.

## Edge cases

- `state` is a per-run nonce echoed back for a basic CSRF sanity check (warn-only on
  mismatch, since the redirect is pasted manually).
- An `advertiser_id` already in config keeps its existing key/label; the token is simply
  overwritten (the normal re-auth path).
- `--dry-run` flag: runs exchange + advertiser discovery + scope probe but **skips** all
  keychain/config writes, printing what would be stored.

## Testing

Vitest, colocated, mocked boundaries (matches repo convention; no live TikTok calls):

- `src/setup/tiktok-setup.test.ts` — mock `fetch`, keychain provider, prompt, browser-opener.
  Cases:
  - happy path (token + 7 advertisers → 7 keychain writes),
  - exchange error `code != 0`,
  - unknown-advertiser prompt path,
  - scope-probe `40001` warning,
  - partial keychain failure (config not written),
  - `--dry-run` writes nothing.
- `saveConfig` round-trip in `config.test.ts` (load → mutate → save → reload equals).

## Out of scope (YAGNI)

- Meta / Google setup commands.
- Token auto-refresh (TikTok cannot).
- Localhost callback server / GUI.

## Open implementation details to confirm against TikTok docs

- Exact `POST /oauth2/access_token/` request/response field names and the advertiser-list
  shape returned on exchange.
- Whether the authorize URL uses `redirect_uri` and how `state` is echoed.
- These are verified during implementation, not assumed.
