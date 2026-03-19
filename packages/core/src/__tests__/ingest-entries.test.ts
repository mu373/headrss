import { describe, expect, it } from "vitest";

import { ingestEntries } from "../commands/ingest-entries.js";
import { generatePublicId } from "../id.js";
import type { EntryStore } from "../ports/entry-store.js";
import { InMemoryEntryStore } from "../test-support/entry-store.mock.js";

describe("ingestEntries", () => {
  it("chunks inserts and delegates idempotent duplicate handling to the store", async () => {
    const store = new InMemoryEntryStore();
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });

    const items = Array.from({ length: 41 }, (_, index) => ({
      guid: `guid-${index + 1}`,
      title: `Entry ${index + 1}`,
      publishedAt: index + 1,
    }));

    const result = await ingestEntries(store as unknown as EntryStore, {
      feedId: feed.id,
      items: [...items, items[0]],
    });

    expect(result).toEqual({ inserted: 41, skipped: 1 });
    expect(store.insertEntriesBatchSizes).toEqual([40, 2]);

    const publicId = generatePublicId(feed.url, items[0].guid);
    expect(await store.getEntryByPublicId(publicId)).not.toBeNull();
  });

  it("returns an empty result for an empty batch", async () => {
    const store = new InMemoryEntryStore();
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });

    await expect(
      ingestEntries(store as unknown as EntryStore, {
        feedId: feed.id,
        items: [],
      }),
    ).resolves.toEqual({ inserted: 0, skipped: 0 });
    expect(store.insertEntriesBatchSizes).toEqual([]);
  });
});
