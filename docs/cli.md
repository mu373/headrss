# CLI Reference

## Overview

`headrss` is a Bun-powered CLI for the HeadRSS system. It lets you manage your self-hosted RSS sync backend from the command line, handling everything from user administration to feed fetching and subscription management. The CLI serves two roles:

1. **Admin/user client:** a thin HTTP wrapper over the Worker's admin and native APIs for managing users, feeds, subscriptions, folders, and OPML.
2. **Feed fetcher:** fetches RSS/Atom feeds, parses and enriches items, and pushes them to the Worker via the ingest API.

Commands run one-shot: either interactively (subscription, folder, admin commands) or under cron (feed fetch, feed purge). All persistent state lives in D1; the only local state is an optional cached auth token.

## Global Options

| Option | Description |
|---|---|
| `--version` | Print the CLI version and exit. |
| `--help` | Show help text and exit. Available on every command and subcommand. |
| `--env <name>` | Select an environment profile. Overrides the `HEADRSS_ENV` env var. Defaults to `default`. See [Configuration](configuration.md) for environment profiles. |

## Authentication Modes

Different command groups use different authentication mechanisms. The table below summarizes which credentials each group requires:

| Command group | Auth mechanism | Credentials |
|---|---|---|
| Per-user commands | App password token (Native API) | `headrss login` (interactive/cached) or `HEADRSS_USER` + `HEADRSS_PASSWORD` env vars |
| Admin commands | Admin API key | `ADMIN_API_KEY` env var |
| Operations: `feed fetch` | Fetch + Ingest API keys | `FETCH_API_KEY` + `INGEST_API_KEY` env vars (also uses `ADMIN_API_KEY` if available, for permanent redirect URL updates) |
| Operations: `feed purge` | Admin API key | `ADMIN_API_KEY` env var |

Per-user commands automatically obtain and cache a Native API token. If a cached token exists and is still valid, it is reused. If the token has expired or a 401 is returned, the CLI transparently re-authenticates. Credentials are resolved in this order:

1. `HEADRSS_USER` + `HEADRSS_PASSWORD` env vars (non-interactive).
2. Cached token from a previous `headrss login`.
3. Interactive TTY prompt for username and app password.

---

## Per-User Commands

These commands operate as a specific authenticated user. They manage the user's own subscriptions, folders, and OPML data through the Native API.

### login

Exchange a username and app password for a Native API token and cache it locally.

**Syntax:**

```
headrss login
```

**Auth:** App password (prompted interactively, or via `HEADRSS_USER` / `HEADRSS_PASSWORD`).

**Description:**

Authenticates against the Native API token endpoint. The returned token is cached to `$XDG_CONFIG_HOME/headrss/environments/<env>/token.json` (defaults to `~/.config/headrss/environments/default/token.json`). Subsequent per-user commands reuse this token until it expires.

Outputs JSON with the username, expiry time, and status.

**Example:**

```
$ headrss login
Username: alice
App password: ****
{"expiresAt":1753100000,"ok":true,"username":"alice"}
```

---

### subscription list

List the authenticated user's subscriptions.

**Syntax:**

```
headrss subscription list
```

**Auth:** App password token (per-user).

**Description:**

Fetches all subscriptions for the current user from the Native API (`GET /api/native/v0/subscriptions`) and prints them as JSON.

**Example:**

```
$ headrss subscription list
```

---

### subscription add

Subscribe to a feed.

**Syntax:**

```
headrss subscription add <url> [options]
```

**Arguments:**

| Argument | Description |
|---|---|
| `<url>` | Feed URL to subscribe to. |

**Options:**

| Option | Description |
|---|---|
| `--title <title>` | Custom title for the subscription. |
| `--folder <folder>` | Folder ID or folder name. If a name is given and the folder does not exist, it is created automatically. |

**Auth:** App password token (per-user).

**Description:**

Creates a new subscription via the Native API (`POST /api/native/v0/subscriptions`). When `--folder` is a non-numeric string, the CLI resolves it by looking up existing folders by name; if no match is found, a new folder is created.

**Example:**

```
$ headrss subscription add https://example.com/feed.xml --folder Technology
$ headrss subscription add https://blog.example.org/rss --title "Example Blog"
```

---

### subscription rm

Remove a subscription.

**Syntax:**

```
headrss subscription rm <id>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<id>` | Subscription ID (numeric). |

**Auth:** App password token (per-user).

**Description:**

Deletes a subscription via the Native API (`DELETE /api/native/v0/subscriptions/:id`).

**Example:**

```
$ headrss subscription rm 42
```

---

### subscription credentials

Set or clear feed credentials for a subscription. Credentials are stored at the feed level (shared across all subscribers to the same feed).

**Syntax:**

```
headrss subscription credentials <id> --username <username> --password <password>
headrss subscription credentials <id> --clear
```

**Arguments:**

| Argument | Description |
|---|---|
| `id` | Subscription ID |

**Options:**

| Option | Description |
|---|---|
| `--username <username>` | Username for basic auth |
| `--password <password>` | Password for basic auth |
| `--clear` | Remove stored credentials |

**Examples:**

```
$ headrss subscription credentials 42 --username alice --password secret
$ headrss subscription credentials 42 --clear
```

---

### subscription import

Import subscriptions from an OPML file.

**Syntax:**

```
headrss subscription import <file>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<file>` | Path to a local OPML file. |

**Auth:** App password token (per-user).

**Description:**

Reads the OPML file from disk and imports it via the Native API. Subscriptions and folder structure from the OPML are created for the authenticated user. Outputs a JSON result with import statistics.

**Example:**

```
$ headrss subscription import ~/feeds.opml
```

---

### subscription export

Export subscriptions as OPML.

**Syntax:**

```
headrss subscription export [options]
```

**Options:**

| Option | Description |
|---|---|
| `-o, --output <file>` | Write OPML to a file instead of stdout. |

**Auth:** App password token (per-user).

**Description:**

Exports the authenticated user's subscriptions as OPML XML via the Native API. By default, the OPML is printed to stdout. Use `--output` to write directly to a file.

**Example:**

```
$ headrss subscription export -o ~/backup.opml
$ headrss subscription export > feeds.opml
```

---

### folder list

List the authenticated user's folders.

**Syntax:**

```
headrss folder list
```

**Auth:** App password token (per-user).

**Description:**

Fetches all folders for the current user from the Native API (`GET /api/native/v0/folders`) and prints them as JSON.

**Example:**

```
$ headrss folder list
```

---

### folder add

Create a folder.

**Syntax:**

```
headrss folder add <name>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<name>` | Folder name. |

**Auth:** App password token (per-user).

**Description:**

Creates a new folder via the Native API (`POST /api/native/v0/folders`).

**Example:**

```
$ headrss folder add Technology
```

---

### folder rm

Delete a folder.

**Syntax:**

```
headrss folder rm <id>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<id>` | Folder ID (numeric). |

**Auth:** App password token (per-user).

**Description:**

Deletes a folder via the Native API (`DELETE /api/native/v0/folders/:id`).

**Example:**

```
$ headrss folder rm 5
```

---

## Operations Commands

Operations commands handle the scheduled tasks that keep feeds up to date and the database clean. These are typically run under cron rather than interactively.

### feed fetch

Fetch due feeds in a single one-shot run.

**Syntax:**

```
headrss feed fetch [options]
```

**Options:**

| Option | Description |
|---|---|
| `--dry-run` | Show which feeds are due without actually fetching them. Prints the list as JSON and exits. |
| `--feed-id <ids...>` | Force-fetch specific feed IDs, bypassing the due-check schedule. Accepts one or more numeric IDs. Requires `ADMIN_API_KEY` to list all feeds. |

**Auth:** `FETCH_API_KEY` + `INGEST_API_KEY` env vars. Optionally `ADMIN_API_KEY` for `--feed-id` and for updating feed URLs on permanent redirects.

**Description:**

Queries the Worker for feeds that are due for fetching, then fetches, parses, enriches (favicons), and pushes items to the ingest API. Feeds are grouped by domain with a 2-second gap between requests to the same host. Concurrency is controlled by `FETCH_CONCURRENCY` (default 8).

The fetch pipeline handles conditional requests (ETag / If-Modified-Since), HTTP 304 (not modified), HTTP 410 (Gone, which schedules a far-future retry), HTTP 429 (rate limited, respecting the Retry-After header), and exponential backoff on errors. Permanent redirects (301) trigger an automatic feed URL update when `ADMIN_API_KEY` is available.

Feeds with a dead-feed sentinel error count are skipped. Items are deduplicated by GUID + published date before pushing.

**Related env vars:**

| Env var | Default | Description |
|---|---|---|
| `FETCH_API_KEY` | (required) | Read-only admin access for listing due feeds and feed credentials. |
| `INGEST_API_KEY` | (required) | Push access for submitting items and feed metadata updates. |
| `ADMIN_API_KEY` | (optional) | Needed for `--feed-id` and automatic URL updates on permanent redirects. |
| `FETCH_INTERVAL` | `900` | Default interval between fetches per feed, in seconds. |
| `FETCH_CONCURRENCY` | `8` | Maximum number of parallel feed fetches. |
| `FETCH_TIMEOUT` | `30` | HTTP request timeout per feed, in seconds. |

**Example:**

```
$ headrss feed fetch
$ headrss feed fetch --dry-run
$ headrss feed fetch --feed-id 1 2 3
```

**Recommended cron:**

```
*/15 * * * *  headrss feed fetch
```

---

### feed purge

Purge old items from the database.

**Syntax:**

```
headrss feed purge [options]
```

**Options:**

| Option | Description |
|---|---|
| `--retention-days <days>` | Override the `RETENTION_DAYS` env var for this run. |

**Auth:** `ADMIN_API_KEY` env var.

**Description:**

Sends a purge request to the Worker's admin maintenance endpoint (`POST /admin/maintenance/purge`). Deletes items older than the retention period. Starred and unread items are protected from deletion.

The retention period defaults to 90 days, configurable via the `RETENTION_DAYS` env var or the `--retention-days` CLI option (which takes precedence).

**Example:**

```
$ headrss feed purge
$ headrss feed purge --retention-days 30
```

**Recommended cron:**

```
0 3 * * *  headrss feed purge
```

---

## Admin Commands

Admin commands manage the HeadRSS system itself, including user accounts, app passwords, feeds, and OPML data for any user. All admin commands require the `ADMIN_API_KEY` environment variable.

### admin user list

List all users.

**Syntax:**

```
headrss admin user list
```

**Description:**

Fetches all users from the admin API (`GET /admin/users`) and prints them as JSON.

**Example:**

```
$ headrss admin user list
```

### admin user add

Create a user.

**Syntax:**

```
headrss admin user add <username> [options]
```

**Arguments:**

| Argument | Description |
|---|---|
| `<username>` | Username for the new user. |

**Options:**

| Option | Description |
|---|---|
| `--email <email>` | Email address for the user. |

**Description:**

Creates a new user via the admin API (`POST /admin/users`).

**Example:**

```
$ headrss admin user add alice --email alice@example.com
```

### admin user rm

Delete a user.

**Syntax:**

```
headrss admin user rm <id>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<id>` | User ID (numeric). |

**Description:**

Deletes a user via the admin API (`DELETE /admin/users/:id`).

**Example:**

```
$ headrss admin user rm 1
```

---

### admin password list

List app passwords for a user.

**Syntax:**

```
headrss admin password list <userId>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<userId>` | User ID (numeric). |

**Description:**

Lists all app passwords for the given user via the admin API (`GET /admin/users/:id/app-passwords`). The plaintext password is never returned; only metadata is shown (ID, label, creation date, etc.).

**Example:**

```
$ headrss admin password list 1
```

### admin password add

Create an app password.

**Syntax:**

```
headrss admin password add <userId> [options]
```

**Arguments:**

| Argument | Description |
|---|---|
| `<userId>` | User ID (numeric). |

**Options:**

| Option | Description |
|---|---|
| `--label <label>` | Label for the app password. If omitted in an interactive terminal, you will be prompted. Required via `--label` for non-interactive use. |

**Description:**

Creates a new app password via the admin API (`POST /admin/users/:id/app-passwords`). The plaintext password is printed exactly once to stdout and cannot be retrieved again. The password metadata is also printed as JSON.

**Example:**

```
$ headrss admin password add 1 --label "Reeder on Mac"
plaintext_password: hrss_xxxxxxxxxxxxxxxx
{"id":3,"label":"Reeder on Mac","created_at":"2025-01-15T10:00:00Z",...}
```

### admin password rm

Delete an app password.

**Syntax:**

```
headrss admin password rm <id>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<id>` | App password ID (numeric). |

**Description:**

Deletes an app password via the admin API (`DELETE /admin/app-passwords/:id`).

**Example:**

```
$ headrss admin password rm 3
```

---

### admin feed list

List all feeds.

**Syntax:**

```
headrss admin feed list
```

**Description:**

Fetches all feeds with their fetch state from the admin API (`GET /admin/feeds`) and prints them as JSON.

**Example:**

```
$ headrss admin feed list
```

### admin feed rm

Delete a feed.

**Syntax:**

```
headrss admin feed rm <id>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<id>` | Feed ID (numeric). |

**Description:**

Deletes a feed via the admin API (`DELETE /admin/feeds/:id`).

**Example:**

```
$ headrss admin feed rm 10
```

---

### admin opml import

Import OPML for a user (admin).

**Syntax:**

```
headrss admin opml import <file> --user <id>
```

**Arguments:**

| Argument | Description |
|---|---|
| `<file>` | Path to a local OPML file. |

**Options:**

| Option | Description |
|---|---|
| `--user <id>` | **(Required)** User ID to import subscriptions for. |

**Description:**

Reads an OPML file from disk and imports it via the admin API (`POST /admin/opml/import`) for the specified user. Unlike `subscription import`, this command operates on behalf of any user and requires admin credentials.

**Example:**

```
$ headrss admin opml import feeds.opml --user 1
```

### admin opml export

Export OPML for a user (admin).

**Syntax:**

```
headrss admin opml export <userId> [options]
```

**Arguments:**

| Argument | Description |
|---|---|
| `<userId>` | User ID (numeric). |

**Options:**

| Option | Description |
|---|---|
| `-o, --output <file>` | Write OPML to a file instead of stdout. |

**Description:**

Exports subscriptions for the specified user as OPML XML via the admin API (`GET /admin/opml/export/:userId`). By default, the OPML is printed to stdout. Use `--output` to write directly to a file.

**Example:**

```
$ headrss admin opml export 1 -o ~/user1-feeds.opml
$ headrss admin opml export 1 > user1-feeds.opml
```
