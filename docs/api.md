# API Reference

## Overview

HeadRSS exposes four API surfaces, each with its own path prefix, authentication method, and intended audience:

| API | Path Prefix | Auth Method | Audience |
|---|---|---|---|
| Google Reader | `/api/google` | App password token (`GoogleLogin auth=TOKEN`) | RSS clients (Reeder, NetNewsWire, etc.) |
| Native | `/api/native/v0` | Bearer token (`Authorization: Bearer TOKEN`) | CLI, web frontend |
| Ingest | `/ingest` | API key (`Authorization: Bearer INGEST_API_KEY`) | Feed fetcher |
| Admin | `/admin` | Scoped API key (`Authorization: Bearer KEY`) | CLI admin commands, fetcher |

The Google Reader API provides compatibility with existing RSS reader clients. The Native API provides a clean REST interface for first-party integrations such as the CLI and web frontend. The Ingest and Admin APIs are internal, used by the feed fetcher and administrative tooling respectively.

An OpenAPI 3.1 spec for the Native API is available at `GET /api/openapi.json`. Interactive documentation is served via Swagger UI at `GET /api/docs`.

See [auth.md](auth.md) for detailed authentication and token lifecycle documentation.

### Fetch-on-Subscribe

When a user subscribes to a new feed (via either the Google Reader or Native API), the Worker performs an inline fetch so items appear immediately rather than waiting for the next CLI fetch cycle.

This only triggers when the feed is newly created (never fetched before: `lastFetchedAt === null && fetchErrorCount === 0`). The Worker fetches and parses the feed directly, ingests the items, and passes the work to `executionCtx.waitUntil()` so the subscribe response returns immediately.

This is a best-effort operation. On failure, it sets `fetchErrorCount = 1` and `nextFetchAt = now + 900s`. The CLI fetcher will recover on its next scheduled run.

---

## Google Reader API (`/api/google`)

Implements the Google Reader protocol so that existing RSS reader clients (Reeder, NetNewsWire, ReadKit, and others) can connect to HeadRSS without any special integration work. The base URL for client configuration is `https://<host>/api/google`.

### Auth Endpoints

These endpoints are unauthenticated.

| Method | Path | Description |
|---|---|---|
| POST | `/accounts/ClientLogin` | Exchange app password for auth token |
| GET | `/accounts/ClientLogin` | Same (GET accepted for client compatibility) |

**Request** (form-encoded or query params):

| Parameter | Required | Description |
|---|---|---|
| `Email` | Yes | Username |
| `Passwd` | Yes | App password |

**Response** (200, plain text):

```
SID=<token>
LSID=<token>
Auth=<token>
```

All three values are the same HMAC-SHA256 signed token (7-day TTL). Rate-limited: after repeated failures, returns 429 with `Retry-After` header.

### Read Endpoints

All read endpoints require `Authorization: GoogleLogin auth=TOKEN`.

| Method | Path | Description |
|---|---|---|
| GET | `/reader/api/0/token` | Get a short-lived CSRF token (required for write operations) |
| GET | `/reader/api/0/user-info` | Current user profile |
| GET | `/reader/api/0/subscription/list` | List subscriptions with folder assignments |
| GET | `/reader/api/0/subscription/export` | Export subscriptions as OPML |
| GET | `/reader/api/0/tag/list` | List tags (states + user labels) |
| GET | `/reader/api/0/unread-count` | Unread counts per stream |
| GET, POST | `/reader/api/0/stream/items/ids` | List entry IDs for a stream (paginated) |
| GET, POST | `/reader/api/0/stream/items/contents` | Fetch full entries by ID |
| GET | `/reader/api/0/stream/contents` | List full entries for a stream (paginated) |
| GET | `/reader/api/0/stream/contents/*` | Same, with stream ID as path suffix |

**`user-info` response:**

```json
{
  "userId": "1",
  "userName": "alice",
  "userProfileId": "1",
  "userEmail": "alice@example.com",
  "isBloggerUser": false,
  "signupTimeSec": 1700000000,
  "isMultiLoginEnabled": false
}
```

**`subscription/list` response:**

```json
{
  "subscriptions": [
    {
      "id": "feed/https://example.com/feed.xml",
      "title": "Example Feed",
      "categories": [{"id": "user/-/label/Tech", "label": "Tech"}],
      "url": "https://example.com/feed.xml",
      "htmlUrl": "https://example.com",
      "iconUrl": "https://example.com/favicon.ico",
      "firstitemmsec": "1700000000000",
      "sortid": "0000000000000001"
    }
  ]
}
```

**`tag/list` response:**

Returns built-in state tags followed by user labels:

```json
{
  "tags": [
    {"id": "user/-/state/com.google/reading-list", "sortid": "0000000000000001", "type": "state"},
    {"id": "user/-/state/com.google/read", "sortid": "0000000000000002", "type": "state"},
    {"id": "user/-/state/com.google/starred", "sortid": "0000000000000003", "type": "state"},
    {"id": "user/-/label/Tech", "sortid": "0000000000000004", "type": "label"}
  ]
}
```

**`unread-count` response:**

```json
{
  "unreadcounts": [
    {"id": "feed/https://example.com/feed.xml", "count": 5, "newestItemTimestampUsec": "1700000000000000"}
  ]
}
```

**`stream/items/ids` response:**

```json
{
  "itemRefs": [
    {"id": "42", "directStreamIds": ["feed/https://example.com/feed.xml"], "timestampUsec": "1700000000000000"}
  ],
  "continuation": "MTcwMDAwMDAwMDo0Mg=="
}
```

**`stream/items/contents` request:**

Pass item IDs via repeated `i` parameter (query string or form body). Accepts both long form (`tag:google.com,2005:reader/item/<16-char-hex>`) and short form (decimal number) IDs.

**`stream/contents` response:**

```json
{
  "id": "feed/https://example.com/feed.xml",
  "updated": 1700000000,
  "items": [
    {
      "id": "tag:google.com,2005:reader/item/000000000000002a",
      "crawlTimeMsec": "1700000000000",
      "timestampUsec": "1700000000000000",
      "categories": ["user/-/state/com.google/reading-list", "user/-/label/Tech"],
      "title": "Article Title",
      "published": 1700000000,
      "updated": 1700000000,
      "author": "Author Name",
      "origin": {
        "streamId": "feed/https://example.com/feed.xml",
        "title": "Example Feed",
        "htmlUrl": "https://example.com"
      },
      "canonical": [{"href": "https://example.com/article"}],
      "alternate": [{"href": "https://example.com/article", "type": "text/html"}],
      "summary": {"direction": "ltr", "content": "<p>Article content...</p>"}
    }
  ],
  "continuation": "MTcwMDAwMDAwMDo0Mg=="
}
```

### Stream Query Parameters

Used by `stream/items/ids`, `stream/contents`, and `stream/contents/*`:

| Param | Type | Default | Description |
|---|---|---|---|
| `s` | string | (required) | Stream ID: `feed/<URL>`, `user/-/state/com.google/reading-list`, `user/-/state/com.google/starred`, `user/-/label/<NAME>` |
| `n` | integer | 20 | Number of items per page (max 200) |
| `ot` | integer | - | Oldest timestamp (UNIX seconds): items published at or after this time |
| `nt` | integer | - | Newest timestamp (UNIX seconds): items published at or before this time |
| `c` | string | - | Continuation token from a previous response |
| `xt` | string | - | Exclude tag (e.g., `user/-/state/com.google/read` for unread only) |
| `it` | string | - | Include tag: filter to items matching this tag |
| `r` | string | newest-first | Sort order: `o` for oldest-first; omit or any other value for newest-first |

### Continuation Tokens

Continuation tokens are opaque base64-encoded strings encoding a `published_at:id` pair. They enable keyset pagination that remains stable even when items share the same `published_at` value.

When a response includes a `continuation` field, pass it back as the `c` parameter to fetch the next page.

### Write Endpoints

All write endpoints require both the auth token (`Authorization: GoogleLogin auth=TOKEN`) and a CSRF token. Obtain a CSRF token from `GET /reader/api/0/token` and pass it as either:
- An HTTP header: `T: <csrf-token>`
- A form/query parameter: `T=<csrf-token>`

| Method | Path | Parameters | Description |
|---|---|---|---|
| POST | `/reader/api/0/edit-tag` | `i` (item IDs, repeatable), `a` (add tags), `r` (remove tags) | Add/remove tags on entries (read, starred, labels) |
| POST | `/reader/api/0/subscription/edit` | `ac` (action), `s` (stream ID), `t` (title), `a` (add tags), `r` (remove tags) | Subscribe/unsubscribe/edit subscription |
| POST | `/reader/api/0/subscription/quickadd` | `quickadd` (feed URL) | Quick-subscribe to a feed URL |
| POST | `/reader/api/0/mark-all-as-read` | `s` (stream ID), `ts` (timestamp in microseconds, optional) | Mark all entries in a stream as read |
| POST | `/reader/api/0/rename-tag` | `s` (source tag), `dest` (destination tag) | Rename a label |
| POST | `/reader/api/0/disable-tag` | `s` (tag to delete) | Delete a label (removes from subscriptions and entries) |

**`subscription/edit` actions (`ac` parameter):**

| Action | Description |
|---|---|
| `subscribe` | Subscribe to `s` (a `feed/<URL>` stream ID). Optionally set title with `t`, assign folders with `a`. Supports embedded credentials in URL. |
| `unsubscribe` | Unsubscribe from `s` |
| `edit` | Update title (`t`) and/or folder assignments (`a`/`r`) for an existing subscription |

**`quickadd` response:**

```json
{
  "query": "https://example.com/feed.xml",
  "numResults": 1,
  "streamId": "feed/https://example.com/feed.xml",
  "streamName": "https://example.com/feed.xml"
}
```

**401 responses:** Protected-route 401 responses (expired or revoked tokens) include the `Google-Bad-Token: true` header, which RSS clients use to trigger silent re-authentication. ClientLogin failures return plain-text `401 Unauthorized` without this header.

### Static Stubs

Fixed responses required by RSS reader clients. All require auth except `/health`.

| Method | Path | Response |
|---|---|---|
| GET | `/reader/ping` | `OK` (plain text) |
| GET | `/reader/api/0/preference/list` | `{"prefs": {}}` |
| GET | `/reader/api/0/preference/stream/list` | `{"streamprefs": {}}` |
| GET | `/reader/api/0/friend/list` | `{"friends": []}` |

---

## Native API (`/api/native/v0`)

The Native API is a clean REST API with JSON request/response bodies, designed for first-party clients such as the CLI and future web frontend. All endpoints return JSON. Request/response validation is enforced via Zod schemas with auto-generated OpenAPI documentation.

### Auth

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/token` | None | Exchange credentials for a bearer token |

**Request:**

```json
{
  "username": "alice",
  "password": "hrss_abc123..."
}
```

**Response (200):**

```json
{
  "token": "<signed-token>",
  "tokenType": "Bearer",
  "expiresIn": 604800
}
```

Rate-limited: returns 429 with `Retry-After` header after repeated failures.

All other Native API endpoints require `Authorization: Bearer <token>`.

### Subscriptions

| Method | Path | Description |
|---|---|---|
| GET | `/subscriptions` | List user's subscriptions |
| POST | `/subscriptions` | Subscribe to a feed |
| PUT | `/subscriptions/{id}` | Update subscription (title, folder) |
| DELETE | `/subscriptions/{id}` | Unsubscribe |
| POST | `/subscriptions/{id}/mark-all-read` | Mark all entries as read |
| GET | `/subscriptions/export` | Export subscriptions as OPML |
| POST | `/subscriptions/import` | Import subscriptions from OPML |

**Create subscription request:**

```json
{
  "url": "https://example.com/feed.xml",
  "title": "Custom Title",
  "folder": 1
}
```

`title` and `folder` are optional. Set `folder` to `null` to remove from all folders.

**Update subscription request:**

```json
{
  "title": "New Title",
  "folder": 2
}
```

At least one of `title` or `folder` is required.

**Mark-all-read request (optional body):**

```json
{
  "before": 1700000000
}
```

The `before` field is a UNIX timestamp in seconds. If omitted, all entries are marked read.

**Subscription response shape:**

```json
{
  "id": 1,
  "feedId": 1,
  "title": "Custom Title",
  "readCursorItemId": 42,
  "feed": {
    "id": 1,
    "url": "https://example.com/feed.xml",
    "title": "Example Feed",
    "siteUrl": "https://example.com",
    "faviconUrl": "https://example.com/favicon.ico",
    "etag": null,
    "lastModified": null,
    "lastFetchedAt": 1700000000,
    "fetchErrorCount": 0,
    "nextFetchAt": 1700003600,
    "createdAt": 1700000000,
    "updatedAt": 1700000000
  },
  "folders": [
    {"id": 1, "userId": 1, "name": "Tech"}
  ]
}
```

**Export response:** Returns OPML XML with `Content-Type: text/x-opml; charset=utf-8` and `Content-Disposition: attachment` header.

**Import request:** Raw OPML XML as the request body (`Content-Type: text/plain` or similar).

**Import response:**

```json
{
  "imported": 15,
  "total": 15
}
```

### Folders

Folders and labels share the same underlying `labels` table. The `/folders` endpoint presents the subscription-assignment view.

| Method | Path | Description |
|---|---|---|
| GET | `/folders` | List user's folders |
| POST | `/folders` | Create a folder (reuses existing if name matches) |
| PUT | `/folders/{id}` | Rename a folder |
| DELETE | `/folders/{id}` | Delete a folder (unassigns from subscriptions) |

**Create/rename request:**

```json
{
  "name": "Technology"
}
```

**Folder response shape:**

```json
{
  "id": 1,
  "userId": 1,
  "name": "Technology"
}
```

### Entries

| Method | Path | Description |
|---|---|---|
| GET | `/entries` | List entries (paginated, filterable) |
| GET | `/entries/{id}` | Get a single entry by public ID |
| PUT | `/entries/{id}` | Update entry state (read, starred, labels) |

**List entries query parameters:**

| Param | Type | Default | Description |
|---|---|---|---|
| `feed` | integer | - | Filter by feed ID |
| `folder` | integer | - | Filter by folder ID (mutually exclusive with `feed`) |
| `label` | integer | - | Filter by item label ID |
| `starred` | boolean | - | Filter to starred entries |
| `unread` | boolean | - | Filter to unread entries |
| `limit` | integer | 20 | Items per page (max 200) |
| `continuation` | string | - | Continuation token in `publishedAt:id` format |

**Update entry request:**

```json
{
  "read": true,
  "starred": false,
  "labels": [1, 3]
}
```

At least one of `read`, `starred`, or `labels` is required. The `labels` field is a complete replacement: it sets the exact set of labels for the entry.

**Entry response shape:**

```json
{
  "id": "abc123DEF456ghijklmnop",
  "feedId": 1,
  "guid": "https://example.com/article-1",
  "title": "Article Title",
  "url": "https://example.com/article-1",
  "author": "Author Name",
  "content": "<p>Full article content...</p>",
  "summary": "Brief summary...",
  "publishedAt": 1700000000,
  "crawlTimeMs": 150,
  "createdAt": 1700000000,
  "state": {
    "isRead": false,
    "isStarred": true,
    "starredAt": 1700001000
  },
  "labels": [
    {"id": 1, "userId": 1, "name": "Important"}
  ]
}
```

**List entries response:**

```json
{
  "items": [...],
  "continuation": "1700000000:42"
}
```

Continuation tokens in the Native API use the plain `publishedAt:id` format (not base64-encoded like the Google Reader API).

### Labels

Item labels (distinct from folders in the UI, but backed by the same `labels` table).

| Method | Path | Description |
|---|---|---|
| GET | `/labels` | List user's labels |
| POST | `/labels` | Create a label (reuses existing if name matches) |
| DELETE | `/labels/{id}` | Delete a label (removes from all entries) |

**Create label request:**

```json
{
  "name": "Important"
}
```

---

## Ingest API (`/ingest`)

The Ingest API is a server-to-server interface used by the CLI feed fetcher to push parsed feed data into HeadRSS for storage. The fetcher polls RSS/Atom feeds on a schedule, parses the entries, and sends them to this API. Authenticated with `Authorization: Bearer <INGEST_API_KEY>`.

### Push Items

| Method | Path | Description |
|---|---|---|
| POST | `/feeds/:feedId/items` | Push entries for a feed |

**Request:** `Content-Type: application/json`

```json
[
  {
    "guid": "https://example.com/article-1",
    "title": "Article Title",
    "url": "https://example.com/article-1",
    "author": "Author Name",
    "content": "<p>Full content...</p>",
    "summary": "Brief summary...",
    "publishedAt": 1700000000
  }
]
```

| Field | Type | Required | Description |
|---|---|---|---|
| `guid` | string | Yes | Unique identifier for the entry within the feed |
| `title` | string or null | No | Entry title |
| `url` | string or null | No | Entry URL |
| `author` | string or null | No | Entry author |
| `content` | string or null | No | Full HTML content |
| `summary` | string or null | No | Plain text or short HTML summary |
| `publishedAt` | integer | Yes | Publication timestamp (UNIX seconds) |

Items are processed in batches of up to 40. Ingestion is idempotent: duplicate `guid` values within the same feed are silently skipped.

**Response (200), returned when all batches succeed:**

```json
{
  "inserted": 5,
  "skipped": 2
}
```

**Response (207), returned on partial success:**

```json
{
  "inserted": 3,
  "skipped": 1,
  "failedBatches": [
    {"index": 1, "size": 40, "error": "Batch ingest failed."}
  ]
}
```

**Response (404), returned when the feed is not found:**

```json
{
  "error": "Feed 42 was not found."
}
```

### Update Feed Metadata

After fetching a feed, the fetcher can update the feed's metadata and scheduling state through this endpoint.

| Method | Path | Description |
|---|---|---|
| PUT | `/feeds/:feedId` | Update feed metadata and fetch state |

**Request:** `Content-Type: application/json`

```json
{
  "title": "Example Feed",
  "siteUrl": "https://example.com",
  "faviconUrl": "https://example.com/favicon.ico",
  "etag": "\"abc123\"",
  "lastModified": "Sat, 01 Jan 2024 00:00:00 GMT",
  "lastFetchedAt": 1700000000,
  "fetchErrorCount": 0,
  "nextFetchAt": 1700003600
}
```

All fields are optional. Only provided fields are updated.

| Field | Type | Description |
|---|---|---|
| `title` | string or null | Feed title |
| `siteUrl` | string or null | Feed's website URL |
| `faviconUrl` | string or null | Favicon URL |
| `etag` | string or null | HTTP ETag for conditional fetching |
| `lastModified` | string or null | HTTP Last-Modified header value |
| `lastFetchedAt` | integer or null | Last successful fetch timestamp (UNIX seconds) |
| `fetchErrorCount` | integer | Consecutive fetch failure count |
| `nextFetchAt` | integer or null | Earliest next fetch timestamp (UNIX seconds) |

**Response (200):** Returns the full updated feed object.

---

## Admin API (`/admin`)

The Admin API provides system-level management operations for feeds, users, app passwords, and maintenance tasks. It is used by CLI admin commands and the feed fetcher. Authenticated with `Authorization: Bearer <KEY>`. Two API keys provide scoped access:

| Key | Scope | Allowed Operations |
|---|---|---|
| `FETCH_API_KEY` | Read-only | `GET /feeds`, `GET /feeds/due`, `GET /feeds/:id/credentials` |
| `ADMIN_API_KEY` | Full access | All `/admin` endpoints |

### Feeds

These endpoints manage the global feed registry. The fetcher uses the read-only endpoints to discover which feeds are due for polling, while admin commands can create, update, and delete feeds.

| Method | Path | Auth Scope | Description |
|---|---|---|---|
| GET | `/feeds` | FETCH or ADMIN | List all feeds (paginated) |
| GET | `/feeds/due` | FETCH or ADMIN | List feeds due for fetching |
| POST | `/feeds` | ADMIN | Create a feed |
| PUT | `/feeds/:id` | ADMIN | Update a feed |
| DELETE | `/feeds/:id` | ADMIN | Delete a feed (cascades to items, subscriptions) |

**Pagination query parameters** (used by GET list endpoints):

| Param | Type | Default | Description |
|---|---|---|---|
| `limit` | integer | 100 | Items per page (max 500) |
| `offset` | integer | 0 | Number of items to skip |

**Feed response shape:**

```json
{
  "id": 1,
  "url": "https://example.com/feed.xml",
  "title": "Example Feed",
  "site_url": "https://example.com",
  "favicon_url": "https://example.com/favicon.ico",
  "etag": "\"abc123\"",
  "last_modified": "Sat, 01 Jan 2024 00:00:00 GMT",
  "last_fetched_at": 1700000000,
  "fetch_error_count": 0,
  "next_fetch_at": 1700003600,
  "created_at": 1700000000,
  "updated_at": 1700000000,
  "has_credentials": false
}
```

**Create feed request:**

```json
{
  "url": "https://example.com/feed.xml",
  "title": "Example Feed",
  "site_url": "https://example.com"
}
```

Only `url` is required. All other fields are optional. Returns 201 on success.

**Update feed request:**

```json
{
  "title": "Updated Title",
  "next_fetch_at": 1700003600
}
```

At least one field is required.

**List response shape:**

```json
{
  "items": [...],
  "limit": 100,
  "offset": 0
}
```

### Users

| Method | Path | Description |
|---|---|---|
| GET | `/users` | List users (paginated) |
| POST | `/users` | Create a user |
| PUT | `/users/:id` | Update a user |
| DELETE | `/users/:id` | Delete a user (cascades to subscriptions, states, passwords) |

**Create user request:**

```json
{
  "username": "alice",
  "email": "alice@example.com"
}
```

`email` is optional (nullable).

**User response shape:**

```json
{
  "id": 1,
  "username": "alice",
  "email": "alice@example.com",
  "created_at": 1700000000
}
```

### App Passwords

| Method | Path | Description |
|---|---|---|
| GET | `/users/:id/app-passwords` | List app passwords for a user |
| POST | `/users/:id/app-passwords` | Create an app password |
| DELETE | `/app-passwords/:id` | Revoke an app password |

**Create app password request:**

```json
{
  "label": "Reeder on iPhone"
}
```

**Create response (201):** Returns the password metadata and the plaintext password (shown only once):

```json
{
  "app_password": {
    "id": 1,
    "user_id": 1,
    "label": "Reeder on iPhone",
    "last_used_at": null,
    "created_at": 1700000000
  },
  "plaintext_password": "hrss_abc123..."
}
```

**List response:**

```json
{
  "user_id": 1,
  "items": [
    {
      "id": 1,
      "user_id": 1,
      "label": "Reeder on iPhone",
      "last_used_at": 1700001000,
      "created_at": 1700000000
    }
  ]
}
```

Password hashes are never returned in API responses.

### Feed Credentials

Per-feed credentials for authenticated feed fetching. One credential per feed.

| Method | Path | Auth Scope | Description |
|---|---|---|---|
| GET | `/feeds/:id/credentials` | FETCH or ADMIN | Get decrypted credential for a feed |
| PUT | `/feeds/:id/credentials` | ADMIN | Set or update credential |
| DELETE | `/feeds/:id/credentials` | ADMIN | Remove credential |

**Set credential request:**

```json
{
  "auth_type": "basic",
  "credentials": {
    "username": "user",
    "password": "pass"
  }
}
```

**Credential response:**

```json
{
  "feed_id": 1,
  "auth_type": "basic",
  "credentials": {"username": "user", "password": "pass"},
  "created_at": 1700000000
}
```

### Maintenance

These endpoints handle periodic housekeeping tasks such as purging old entries and recomputing unread counts.

| Method | Path | Description |
|---|---|---|
| POST | `/maintenance/purge` | Purge old entries |
| POST | `/maintenance/recount` | Recompute unread counts |

**Purge request (optional body):**

```json
{
  "retention_days": 90
}
```

Defaults to 90 days if omitted. Starred entries are preserved regardless of age.

**Purge response:**

```json
{
  "retention_days": 90,
  "cutoff_timestamp": 1692000000,
  "deleted": 150,
  "skipped_starred": 3,
  "skipped_unread_override": 5,
  "deleted_rate_limits": 2
}
```

**Recount request (optional body):**

```json
{
  "user_id": 1
}
```

If `user_id` is omitted, recounts for all users.

**Recount response:**

```json
{
  "items": [
    {"subscription_id": 1, "unread_count": 42},
    {"subscription_id": 2, "unread_count": 7}
  ]
}
```

### OPML

These endpoints provide OPML import and export at the admin level, operating on behalf of a specified user.

| Method | Path | Description |
|---|---|---|
| GET | `/opml/export/:userId` | Export a user's subscriptions as OPML |
| POST | `/opml/import` | Import OPML for a user |

**Export response:**

```json
{
  "user_id": 1,
  "opml": "<?xml version=\"1.0\"...?><opml>...</opml>"
}
```

**Import request:**

```json
{
  "user_id": 1,
  "opml": "<?xml version=\"1.0\"...?><opml>...</opml>"
}
```

Hard cap: 500 feeds per import. Feeds are processed in batches (up to 15 per batch). The operation is idempotent and safe to retry.

**Import response:**

```json
{
  "user_id": 1,
  "imported": 42,
  "total_feeds": 42,
  "total_batches": 3,
  "batches": [
    {"batch_index": 0, "size": 15, "status": "success", "imported": 15},
    {"batch_index": 1, "size": 15, "status": "success", "imported": 15},
    {"batch_index": 2, "size": 12, "status": "success", "imported": 12}
  ]
}
```

On partial failure, earlier committed batches are preserved. The response uses HTTP 207 if some batches succeeded and some failed, or 400 if none succeeded.

---

## Error Format

Error formats vary by API surface:

**Native and Admin APIs** return structured errors:

```json
{
  "error": {
    "code": "not_found",
    "message": "Subscription 42 was not found."
  }
}
```

**Ingest API** uses a simpler format for some responses: `{"error": "message"}`.

**Google Reader API** returns plain text `Unauthorized` for ClientLogin auth failures (matching GR protocol conventions). Protected-route 401s include the `Google-Bad-Token: true` header.

Standard HTTP status codes are used across all surfaces:

| Status | Meaning |
|---|---|
| 400 | Bad request (validation error, missing parameters) |
| 401 | Unauthorized (missing or invalid credentials/token) |
| 403 | Forbidden (valid credentials but insufficient scope) |
| 404 | Not found |
| 409 | Conflict (duplicate resource) |
| 415 | Unsupported media type (Ingest API requires `application/json`) |
| 429 | Rate limited (includes `Retry-After` header) |
| 500 | Internal server error |

---

## Health Check

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | None | Service health check |

**Response (200):**

```json
{
  "ok": true
}
```

Unauthenticated. Use for uptime monitoring.
