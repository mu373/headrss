import {
  MAX_CONTENT_SIZE,
  MAX_SUMMARY_SIZE,
  type FeedParser,
  type ParseResult,
} from "@headrss/core";
import { XMLParser } from "fast-xml-parser";

const parser = new XMLParser({
  attributeNamePrefix: "",
  cdataPropName: "__cdata",
  ignoreAttributes: false,
  parseTagValue: false,
  removeNSPrefix: true,
  trimValues: true,
});

export class RssAtomFeedParser implements FeedParser {
  parse(body: string, _contentType: string | null): ParseResult {
    const document = parser.parse(body) as Record<string, unknown>;

    if ("rss" in document) {
      return parseRss2(document.rss);
    }

    if ("RDF" in document || "rdf:RDF" in document) {
      return parseRdf(document.RDF ?? document["rdf:RDF"]);
    }

    if ("feed" in document) {
      return parseAtom(document.feed);
    }

    throw new Error("Unsupported feed format.");
  }
}

function parseRss2(value: unknown): ParseResult {
  const channel = toObject(value).channel;
  const channelObject = toObject(channel);
  const siteUrl = normalizeUrl(getText(channelObject.link));

  return {
    feed: {
      siteUrl,
      title: getText(channelObject.title),
    },
    items: asArray(channelObject.item).map((item) => parseRssItem(item, siteUrl)),
  };
}

function parseRdf(value: unknown): ParseResult {
  const root = toObject(value);
  const channel = toObject(root.channel);
  const siteUrl = normalizeUrl(getText(channel.link));

  return {
    feed: {
      siteUrl,
      title: getText(channel.title),
    },
    items: asArray(root.item).map((item) => parseRssItem(item, siteUrl)),
  };
}

function parseAtom(value: unknown): ParseResult {
  const feed = toObject(value);
  const siteUrl = normalizeUrl(readAtomLink(feed.link));

  return {
    feed: {
      siteUrl,
      title: getText(feed.title),
    },
    items: asArray(feed.entry).map((entry) => parseAtomItem(entry, siteUrl)),
  };
}

function parseRssItem(value: unknown, siteUrl: string | null) {
  const item = toObject(value);
  const publishedAt = normalizeTimestamp(
    getText(item.pubDate) ??
      getText(item.published) ??
      getText(item.date) ??
      getText(item.updated),
  );
  const rawUrl = getText(item.link);
  const resolvedUrl = resolveUrl(rawUrl, siteUrl);
  const content = resolveHtml(
    getText(item.encoded) ?? getText(item.content),
    resolvedUrl ?? siteUrl,
  );
  const summary = resolveHtml(getText(item.description), resolvedUrl ?? siteUrl);
  const title = getText(item.title);

  return {
    author: getText(item.author) ?? getText(item.creator),
    content: truncateUtf8(content, MAX_CONTENT_SIZE),
    guid: normalizeGuid(getText(item.guid), resolvedUrl, title, publishedAt),
    publishedAt,
    summary: truncateUtf8(summary, MAX_SUMMARY_SIZE),
    title,
    url: resolvedUrl,
  };
}

function parseAtomItem(value: unknown, siteUrl: string | null) {
  const item = toObject(value);
  const publishedAt = normalizeTimestamp(
    getText(item.published) ?? getText(item.updated) ?? getText(item.created),
  );
  const rawUrl = readAtomLink(item.link);
  const resolvedUrl = resolveUrl(rawUrl, siteUrl);
  const content = resolveHtml(getText(item.content), resolvedUrl ?? siteUrl);
  const summary = resolveHtml(getText(item.summary), resolvedUrl ?? siteUrl);
  const title = getText(item.title);

  return {
    author: getAtomAuthor(item.author),
    content: truncateUtf8(content, MAX_CONTENT_SIZE),
    guid: normalizeGuid(getText(item.id), resolvedUrl, title, publishedAt),
    publishedAt,
    summary: truncateUtf8(summary, MAX_SUMMARY_SIZE),
    title,
    url: resolvedUrl,
  };
}

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function toObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function getText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    for (const candidate of value) {
      const text = getText(candidate);
      if (text !== null) {
        return text;
      }
    }
    return null;
  }

  if (typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;

    if (typeof object.href === "string") {
      return object.href;
    }

    return (
      getText(object.__cdata) ??
      getText(object["#text"]) ??
      getText(object.text) ??
      null
    );
  }

  return null;
}

function readAtomLink(value: unknown): string | null {
  let selfHref: string | null = null;

  for (const candidate of asArray(value)) {
    const link = toObject(candidate);
    const rel = typeof link.rel === "string" ? link.rel : "alternate";
    const href = typeof link.href === "string" ? link.href : getText(candidate);

    if (href === null) {
      continue;
    }

    if (rel === "alternate") {
      return href;
    }

    if (rel === "self" && selfHref === null) {
      selfHref = href;
    }
  }

  return selfHref;
}

function getAtomAuthor(value: unknown): string | null {
  for (const candidate of asArray(value)) {
    const author = toObject(candidate);
    const name = getText(author.name) ?? getText(candidate);

    if (name !== null) {
      return name;
    }
  }

  return null;
}

function normalizeTimestamp(value: string | null): number {
  if (value !== null) {
    const parsed = Date.parse(value);

    if (Number.isFinite(parsed)) {
      return Math.floor(parsed / 1000);
    }
  }

  return Math.floor(Date.now() / 1000);
}

function normalizeGuid(
  candidate: string | null,
  url: string | null,
  title: string | null,
  publishedAt: number,
): string {
  if (candidate !== null && candidate.length > 0) {
    return candidate;
  }

  if (url !== null) {
    return url;
  }

  return fallbackHash(`${title ?? ""}:${publishedAt}`);
}

function fallbackHash(value: string): string {
  let hash = 5381;

  for (const char of value) {
    hash = ((hash << 5) + hash + char.charCodeAt(0)) >>> 0;
  }

  return `fallback:${hash.toString(16)}`;
}

function normalizeUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    return new URL(value).toString();
  } catch {
    return value;
  }
}

function resolveUrl(value: string | null, baseUrl: string | null): string | null {
  if (value === null) {
    return null;
  }

  try {
    return baseUrl === null ? new URL(value).toString() : new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function resolveHtml(value: string | null, baseUrl: string | null): string | null {
  if (value === null || baseUrl === null || !/[<>]/.test(value)) {
    return value;
  }

  return value.replace(
    /(<[^>]+?\s)((?:href|src|poster)\s*=\s*)(["'])([^"']*?)\3/gi,
    (_match, prefix, attr, quote, url) => {
      const trimmed = (url as string).trim();
      if (trimmed.length === 0) {
        return `${prefix}${attr}${quote}${url}${quote}`;
      }
      try {
        const resolved = new URL(trimmed, baseUrl as string).toString();
        return `${prefix}${attr}${quote}${resolved}${quote}`;
      } catch {
        return `${prefix}${attr}${quote}${url}${quote}`;
      }
    },
  );
}

function truncateUtf8(value: string | null, maxBytes: number): string | null {
  if (value === null) {
    return null;
  }

  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maxBytes) {
    return value;
  }

  let low = 0;
  let high = value.length;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = value.slice(0, mid);

    if (encoder.encode(candidate).byteLength <= maxBytes) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return value.slice(0, low);
}
