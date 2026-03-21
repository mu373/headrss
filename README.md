# HeadRSS

A self-hosted, headless RSS sync backend on Cloudflare Workers + D1.

## Overview

HeadRSS is built with these principles in mind:

- **Decoupled**: feed fetching and sync are separate. The fetcher runs on your machine, the sync server on Cloudflare, connected only by HTTP.
- **Extensible**: the fetch pipeline is open to customization (e.g. full-text extraction) without touching the sync server.
- **Data ownership**: your subscriptions, read state, and content stay in your own database.
- **Client freedom**: you can use any Google Reader-compatible app (Reeder, NetNewsWire, etc.) on any platform.

## Features

- [Google Reader API](https://rss-sync.github.io/Open-Reader-API/) for RSS client sync
- Native REST API with OpenAPI spec for web frontends
- OPML import/export
- Authenticated feed support (Basic Auth, Bearer token, custom headers), encrypted at rest
- Multi-user with per-device app passwords
- Automatic exponential backoff for failing feeds
- Separate CLI fetcher that runs on your machine via cron
- CLI for admin and subscription management
- Runs on Cloudflare free tier for personal use

## Architecture

HeadRSS consists of two components:

- **Worker**: Cloudflare Workers + D1. Handles API requests and stores all data (feeds, items, users, read state).
- **CLI** (`headrss`): runs on your machine. Works as:
  - **Fetcher**: fetches RSS/Atom feeds on a cron schedule and pushes items to the Worker.
  - **Admin/user client**: manages users, feeds, subscriptions, folders, and OPML.

```
┌─────────────────────────────────┐     ┌──────────────────────────────────────┐
│  Server                         │     │  Cloudflare (Worker + D1)            │
│                                 │     │                                      │
│  CLI (headrss):                 │     │  API endpoints:                      │
│  headrss feed fetch             │     │  /api/google/*  ← RSS clients        │
│    ├─ GET  /admin/feeds    ─────┼────▶│  /api/native/*  ← web frontend       │
│    ├─ fetch RSS/Atom feeds      │     │  /ingest/*      ← fetcher push       │
│    └─ POST /ingest/items   ─────┼────▶│  /admin/*       ← admin/fetcher      │
│                                 │     │         │                            │
│  headrss feed purge        ─────┼────▶│         ▼                            │
│                                 │     │        D1 (SQLite)                   │
│  headrss admin user/feed/opml   │     │                                      │
│  headrss subscription/folder    │     │                                      │
│                                 │     │                                      │
└─────────────────────────────────┘     └──────────────────────────────────────┘
```

See [Architecture](docs/architecture.md) for details.

## Packages

| Package | Description |
|---|---|
| `@headrss/core` | Domain types, port interfaces, commands, queries, Zod schemas |
| `@headrss/adapter-d1` | D1 implementation of EntryStore + CredentialStore |
| `@headrss/adapter-greader` | Google Reader protocol adapter (Hono sub-app) |
| `@headrss/adapter-api` | Native REST API adapter (Hono sub-app, OpenAPI) |
| `@headrss/worker` | Cloudflare Worker entry point — wires everything together |
| `@headrss/cli` | CLI tool for admin + feed fetching (Bun runtime) |

## Setup

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Bun](https://bun.sh/) (for running the CLI)
- [Wrangler](https://developers.cloudflare.com/workers/wrangler/) (installed as a workspace dev dependency)

### Install & Build

```bash
pnpm install
pnpm build
```

### Deploy the Worker

```bash
# Create D1 database
cd packages/worker
npx wrangler d1 create headrss

# Copy wrangler.toml.example and fill in your database_id
cp wrangler.toml.example wrangler.toml

# Apply migrations
npx wrangler d1 migrations apply headrss --local    # local dev
npx wrangler d1 migrations apply headrss --remote   # production

# Set secrets
npx wrangler secret put TOKEN_KEY
npx wrangler secret put CREDENTIAL_KEY
npx wrangler secret put INGEST_API_KEY
npx wrangler secret put FETCH_API_KEY
npx wrangler secret put ADMIN_API_KEY

# Deploy
npx wrangler deploy
```

### Configure the CLI

All configuration is via environment variables:

```bash
# Required
export HEADRSS_URL="https://headrss.your-domain.com"

# Admin operations
export ADMIN_API_KEY="your-admin-key"

# Feed fetching
export FETCH_API_KEY="your-fetch-key"
export INGEST_API_KEY="your-ingest-key"

# Per-user operations (or use `headrss login`)
export HEADRSS_USER="your-username"
export HEADRSS_PASSWORD="your-app-password"
```

Optional tuning:

| Variable | Default | Description |
|---|---|---|
| `FETCH_CONCURRENCY` | `8` | Max parallel feed fetches |
| `FETCH_INTERVAL` | `900` | Seconds between fetches per feed |
| `FETCH_TIMEOUT` | `30` | HTTP request timeout (seconds) |
| `RETENTION_DAYS` | `90` | Item retention for purge |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

See [Setup Guide](docs/setup.md) and [Configuration](docs/configuration.md) for details.

## Usage

### Initial setup

```bash
# Create a user
headrss admin user add alice

# Create an app password (displays the plaintext password once)
headrss admin password add <userId> --label "CLI"

# Login (caches token locally)
headrss login
```

### Import feeds

```bash
# Import from OPML file (as logged-in user)
headrss subscription import subscriptions.opml

# Export subscriptions as OPML
headrss subscription export -o subscriptions.opml

# Or add individually
headrss subscription add https://example.com/feed.xml
headrss subscription add https://example.com/feed.xml --folder Technology
```

### Fetch & sync

```bash
# Fetch all due feeds (one-shot, for cron)
headrss feed fetch

# Dry run — show what would be fetched
headrss feed fetch --dry-run

# Purge old items (keeps starred and explicitly unread)
headrss feed purge
```

### Recommended cron

```cron
*/15 * * * *  headrss feed fetch
0 3 * * *     headrss feed purge
```

### Manage subscriptions & folders

```bash
headrss subscription list
headrss subscription add <url>
headrss subscription rm <id>
headrss subscription import <file>
headrss subscription export [-o <file>]

headrss folder list
headrss folder add <name>
headrss folder rm <id>
```

### Admin commands

```bash
headrss admin user list
headrss admin user add <username>
headrss admin user rm <id>

headrss admin password list <userId>
headrss admin password add <userId>
headrss admin password rm <id>

headrss admin feed list
headrss admin feed rm <id>

headrss admin opml export <userId>
headrss admin opml import <file> --user <id>
```

See [CLI Reference](docs/cli.md) for details.

## Connecting RSS clients

Point your RSS client at the Worker URL with the Google Reader base path:

```
https://headrss.your-domain.com/api/google
```

Login with your username and an app password. Tested with:

- Reeder (iOS/Mac)
- NetNewsWire (Mac/iOS)

## API endpoints

| Path | Auth | Description |
|---|---|---|
| `/api/google/*` | ClientLogin token | Google Reader-compatible API |
| `/api/native/v0/*` | Bearer token | Native REST API (OpenAPI) |
| `/ingest/*` | `INGEST_API_KEY` | Feed item ingestion |
| `/admin/*` | `FETCH_API_KEY` / `ADMIN_API_KEY` | System administration |
| `/health` | None | Health check |
| `/api/openapi.json` | None | OpenAPI spec |

See [API Reference](docs/api.md) and [Authentication](docs/auth.md) for details.

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Type check
pnpm typecheck

# Lint
pnpm lint

# Format
pnpm format

# Local dev server
cd packages/worker && npx wrangler dev

# Run CLI in development
bun packages/cli/src/index.ts --help
```

### Building the CLI binary

```bash
# Build
cd packages/cli
bun build --compile src/index.ts --outfile headrss

# Use it directly
./headrss feed fetch

# Or, copy to bin
cp headrss ~/.local/bin/
```

## Documentation

- [Setup Guide](docs/setup.md)
- [Architecture](docs/architecture.md)
- [API Reference](docs/api.md)
- [CLI Reference](docs/cli.md)
- [Configuration](docs/configuration.md)
- [Data Model](docs/data-model.md)
- [Authentication](docs/auth.md)

## License

MIT
