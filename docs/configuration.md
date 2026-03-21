# Configuration

HeadRSS is configured entirely through environment variables, following the [twelve-factor app](https://12factor.net/config) methodology. There is no configuration file format to learn. Variables are split between two runtimes:

- **Worker secrets** are stored in Cloudflare and used by the Worker at the edge.
- **CLI environment variables** are set on the machine that runs the `headrss` CLI.

---

## Worker Secrets

The Worker authenticates every API request and encrypts stored credentials at rest. Five secrets must be configured in Cloudflare for these protections to function. All are strings.

| Secret | Purpose |
|---|---|
| `TOKEN_KEY` | HMAC signing key for auth tokens (Google Reader, native API) and CSRF tokens |
| `CREDENTIAL_KEY` | AES-GCM encryption key for stored feed credentials |
| `INGEST_API_KEY` | API key authorising the fetcher to push items (`/ingest/*`) |
| `FETCH_API_KEY` | API key authorising the fetcher to read feed lists and credentials (read-only admin subset) |
| `ADMIN_API_KEY` | API key granting full admin access (`/admin/*`, feed purge) |

### Generating secrets

Generate each secret with:

```sh
openssl rand -base64 32
```

### Setting secrets

Use Wrangler to set each secret in Cloudflare:

```sh
wrangler secret put TOKEN_KEY
wrangler secret put CREDENTIAL_KEY
wrangler secret put INGEST_API_KEY
wrangler secret put FETCH_API_KEY
wrangler secret put ADMIN_API_KEY
```

Wrangler will prompt for the value interactively. See `packages/worker/wrangler.toml.example` for the full Worker configuration template.

---

## CLI Environment Variables

The `headrss` CLI reads the following environment variables. None are stored in a config file; they come from the shell environment, a `.env` file, or a profile env file (see [Environment Profiles](#environment-profiles) below).

The variables fall into three categories: connection (`HEADRSS_URL`), authentication (`HEADRSS_USER`, `HEADRSS_PASSWORD`, and the API keys), and tuning (`FETCH_CONCURRENCY`, `FETCH_INTERVAL`, `FETCH_TIMEOUT`, `RETENTION_DAYS`, `LOG_LEVEL`).

| Variable | Default | Required for | Description |
|---|---|---|---|
| `HEADRSS_URL` | *(required)* | All commands | Worker base URL (trailing slashes are stripped) |
| `HEADRSS_USER` | *(none)* | Per-user commands (or use `headrss login`) | Username for native API authentication |
| `HEADRSS_PASSWORD` | *(none)* | Per-user commands (or use `headrss login`) | App password for native API authentication |
| `ADMIN_API_KEY` | *(none)* | `admin *`, `feed purge` | Full admin API key (must match the Worker secret) |
| `FETCH_API_KEY` | *(none)* | `feed fetch` | Read-only API key for feed lists and credentials |
| `INGEST_API_KEY` | *(none)* | `feed fetch` | Push API key for ingesting items |
| `FETCH_CONCURRENCY` | `8` | `feed fetch` | Maximum number of parallel feed fetches |
| `FETCH_INTERVAL` | `900` | `feed fetch` | Default interval between fetches per feed, in seconds |
| `FETCH_TIMEOUT` | `30` | `feed fetch` | HTTP request timeout per feed, in seconds |
| `RETENTION_DAYS` | `90` | `feed purge` | Items older than this many days are purged |
| `LOG_LEVEL` | `info` | Any command | Logging verbosity: `debug`, `info`, `warn`, `error` |

`HEADRSS_URL` is required for every command. Other variables are required only by the commands that use them. The CLI validates at invocation time and reports which variable is missing.

For non-interactive use (cron jobs, CI), set `HEADRSS_USER` and `HEADRSS_PASSWORD` or use `headrss login` to cache a token beforehand. If neither is available and stdin is not a TTY, the CLI will exit with an error.

### Example `.env` file

```sh
# Worker URL
HEADRSS_URL=https://headrss.example.workers.dev

# Authentication (for per-user commands)
HEADRSS_USER=alice
HEADRSS_PASSWORD=app-password-here

# API keys (must match Worker secrets)
ADMIN_API_KEY=base64-encoded-key
FETCH_API_KEY=base64-encoded-key
INGEST_API_KEY=base64-encoded-key

# Fetcher tuning
FETCH_CONCURRENCY=8
FETCH_INTERVAL=900
FETCH_TIMEOUT=30

# Maintenance
RETENTION_DAYS=90
LOG_LEVEL=info
```

---

## Environment Profiles

Profiles let you manage multiple HeadRSS instances (e.g., production and staging) from the same machine without juggling `.env` files.

### Profile Selection (`--env` / `HEADRSS_ENV`)

The active profile is determined by (in order of priority):

1. The `--env <name>` CLI flag
2. The `HEADRSS_ENV` environment variable
3. The default name: `default`

Profile names must match `[a-zA-Z0-9_-]+`.

```sh
# Use the "staging" profile
headrss --env staging feed fetch

# Or via environment variable
export HEADRSS_ENV=staging
headrss feed fetch
```

### Directory Structure

Each profile stores its files under the XDG config directory:

```
$XDG_CONFIG_HOME/headrss/environments/<name>/
  env            # Profile-specific environment variables
  token.json     # Cached native API token (from `headrss login`)
```

If `XDG_CONFIG_HOME` is not set, it defaults to `~/.config`. For the default profile, the full path is:

```
~/.config/headrss/environments/default/env
~/.config/headrss/environments/default/token.json
```

A legacy token cache path (`~/.config/headrss/token.json`) is checked as a fallback for the `default` profile only, for backward compatibility.

### Env File Loading Precedence

The CLI loads environment variables from multiple sources. The general philosophy is that explicit overrides implicit and the closest scope wins. Earlier sources take precedence, so a variable that is already set is never overwritten.

1. **Real environment variables** (highest priority): variables already set in the shell or passed on the command line.
2. **Profile env file**: `$XDG_CONFIG_HOME/headrss/environments/<name>/env`.
3. **`.env` file** (lowest priority): the CLI walks up from the current working directory to the filesystem root, loading the first `.env` file it finds.

Within env files, the following syntax is supported:

```sh
# Comments (lines starting with #)
KEY=value
export KEY=value          # "export" prefix is stripped
KEY="quoted value"        # Double quotes are stripped
KEY='single quoted'       # Single quotes are stripped
```

Empty lines and lines without an `=` sign are ignored.

This layering means you can put shared defaults in a `.env` file at your project root and override individual values per profile or per invocation:

```sh
# Override a single variable for one run
FETCH_CONCURRENCY=2 headrss feed fetch

# Or put profile-specific values in the profile env file
# ~/.config/headrss/environments/staging/env
HEADRSS_URL=https://headrss-staging.example.workers.dev
ADMIN_API_KEY=staging-admin-key
```

### Token Caching

Running `headrss login` exchanges a username and app password for a native API token and caches it at:

```
$XDG_CONFIG_HOME/headrss/environments/<name>/token.json
```

The cached token contains the token string, the username, and an expiry timestamp. The CLI automatically refreshes the token when it is within 30 seconds of expiring. If a request returns HTTP 401, the CLI clears the cache and re-authenticates transparently.

Each profile maintains its own independent token cache, so you can be logged in to multiple HeadRSS instances simultaneously.
