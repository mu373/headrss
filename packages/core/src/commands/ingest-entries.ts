import { INGEST_BATCH_SIZE } from "../constants.js";
import { generatePublicId } from "../id.js";
import { chunkArray } from "../internal/chunk.js";
import type { EntryStore } from "../ports/entry-store.js";
import type { EntryInsertInput } from "../ports/entry-store.js";
import type { IngestResult } from "../types.js";

export interface IngestEntryInput {
  guid: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  content?: string | null;
  summary?: string | null;
  publishedAt: number;
  crawlTimeMs?: number | null;
  createdAt?: number;
}

export interface IngestEntriesInput {
  feedId: number;
  items: ReadonlyArray<IngestEntryInput>;
}

export async function ingestEntries(
  store: EntryStore,
  input: IngestEntriesInput,
): Promise<IngestResult> {
  if (input.items.length === 0) {
    return { inserted: 0, skipped: 0 };
  }

  const feed = await store.getFeedById(input.feedId);

  if (feed === null) {
    throw new Error(`Feed ${input.feedId} was not found.`);
  }

  let inserted = 0;
  let skipped = 0;

  for (const batch of chunkArray(input.items, INGEST_BATCH_SIZE)) {
    const entries: EntryInsertInput[] = batch.map((item) => {
      const entry: EntryInsertInput = {
        publicId: generatePublicId(feed.url, item.guid),
        feedId: input.feedId,
        guid: item.guid,
        publishedAt: item.publishedAt,
      };

      if (item.title !== undefined) {
        entry.title = item.title;
      }

      if (item.url !== undefined) {
        entry.url = item.url;
      }

      if (item.author !== undefined) {
        entry.author = item.author;
      }

      if (item.content !== undefined) {
        entry.content = item.content;
      }

      if (item.summary !== undefined) {
        entry.summary = item.summary;
      }

      if (item.crawlTimeMs !== undefined) {
        entry.crawlTimeMs = item.crawlTimeMs;
      }

      if (item.createdAt !== undefined) {
        entry.createdAt = item.createdAt;
      }

      return entry;
    });

    const result = await store.insertEntries(
      entries,
    );

    inserted += result.inserted;
    skipped += result.skipped;
  }

  return { inserted, skipped };
}
