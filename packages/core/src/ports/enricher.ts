import type { FeedMeta, ParsedItem } from "./feed-parser.js";

export interface EnrichResult {
  feed: FeedMeta;
  items: ParsedItem[];
}

export interface Enricher {
  enrich(feed: FeedMeta, items: ParsedItem[]): Promise<EnrichResult>;
}
