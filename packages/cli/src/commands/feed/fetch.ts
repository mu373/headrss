import {
  BACKOFF_BASE_MINUTES,
  BACKOFF_CAP_HOURS,
  BACKOFF_MULTIPLIER,
  DEAD_FEED_SENTINEL,
  type FeedMetaUpdate,
} from "@headrss/core";
import pLimit from "p-limit";
import type { Command } from "commander";

import type { ParsedItem } from "@headrss/core";

import type {
  AdminFeed,
  FeedCredentials,
  HeadrssApiClient,
} from "../../api-client.js";
import { getFetchConcurrency, getFetchIntervalSeconds, getFetchTimeoutMs, getEnv, requireEnv } from "../../config.js";
import { FaviconEnricher } from "../../fetch/enrichers/favicon.js";
import { RssAtomFeedParser } from "../../fetch/parsers/rss-atom.js";
import { HttpIngestSink } from "../../fetch/sink.js";
import { HttpFetchTransport } from "../../fetch/transports/http.js";
import { createLogger } from "../../log.js";
import { normalizeUrl, printJson, sleep, toErrorMessage } from "../../utils.js";
import { ApiClientError } from "../../api-client.js";

const ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1";
const DOMAIN_GAP_MS = 2000;
const FETCH_USER_AGENT = "HeadRSS-Fetcher/1.0";
const GONE_BACKOFF_SECONDS = 10 * 365 * 24 * 60 * 60;

export function registerFeedFetchCommand(
  parent: Command,
  client: HeadrssApiClient,
): void {
  parent
    .command("fetch")
    .option("--dry-run", "Show due feeds without fetching them")
    .option("--feed-id <ids...>", "Force-fetch specific feed IDs (bypasses due check)")
    .option("--force", "Fetch all feeds regardless of schedule")
    .description("Fetch due feeds")
    .action(async (options: { dryRun?: boolean; feedId?: string[]; force?: boolean }) => {
      await runFeedFetchCommand(client, Boolean(options.dryRun), options.feedId?.map(Number), Boolean(options.force));
    });
}

export async function runFeedFetchCommand(
  client: HeadrssApiClient,
  dryRun: boolean,
  feedIds?: number[],
  force?: boolean,
): Promise<void> {
  const logger = createLogger();
  const fetchApiKey = requireEnv("FETCH_API_KEY");

  let dueFeeds: AdminFeed[];

  if (feedIds !== undefined && feedIds.length > 0) {
    const allFeeds = await client.listFeeds(requireEnv("ADMIN_API_KEY"));
    dueFeeds = allFeeds
      .filter((feed) => feedIds.includes(feed.id))
      .sort((left, right) => left.url.localeCompare(right.url));
  } else if (force) {
    dueFeeds = (await client.listFeeds(requireEnv("ADMIN_API_KEY")))
      .sort((left, right) => left.url.localeCompare(right.url));
  } else {
    dueFeeds = (await client.listDueFeeds(fetchApiKey))
      .filter(isEligibleFeed)
      .sort((left, right) => left.url.localeCompare(right.url));
  }

  logger.info(`Found ${dueFeeds.length} feed(s) to fetch.`);

  if (dueFeeds.length === 0) {
    return;
  }

  if (dryRun) {
    printJson(dueFeeds);
    return;
  }

  const ingestApiKey = requireEnv("INGEST_API_KEY");
  const adminApiKey = getEnv("ADMIN_API_KEY");
  const fetchIntervalSeconds = getFetchIntervalSeconds();
  const fetchTimeoutMs = getFetchTimeoutMs();
  const concurrency = getFetchConcurrency();
  const credentialMap = await prefetchCredentials(client, fetchApiKey, dueFeeds, logger);
  const sink = new HttpIngestSink(client, ingestApiKey, logger);
  const parser = new RssAtomFeedParser();
  const transport = new HttpFetchTransport();
  const groups = groupByDomain(dueFeeds);
  const limit = pLimit(concurrency);

  const startedAt = Date.now();

  await Promise.all(
    [...groups.entries()].map(([domain, feeds]) =>
      limit(async () => {
        logger.debug("Processing feed domain.", { count: feeds.length, domain });
        let nextAllowedAt = 0;

        for (const feed of feeds) {
          const delay = nextAllowedAt - Date.now();
          if (delay > 0) {
            await sleep(delay);
          }

          await processFeed({
            adminApiKey,
            client,
            credential: credentialMap.get(feed.id),
            feed,
            fetchIntervalSeconds,
            fetchTimeoutMs,
            logger,
            parser,
            sink,
            transport,
          });

          nextAllowedAt = Date.now() + DOMAIN_GAP_MS;
        }
      })),
  );

  const elapsedMs = Date.now() - startedAt;
  logger.info(`Fetch complete.`, { feeds: dueFeeds.length, durationMs: elapsedMs });
}

async function processFeed(input: {
  adminApiKey: string | undefined;
  client: HeadrssApiClient;
  credential: FeedCredentials | undefined;
  feed: AdminFeed;
  fetchIntervalSeconds: number;
  fetchTimeoutMs: number;
  logger: ReturnType<typeof createLogger>;
  parser: RssAtomFeedParser;
  sink: HttpIngestSink;
  transport: HttpFetchTransport;
}): Promise<void> {
  const { feed, logger } = input;
  const now = Math.floor(Date.now() / 1000);

  try {
    const result = await input.transport.fetch(feed.url, {
      headers: {
        Accept: ACCEPT_HEADER,
        ...buildConditionalHeaders(feed),
        ...buildCredentialHeaders(input.credential),
        "User-Agent": FETCH_USER_AGENT,
      },
      maxRedirects: 5,
      timeout: input.fetchTimeoutMs,
    });

    if (result.status === 304) {
      await input.sink.updateFeedMeta(feed.id, {
        etag: result.headers.etag ?? feed.etag,
        fetchErrorCount: 0,
        lastFetchedAt: now,
        lastModified: result.headers["last-modified"] ?? feed.last_modified,
        nextFetchAt: now + input.fetchIntervalSeconds,
      });
      logger.info("Feed not modified.", { feedId: feed.id, url: feed.url });
      return;
    }

    if (result.status === 410) {
      await input.sink.updateFeedMeta(feed.id, {
        fetchErrorCount: Math.max(feed.fetch_error_count, 1),
        nextFetchAt: now + GONE_BACKOFF_SECONDS,
      });
      logger.error("Feed returned 410 Gone; scheduling far-future retry.", {
        feedId: feed.id,
        url: feed.url,
      });
      return;
    }

    if (result.status === 429) {
      const retrySeconds = Math.max(
        parseRetryAfterSeconds(result.headers["retry-after"]) ?? 15 * 60,
        computeBackoffSeconds(feed.fetch_error_count + 1),
      );
      await input.sink.updateFeedMeta(feed.id, {
        fetchErrorCount: feed.fetch_error_count + 1,
        nextFetchAt: now + retrySeconds,
      });
      logger.warn("Feed fetch rate limited.", { feedId: feed.id, retrySeconds, url: feed.url });
      return;
    }

    if (result.status >= 400) {
      throw new Error(`Feed returned HTTP ${result.status}.`);
    }

    const parsed = input.parser.parse(result.body, result.headers["content-type"] ?? null);
    const enricher = new FaviconEnricher({
      currentFaviconUrl: feed.favicon_url,
      previousSiteUrl: feed.site_url,
      timeoutMs: input.fetchTimeoutMs,
    });
    const enriched = await enricher.enrich(
      {
        etag: result.headers.etag ?? feed.etag,
        lastModified: result.headers["last-modified"] ?? feed.last_modified,
        siteUrl: parsed.feed.siteUrl,
        title: parsed.feed.title,
      },
      parsed.items,
    );
    const items = dedupeItems(enriched.items);

    await input.sink.pushItems(feed.id, items);
    await input.sink.updateFeedMeta(feed.id, {
      etag: result.headers.etag ?? feed.etag,
      faviconUrl: enriched.feed.faviconUrl ?? feed.favicon_url,
      fetchErrorCount: 0,
      lastFetchedAt: now,
      lastModified: result.headers["last-modified"] ?? feed.last_modified,
      nextFetchAt: now + input.fetchIntervalSeconds,
      siteUrl: enriched.feed.siteUrl ?? feed.site_url,
      title: enriched.feed.title ?? feed.title,
    });

    if (result.redirectedPermanently && normalizeUrl(result.finalUrl) !== normalizeUrl(feed.url)) {
      await maybeUpdateCanonicalUrl(
        input.client,
        input.adminApiKey,
        feed,
        result.finalUrl,
        logger,
      );
    }

    logger.info("Fetched feed.", {
      feedId: feed.id,
      insertedItems: items.length,
      url: feed.url,
    });
  } catch (error) {
    const failureCount = nextFailureCount(feed.fetch_error_count);
    const backoffSeconds = computeBackoffSeconds(failureCount);

    await input.sink.updateFeedMeta(feed.id, {
      fetchErrorCount: failureCount,
      nextFetchAt: now + backoffSeconds,
    });
    logger.warn("Feed fetch failed.", {
      backoffSeconds,
      error: toErrorMessage(error),
      feedId: feed.id,
      url: feed.url,
    });
  }
}

async function prefetchCredentials(
  client: HeadrssApiClient,
  fetchApiKey: string,
  feeds: AdminFeed[],
  logger: ReturnType<typeof createLogger>,
): Promise<Map<number, FeedCredentials>> {
  const credentialFeeds = feeds.filter((feed) => feed.has_credentials);
  const entries = await Promise.all(
    credentialFeeds.map(async (feed) => {
      try {
        return [feed.id, await client.getFeedCredentials(fetchApiKey, feed.id)] as const;
      } catch (error) {
        logger.warn("Failed to prefetch feed credentials.", {
          error: toErrorMessage(error),
          feedId: feed.id,
        });
        return null;
      }
    }),
  );

  return new Map(
    entries.filter((entry): entry is readonly [number, FeedCredentials] => entry !== null),
  );
}

function buildConditionalHeaders(feed: AdminFeed): Record<string, string> {
  return {
    ...(feed.etag === null ? {} : { "If-None-Match": feed.etag }),
    ...(feed.last_modified === null ? {} : { "If-Modified-Since": feed.last_modified }),
  };
}

function buildCredentialHeaders(credential: FeedCredentials | undefined): Record<string, string> {
  if (credential === undefined) {
    return {};
  }

  const type = credential.auth_type.toLowerCase();
  const payload = credential.credentials;

  if (type === "basic") {
    const object = typeof payload === "object" && payload !== null
      ? payload as Record<string, unknown>
      : {};
    const username = readCredentialString(object, ["username", "user"]);
    const password = readCredentialString(object, ["password", "pass"]);

    if (username === null || password === null) {
      return {};
    }

    return {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
    };
  }

  if (type === "bearer") {
    const token = typeof payload === "string"
      ? payload
      : typeof payload === "object" && payload !== null
        ? readCredentialString(payload as Record<string, unknown>, ["token", "access_token"])
        : null;

    return token === null ? {} : { Authorization: `Bearer ${token}` };
  }

  if (type === "custom" && typeof payload === "object" && payload !== null) {
    const object = payload as Record<string, unknown>;
    const headers = "headers" in object && typeof object.headers === "object" && object.headers !== null
      ? object.headers as Record<string, unknown>
      : object;

    return Object.fromEntries(
      Object.entries(headers)
        .filter(([, value]) => typeof value === "string")
        .map(([key, value]) => [key, value as string]),
    );
  }

  return {};
}

function readCredentialString(
  value: Record<string, unknown>,
  keys: string[],
): string | null {
  for (const key of keys) {
    const candidate = value[key];

    if (typeof candidate === "string" && candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

async function maybeUpdateCanonicalUrl(
  client: HeadrssApiClient,
  adminApiKey: string | undefined,
  feed: AdminFeed,
  finalUrl: string,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  if (adminApiKey === undefined) {
    logger.warn("Permanent redirect detected but ADMIN_API_KEY is unavailable; skipping URL update.", {
      feedId: feed.id,
      from: feed.url,
      to: finalUrl,
    });
    return;
  }

  try {
    await client.updateAdminFeed(adminApiKey, feed.id, { url: finalUrl });
    logger.warn("Updated feed URL after permanent redirect.", {
      feedId: feed.id,
      from: feed.url,
      to: finalUrl,
    });
  } catch (error) {
    if (error instanceof ApiClientError && error.status === 409) {
      logger.warn("Permanent redirect target conflicts with an existing feed; skipping URL update.", {
        feedId: feed.id,
        from: feed.url,
        to: finalUrl,
      });
      return;
    }

    logger.warn("Failed to update feed URL after permanent redirect.", {
      error: toErrorMessage(error),
      feedId: feed.id,
      from: feed.url,
      to: finalUrl,
    });
  }
}

function groupByDomain(feeds: AdminFeed[]): Map<string, AdminFeed[]> {
  const groups = new Map<string, AdminFeed[]>();

  for (const feed of feeds) {
    const key = domainKey(feed.url);
    const values = groups.get(key) ?? [];
    values.push(feed);
    groups.set(key, values);
  }

  return groups;
}

function domainKey(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function isEligibleFeed(feed: AdminFeed): boolean {
  const now = Math.floor(Date.now() / 1000);

  return (
    feed.fetch_error_count !== DEAD_FEED_SENTINEL &&
    (feed.next_fetch_at === null || feed.next_fetch_at <= now)
  );
}

function nextFailureCount(current: number): number {
  return current < 0 ? 1 : current + 1;
}

function computeBackoffSeconds(failureCount: number): number {
  const minutes = Math.min(
    BACKOFF_BASE_MINUTES * BACKOFF_MULTIPLIER ** Math.max(failureCount - 1, 0),
    BACKOFF_CAP_HOURS * 60,
  );

  return minutes * 60;
}

function parseRetryAfterSeconds(value: string | undefined): number | null {
  if (value === undefined) {
    return null;
  }

  const numeric = Number(value);

  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }

  const dateValue = Date.parse(value);

  if (!Number.isFinite(dateValue)) {
    return null;
  }

  return Math.max(Math.ceil((dateValue - Date.now()) / 1000), 0);
}

function dedupeItems(items: ParsedItem[]): ParsedItem[] {
  const seen = new Set<string>();
  const deduped: ParsedItem[] = [];

  for (const item of items) {
    const key = `${item.guid}:${item.publishedAt}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}
