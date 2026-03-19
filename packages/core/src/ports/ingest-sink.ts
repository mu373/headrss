import type { IngestResult } from "../types.js";
import type { FeedMeta, ParsedItem } from "./feed-parser.js";

export interface FeedMetaUpdate extends Partial<FeedMeta> {
  lastFetchedAt?: number | null;
  fetchErrorCount?: number;
  nextFetchAt?: number | null;
}

export interface IngestSink {
  pushItems(feedId: number, items: ParsedItem[]): Promise<IngestResult>;
  updateFeedMeta(feedId: number, meta: FeedMetaUpdate): Promise<void>;
}
