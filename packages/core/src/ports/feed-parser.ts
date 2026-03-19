export interface FeedMeta {
  title: string | null;
  siteUrl: string | null;
  faviconUrl?: string | null;
  etag?: string | null;
  lastModified?: string | null;
}

export interface ParsedItem {
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  publishedAt: number;
  crawlTimeMs?: number | null;
}

export interface ParseResult {
  feed: FeedMeta;
  items: ParsedItem[];
}

export interface FeedParser {
  parse(body: string, contentType: string | null): ParseResult;
}
