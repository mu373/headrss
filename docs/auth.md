# Authentication

## Overview

HeadRSS uses a straightforward authentication model built around three ideas:

1. **App passwords.** Every client (Google Reader adapters, the Native API, and the CLI) authenticates with an app password. Each user creates one app password per device or client (e.g., "Reeder on iPhone", "CLI on server"), so any single credential can be revoked without affecting the others. A single `LocalAuthProvider` handles credential validation across every client-facing protocol.

2. **Stateless tokens.** After initial authentication, the server issues an HMAC-SHA256-signed token. Clients send this token on subsequent requests instead of re-sending the password, and the server can verify it without a session store.

3. **API keys for server-internal endpoints.** Server-facing routes (`/ingest/*` and `/admin/*`) use static API keys rather than app passwords. See [API Key Auth](#api-key-auth-ingest--admin) below.

Browser-based OIDC auth (e.g., Authorization Code + PKCE via Cognito) is deferred to post-v1. The `users.email` column is reserved for future OIDC user mapping but unused today.

## App Passwords

App passwords give each device or client its own credential. Because they are independent from one another, you can revoke access for a single device without disrupting any other client. They are stored in the `app_passwords` table, where each row contains:

| Column             | Purpose                                                   |
|--------------------|-----------------------------------------------------------|
| `id`               | Primary key, embedded in tokens as `app_password_id`      |
| `user_id`          | Owner                                                     |
| `label`            | Human-readable device name (e.g., "NetNewsWire on Mac")   |
| `password_hash`    | PBKDF2-SHA256 hash (legacy SHA-256 hashes also supported) |
| `password_version` | Monotonic counter; incremented on rotation                 |
| `last_used_at`     | Updated on each successful authentication                 |

Passwords are created and managed via the admin API (`headrss password add/list/rm`).

**Credential validation.** `LocalAuthProvider.validateCredentials` looks up the user by username, then iterates all of that user's active app passwords, comparing each hash using timing-safe comparison. On a match it updates `last_used_at` and returns `{ userId, appPasswordId, passwordVersion }`.

**Per-device revocation.** Deleting an app password immediately invalidates all tokens that were issued for that device, because token verification checks `password_version` against the live `app_passwords` row. If the row is gone, the check fails and the token is rejected. No token-revocation table is needed.

## Token Strategy

Tokens exist so that clients do not need to send their password on every request. After authenticating once with an app password, the client receives a signed token that can be verified cheaply on the server without any session state.

All tokens are signed with **HMAC-SHA256** using the Worker secret `TOKEN_KEY`. The implementation lives in `HmacTokenSigner` (`packages/worker/src/auth/hmac-token-signer.ts`). Tokens are base64url-encoded `payload.signature` strings, structurally similar to JWTs but simpler (no header segment).

### Auth Tokens (HMAC-SHA256)

| Property   | Value                    |
|------------|--------------------------|
| Algorithm  | HMAC-SHA256              |
| TTL        | **7 days** (604 800 s)   |
| Secret     | `TOKEN_KEY`              |
| Format     | `base64url(payload).base64url(signature)` |

The TTL was chosen to reduce re-authentication overhead while keeping tokens short-lived enough to limit exposure on compromise. The constant is `TOKEN_TTL = 604_800` in `packages/core/src/constants.ts`.

**Payload fields:**

```json
{
  "kind": "auth",
  "userId": 1,
  "appPasswordId": 3,
  "passwordVersion": 1,
  "exp": 1700000000
}
```

The `kind` discriminator distinguishes auth tokens from CSRF tokens.

**Verification flow (per request):**

1. Decode and verify HMAC signature (cheap, no I/O).
2. Check `exp` against current time.
3. One indexed DB lookup: confirm that `app_passwords` row `id = appPasswordId` still exists for the given `userId` and that `passwordVersion` matches.

Step 3 is the only database hit. It uses `getAppPasswordById`, which hits the primary key index. If the row was deleted (device revoked) or the version was bumped (password rotated), the token is rejected.

There is no `auth_tokens` table. Token validation is fully stateless aside from the single password-version check.

### CSRF Tokens

| Property   | Value                    |
|------------|--------------------------|
| Algorithm  | HMAC-SHA256              |
| TTL        | **7 days** (604 800 s)   |
| Secret     | `TOKEN_KEY` (same key)   |

CSRF tokens are required for Google Reader write operations (`edit-tag`, `subscription/edit`, `mark-all-as-read`, etc.). They are issued from `GET /reader/api/0/token` (requires auth) and passed back via the `T` header or form parameter on mutation requests.

**Payload:**

```json
{
  "kind": "csrf",
  "userId": 1,
  "exp": 1700000000
}
```

CSRF tokens are **reusable within their TTL window**. They are not stored in the database; verification is signature + expiry only. GReader clients reuse `T` tokens across multiple mutations within a session, and single-use tokens would force unnecessary round-trips and break client expectations.

`CSRF_TTL` equals `TOKEN_TTL` (both 604 800 seconds). See `packages/core/src/constants.ts`.

## Auth Flows

HeadRSS supports three authentication flows, one for each API surface: Google Reader ClientLogin for RSS reader apps, a JSON token exchange for the Native API, and static API keys for server-internal endpoints.

### Google Reader ClientLogin

**Endpoint:** `POST /api/google/accounts/ClientLogin` (also accepts `GET` for FeedMe compatibility)

**Request** (form-encoded or query params):

| Parameter | Description         |
|-----------|---------------------|
| `Email`   | Username            |
| `Passwd`  | App password        |

**Success response** (200, `text/plain`):

```
SID=<token>
LSID=<token>
Auth=<token>
```

All three values are the same signed auth token. RSS clients use the `Auth` value in subsequent requests via the `Authorization: GoogleLogin auth=<token>` header.

**Failure response:** `401 Unauthorized` (plain text). Failed attempts increment the rate limit counter.

**Token refresh:** When a token expires or is revoked, the middleware returns `401` with the header `Google-Bad-Token: true`. Compliant GReader clients interpret this as a signal to silently re-authenticate via ClientLogin without prompting the user.

Implementation: `packages/adapter/greader/src/auth.ts`

### Native API Token Exchange

**Endpoint:** `POST /api/native/v0/auth/token`

**Request** (`application/json`):

```json
{
  "username": "alice",
  "password": "app-password-value"
}
```

**Success response** (200):

```json
{
  "token": "<signed-token>",
  "tokenType": "Bearer",
  "expiresIn": 604800
}
```

Subsequent requests use `Authorization: Bearer <token>`. The middleware (`createAuthMiddleware`) verifies the token identically to the GReader flow: signature + expiry, then a password-version DB check.

The CLI caches the token locally after `headrss login` and re-uses it until expiry, avoiding re-authentication on every invocation.

Implementation: `packages/adapter/api/src/auth.ts`

### API Key Auth (Ingest / Admin)

Server-facing endpoints use static API keys passed as `Authorization: Bearer <key>`. Three separate secrets provide scoped access:

| Secret           | Scope                                                       |
|------------------|-------------------------------------------------------------|
| `INGEST_API_KEY` | Full access to `/ingest/*`                                  |
| `FETCH_API_KEY`  | Read-only access to `GET /admin/feeds`, `GET /admin/feeds/due`, `GET /admin/feeds/:id/credentials` |
| `ADMIN_API_KEY`  | Full access to `/admin/*`                                   |

The ingest middleware (`apiKeyAuth`) does a direct string comparison against `INGEST_API_KEY`. The admin middleware (`scopedAdminAuth`) checks whether the provided key matches `ADMIN_API_KEY` (full access) or `FETCH_API_KEY` (GET-only on feed-related routes). Non-matching keys receive `403 Forbidden`.

`FETCH_API_KEY` exists so the CLI fetcher can pull the feed list and per-feed credentials without having full admin privileges.

Implementation: `packages/worker/src/ingest.ts` (apiKeyAuth), `packages/worker/src/admin.ts` (scopedAdminAuth)

## Rate Limiting

Auth endpoints are rate-limited to mitigate brute-force attacks on app passwords.

| Parameter      | Value                         |
|----------------|-------------------------------|
| Max attempts   | 5 per IP per window           |
| Window         | 15 minutes (900 s)            |
| Response       | `429 Too Many Requests`       |
| Header         | `Retry-After: 900`            |

**Applies to:** `POST /api/google/accounts/ClientLogin` (and its GET variant) and `POST /api/native/v0/auth/token`.

**Implementation:** A D1 counter table `rate_limits` with columns `(ip, endpoint, window_start, attempts)`. On each failed authentication:

1. Read the current counter for the IP + endpoint.
2. If `window_start` is within the current 15-minute window and `attempts >= 5`, return 429 immediately.
3. Otherwise, increment (or upsert) the counter.

Successful authentications do not count against the limit. On success, the counter is reset via `resetRateLimit`.

Stale rows older than 15 minutes are cleaned up during the periodic purge cycle (`headrss feed purge`).

Constants: `RATE_LIMIT_MAX_ATTEMPTS = 5`, `RATE_LIMIT_WINDOW_SECONDS = 900` in `packages/core/src/constants.ts`.

## Feed Credentials

Some RSS feeds require authentication to access, such as paywalled or private sources. HeadRSS supports storing per-feed credentials so the fetcher can authenticate when pulling these feeds.

Credentials are stored in the `feed_credentials` table, **encrypted at rest** using AES-GCM with the Worker secret `CREDENTIAL_KEY`.

**Supported auth types:**

- Basic Auth (username + password)
- Bearer token
- Custom headers (arbitrary key-value pairs)

**Constraints:** One credential per feed. If a feed requires different credentials, it should be registered as a separate feed URL.

**Access pattern:** The CLI fetcher retrieves decrypted credentials via `GET /admin/feeds/:id/credentials` using `FETCH_API_KEY` (read-only scope). The Worker holds `CREDENTIAL_KEY` and decrypts server-side before returning the response. Credentials are never exposed in any client-facing API (`/api/*`).

Implementation: `packages/core/src/ports/credential-store.ts` (interface), `packages/adapter/d1/src/d1-credential-store.ts` (D1 implementation)
