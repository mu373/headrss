import {
  type EntryStore,
  type FeedCredentialStore,
  type FeedSubscribedEvent,
  HttpFetchTransport,
  ingestEntries,
  RssAtomFeedParser,
} from "@headrss/core";

const ACCEPT_HEADER =
  "application/rss+xml, application/atom+xml, application/xml, text/xml, */*;q=0.1";
const USER_AGENT = "HeadRSS-Fetcher/1.0";
const FETCH_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 5;
const BACKOFF_SECONDS = 900;

export async function fetchFeedOnSubscribe(
  store: EntryStore,
  credentialStore: FeedCredentialStore,
  event: FeedSubscribedEvent,
): Promise<void> {
  const transport = new HttpFetchTransport();
  const parser = new RssAtomFeedParser();
  const now = Math.floor(Date.now() / 1000);

  try {
    const headers: Record<string, string> = {
      Accept: ACCEPT_HEADER,
      "User-Agent": USER_AGENT,
    };

    const credential = await credentialStore.get(event.feedId);
    if (credential !== null) {
      const decrypted = JSON.parse(
        new TextDecoder().decode(credential.credentialsEncrypted),
      ) as Record<string, string>;

      if (credential.authType === "basic") {
        headers["Authorization"] =
          `Basic ${btoa(`${decrypted.username}:${decrypted.password}`)}`;
      } else if (credential.authType === "bearer") {
        headers["Authorization"] = `Bearer ${decrypted.token}`;
      } else if (credential.authType === "custom" && decrypted.headers) {
        const customHeaders = JSON.parse(decrypted.headers) as Record<
          string,
          string
        >;
        Object.assign(headers, customHeaders);
      }
    }

    const result = await transport.fetch(event.feedUrl, {
      headers,
      timeout: FETCH_TIMEOUT_MS,
      maxRedirects: MAX_REDIRECTS,
    });

    if (result.status >= 400) {
      await store.updateFeed(event.feedId, {
        fetchErrorCount: 1,
        nextFetchAt: now + BACKOFF_SECONDS,
      });
      return;
    }

    if (result.status === 304 || result.body.length === 0) {
      await store.updateFeed(event.feedId, {
        lastFetchedAt: now,
        fetchErrorCount: 0,
        nextFetchAt: now + BACKOFF_SECONDS,
      });
      return;
    }

    const contentType = result.headers["content-type"] ?? null;
    const parsed = parser.parse(result.body, contentType);

    const seen = new Set<string>();
    const uniqueItems = parsed.items.filter((item) => {
      const key = `${item.guid}:${item.publishedAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    if (uniqueItems.length > 0) {
      await ingestEntries(store, {
        feedId: event.feedId,
        items: uniqueItems,
      });
    }

    await store.updateFeed(event.feedId, {
      title: parsed.feed.title,
      siteUrl: parsed.feed.siteUrl,
      etag: result.headers["etag"] ?? null,
      lastModified: result.headers["last-modified"] ?? null,
      lastFetchedAt: now,
      fetchErrorCount: 0,
      nextFetchAt: now + BACKOFF_SECONDS,
    });
  } catch (error) {
    console.error(
      `[fetchFeedOnSubscribe] Failed to fetch feed ${event.feedId} (${event.feedUrl}):`,
      error,
    );

    try {
      await store.updateFeed(event.feedId, {
        fetchErrorCount: 1,
        nextFetchAt: now + BACKOFF_SECONDS,
      });
    } catch {
      // Best effort — CLI will recover on next scheduled run
    }
  }
}
