import type { Enricher, EnrichResult, FeedMeta, ParsedItem } from "@headrss/core";

interface FaviconEnricherOptions {
  currentFaviconUrl: string | null;
  previousSiteUrl: string | null;
  timeoutMs: number;
}

const USER_AGENT = "HeadRSS-Fetcher/1.0";

export class FaviconEnricher implements Enricher {
  constructor(private readonly options: FaviconEnricherOptions) {}

  async enrich(feed: FeedMeta, items: ParsedItem[]): Promise<EnrichResult> {
    const siteUrl = feed.siteUrl ?? this.options.previousSiteUrl;

    if (siteUrl === null) {
      return {
        feed: {
          ...feed,
          faviconUrl: this.options.currentFaviconUrl ?? null,
        },
        items,
      };
    }

    if (
      this.options.currentFaviconUrl !== null &&
      this.options.previousSiteUrl !== null &&
      this.options.previousSiteUrl === siteUrl
    ) {
      return {
        feed: {
          ...feed,
          faviconUrl: this.options.currentFaviconUrl,
        },
        items,
      };
    }

    const faviconUrl = await discoverFavicon(siteUrl, this.options.timeoutMs);

    return {
      feed: {
        ...feed,
        faviconUrl: faviconUrl ?? this.options.currentFaviconUrl ?? null,
      },
      items,
    };
  }
}

async function discoverFavicon(siteUrl: string, timeoutMs: number): Promise<string | null> {
  const directFaviconUrl = new URL("/favicon.ico", siteUrl).toString();

  if (await canFetch(directFaviconUrl, timeoutMs)) {
    return directFaviconUrl;
  }

  const html = await fetchText(siteUrl, timeoutMs);

  if (html === null) {
    return null;
  }

  const document = new DOMParser().parseFromString(html, "text/html");

  for (const element of document.querySelectorAll("link[rel]")) {
    const rel = element.getAttribute("rel")?.toLowerCase() ?? "";
    if (!rel.includes("icon")) {
      continue;
    }

    const href = element.getAttribute("href");
    if (href === null || href.trim().length === 0) {
      continue;
    }

    try {
      return new URL(href, siteUrl).toString();
    } catch {
      continue;
    }
  }

  return null;
}

async function canFetch(url: string, timeoutMs: number): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
        "User-Agent": USER_AGENT,
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    return await response.text();
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
