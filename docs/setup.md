# Setup

This guide walks you through deploying HeadRSS from scratch. By the end, you will have:

- A Google Reader-compatible sync server deployed to Cloudflare
- The CLI installed and configured for admin and feed fetching
- RSS clients connected and syncing

## Deploying the Worker

### Prerequisites

- [Node.js](https://nodejs.org/) 20+
- [pnpm](https://pnpm.io/) 9+
- [Bun](https://bun.sh/) (for building and running the CLI)
- A [Cloudflare](https://www.cloudflare.com/) account (free tier works for personal use)

### Build

Clone the repository and build all packages:

```bash
git clone https://github.com/mu373/headrss.git
cd headrss
pnpm install
pnpm build
```

### Create D1 Database

```bash
cd packages/worker
npx wrangler d1 create headrss
```

Note the `database_id` in the output. You will need it in the next step.

### Configure wrangler.toml

```bash
cd packages/worker
cp wrangler.toml.example wrangler.toml
```

Edit `wrangler.toml` and replace `<your-d1-database-id>` with the ID from the previous step:

```toml
[[d1_databases]]
binding = "DB"
database_name = "headrss"
database_id = "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
```

### Run Migrations

Apply the database schema to your D1 instance:

```bash
cd packages/worker

# Production
npx wrangler d1 migrations apply headrss --remote
```

The migration files live in `packages/adapter/d1/src/migrations/`. The `wrangler.toml` points to them via `migrations_dir`.

### Set Worker Secrets

HeadRSS requires five secrets. Generate cryptographically random values for each:

```bash
cd packages/worker

# Token signing key (used for HMAC-SHA256 auth tokens)
openssl rand -base64 32 | npx wrangler secret put TOKEN_KEY

# Credential encryption key (encrypts stored feed credentials)
openssl rand -base64 32 | npx wrangler secret put CREDENTIAL_KEY

# Ingest API key (authenticates feed item pushes from the CLI)
openssl rand -base64 32 | npx wrangler secret put INGEST_API_KEY

# Fetch API key (authenticates feed list reads from the CLI)
openssl rand -base64 32 | npx wrangler secret put FETCH_API_KEY

# Admin API key (authenticates user/feed/OPML management)
openssl rand -base64 32 | npx wrangler secret put ADMIN_API_KEY
```

Save these values somewhere secure. You will need `INGEST_API_KEY`, `FETCH_API_KEY`, and `ADMIN_API_KEY` for CLI configuration.

### Deploy the Worker

```bash
cd packages/worker
npx wrangler deploy
```

The Worker URL (e.g., `https://headrss.<your-subdomain>.workers.dev`) is printed on deploy. You can also set up a custom domain in the Cloudflare dashboard.

Verify the deployment:

```bash
curl https://headrss.your-domain.com/health
# {"ok":true}
```

## Setting Up the CLI

### Build the CLI

Compile the CLI into a standalone binary:

```bash
cd packages/cli
bun build --compile src/index.ts --outfile headrss
```

Place the binary somewhere in your `PATH`:

```bash
cp headrss ~/.local/bin/
```

### Configure the CLI

Create a `.env` file in your project root (or wherever you run `headrss` from). The CLI walks up from the current directory to find the nearest `.env` file:

```bash
# Required for all commands
HEADRSS_URL=https://headrss.your-domain.com

# Admin operations
ADMIN_API_KEY=your-admin-key

# Feed fetching
FETCH_API_KEY=your-fetch-key
INGEST_API_KEY=your-ingest-key
```

Alternatively, you can use [environment profiles](configuration.md#environment-profiles) to store configuration under `~/.config/headrss/environments/<name>/env`. See [Configuration](configuration.md) for the full list of variables and tuning options.

## Subscribing to Feeds

### Create First User

```bash
# Create a user
headrss admin user add alice

# Create an app password (displays the plaintext password once, so save it)
headrss admin password add <userId> --label "Reeder"
```

The `admin user add` command prints the new user's ID. Use that ID when creating the app password. The plaintext password is shown only once.

### Import Feeds

Import an OPML file:

```bash
# Log in first (caches a token locally)
headrss login

# Import from OPML
headrss subscription import subscriptions.opml
```

Or add feeds individually:

```bash
headrss subscription add https://example.com/feed.xml
headrss subscription add https://example.com/feed.xml --folder Technology
```

OPML import supports up to 500 feeds per file. Folder structure from the OPML is preserved.

## Operations

### Set Up Cron

Schedule the fetcher and purge jobs by adding them to your crontab (`crontab -e`). The recommended approach is to use a `.env` file so the cron entries stay clean:

```cron
*/15 * * * *  /path/to/headrss feed fetch
0 3 * * *     /path/to/headrss feed purge
```

See [Configuration](configuration.md) for details on setting up your `.env` file with the required keys.

If you prefer not to use a `.env` file, you can pass environment variables inline instead:

```cron
*/15 * * * *  HEADRSS_URL=https://headrss.your-domain.com FETCH_API_KEY=... INGEST_API_KEY=... /path/to/headrss feed fetch
0 3 * * *     HEADRSS_URL=https://headrss.your-domain.com ADMIN_API_KEY=... /path/to/headrss feed purge
```

The fetch job runs every 15 minutes. Each run only fetches feeds that are due based on their `next_fetch_at` timestamp, with a default fetch interval of 900 seconds (15 minutes) per feed. The purge job runs daily at 3 AM and removes items older than 90 days by default, preserving starred items and items with an explicit unread state.

### Updating

Pull the latest changes and redeploy:

```bash
git pull
pnpm install
pnpm build

# Deploy updated Worker
cd packages/worker
npx wrangler deploy

# Rebuild CLI binary
cd packages/cli
bun build --compile src/index.ts --outfile headrss
cp headrss ~/.local/bin/
```

If new migrations were added, apply them before deploying:

```bash
cd packages/worker
npx wrangler d1 migrations apply headrss --remote
```

### Local Development

Run the Worker locally with Wrangler:

```bash
cd packages/worker

# Apply migrations to local D1
npx wrangler d1 migrations apply headrss --local

# Start dev server
npx wrangler dev
```

Run the CLI without compiling:

```bash
bun packages/cli/src/index.ts --help
bun packages/cli/src/index.ts feed fetch
```

Point the CLI at the local Worker:

```bash
export HEADRSS_URL="http://localhost:8787"
```

---

## Connecting RSS Clients

Once your HeadRSS instance is deployed and you have created a user with an app password, you can connect any Google Reader-compatible RSS client.

### Connection Settings

Configure your RSS client with these settings:

| Field | Value |
|---|---|
| Server / URL | `https://headrss.your-domain.com/api/google` |
| Username | Your HeadRSS username (e.g., `alice`) |
| Password | An app password (not the admin API key) |

The base URL must include the `/api/google` path. This is the Google Reader API mount point that RSS clients expect.

### Tested Clients

The following clients have been verified to work with HeadRSS. Other Google Reader-compatible clients should also work. Some clients label the account type as "FreshRSS" instead of "Google Reader Compatible"; either option works with HeadRSS.

- **Reeder** (iOS/macOS): Add account > Google Reader > enter server URL, username, and app password.
- **NetNewsWire** (macOS/iOS): Settings > "+" > Self-hosted: FreshRSS > Continue > enter username, password (app password), and API URL (`https://headrss.your-domain.com/api/google`).

### Managing App Passwords

Create a separate app password for each device or client. This lets you revoke access to one device without affecting others.

```bash
# Create a new app password
headrss admin password add <userId> --label "iPhone Reeder"
headrss admin password add <userId> --label "Mac NetNewsWire"

# List app passwords for a user
headrss admin password list <userId>

# Revoke a specific app password
headrss admin password rm <passwordId>
```

Revoking an app password immediately invalidates any tokens issued with it. The affected client will need to re-authenticate with a new password.

### What to Expect

When you subscribe to a new feed, HeadRSS attempts a best-effort fetch immediately so items can appear right away. If that initial fetch fails or is slow, items will appear after the next CLI fetch cycle (within 15 minutes with the recommended cron schedule).

The subscription itself registers instantly and appears in your client right away.

Read and star state syncs in real time. Marking items as read or starred writes the change to D1 immediately and reflects it on all clients on their next sync.

### Troubleshooting

**Authentication failures**
- Verify you are using an app password, not the admin API key.
- Check that the server URL includes the `/api/google` path.
- Ensure the username matches exactly (case-sensitive).
- Auth is rate-limited to 5 attempts per 15 minutes per IP. Wait for the window to reset if you are locked out.

**Missing items after subscribing**
- New feeds get a best-effort immediate fetch, but if that fails, items appear after the next CLI fetch cycle. Check that your cron job is active: `headrss feed fetch --dry-run` shows which feeds are due.
- If a feed has repeated fetch errors, it enters exponential backoff (up to 24 hours). Check feed status with `headrss admin feed list` and look for high `fetch_error_count` values.

**Rate limiting**
- The Worker rate-limits authentication endpoints (login/ClientLogin) to 5 attempts per 15-minute window per IP address.
- Feed fetching respects `next_fetch_at` scheduling. The CLI only fetches feeds that are due, avoiding unnecessary requests to origin servers.
- If you hit Cloudflare Workers free-tier limits (100k requests/day, 10ms CPU per request), consider upgrading to the Workers Paid plan ($5/month).
