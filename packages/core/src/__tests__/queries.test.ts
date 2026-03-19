import { describe, expect, it } from "vitest";

import { getEntriesById } from "../queries/get-entries-by-id.js";
import { getUnreadCounts } from "../queries/get-unread-counts.js";
import { getUserInfo } from "../queries/get-user-info.js";
import { listEntries } from "../queries/list-entries.js";
import { listEntryIds } from "../queries/list-entry-ids.js";
import { listLabels } from "../queries/list-labels.js";
import { listSubscriptions } from "../queries/list-subscriptions.js";
import { READING_LIST_STREAM_ID, toFeedStreamId, toLabelStreamId } from "../internal/stream-id.js";
import type { EntryStore } from "../ports/entry-store.js";
import { InMemoryEntryStore } from "../test-support/entry-store.mock.js";

describe("queries", () => {
  it("lists entry ids with continuation and unread filtering", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const label = store.seedLabel({ userId: user.id, name: "Folder" });
    const subscription = store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: null,
    });

    store.seedSubscriptionLabel(subscription.id, label.id);
    const first = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });
    const second = store.seedEntry({ feedId: feed.id, publicId: "entry-2", publishedAt: 200 });
    const third = store.seedEntry({ feedId: feed.id, publicId: "entry-3", publishedAt: 300 });

    store.seedItemState({ userId: user.id, itemId: second.id, isRead: 1 });

    const result = await listEntryIds(store as unknown as EntryStore, user.id, {
      streamId: toLabelStreamId(label.name),
      count: 2,
      excludeTag: "user/-/state/com.google/read",
      sortOrder: "newest",
    });

    expect(result.ids).toEqual([third.publicId, first.publicId]);
    expect(result.continuation).toBeUndefined();

    const paged = await listEntryIds(store as unknown as EntryStore, user.id, {
      streamId: toFeedStreamId(feed.url),
      count: 2,
      sortOrder: "newest",
    });

    expect(paged.ids).toEqual([third.publicId, second.publicId]);
    expect(paged.continuation).toEqual({
      publishedAt: second.publishedAt,
      id: second.id,
    });
  });

  it("lists full entries with labels and resolved state", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const folder = store.seedLabel({ userId: user.id, name: "Folder" });
    const itemLabel = store.seedLabel({ userId: user.id, name: "Saved" });
    const subscription = store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: null,
    });
    const entry = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });

    store.seedSubscriptionLabel(subscription.id, folder.id);
    store.seedItemState({
      userId: user.id,
      itemId: entry.id,
      isRead: 1,
      isStarred: 1,
      starredAt: 10,
    });
    store.seedItemLabel(user.id, entry.id, itemLabel.id);

    const result = await listEntries(store as unknown as EntryStore, user.id, {
      streamId: READING_LIST_STREAM_ID,
      count: 10,
      sortOrder: "newest",
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      publicId: entry.publicId,
      state: {
        isRead: true,
        isStarred: true,
        starredAt: 10,
      },
      labels: [{ id: itemLabel.id, name: itemLabel.name }],
    });
  });

  it("fetches entries by public id in 90-id batches and preserves input order", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });

    store.seedSubscription({ userId: user.id, feedId: feed.id });

    const entries = Array.from({ length: 95 }, (_, index) =>
      store.seedEntry({
        feedId: feed.id,
        publicId: `entry-${index + 1}`,
        publishedAt: index + 1,
      })
    );

    const ids = entries.map((entry) => entry.publicId).reverse();
    const result = await getEntriesById(
      store as unknown as EntryStore,
      user.id,
      [...ids, ids[0]],
    );

    expect(store.getEntriesByPublicIdsBatchSizes).toEqual([90, 5]);
    expect(result.map((entry) => entry.publicId)).toEqual([...ids, ids[0]]);
  });

  it("lists subscriptions and labels for a user", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({
      url: "https://example.com/feed.xml",
      title: "Example Feed",
      siteUrl: "https://example.com",
    });
    const label = store.seedLabel({ userId: user.id, name: "Tech" });
    const subscription = store.seedSubscription({ userId: user.id, feedId: feed.id });

    store.seedSubscriptionLabel(subscription.id, label.id);

    await expect(
      listSubscriptions(store as unknown as EntryStore, user.id),
    ).resolves.toEqual([
      expect.objectContaining({
        id: subscription.id,
        feed,
        labels: [label],
      }),
    ]);
    await expect(listLabels(store as unknown as EntryStore, user.id)).resolves.toEqual([
      label,
    ]);
  });

  it("computes unread counts from the cursor-plus-exceptions model", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const first = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });
    const second = store.seedEntry({ feedId: feed.id, publicId: "entry-2", publishedAt: 200 });
    const third = store.seedEntry({ feedId: feed.id, publicId: "entry-3", publishedAt: 300 });

    store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: second.id,
    });
    store.seedItemState({ userId: user.id, itemId: first.id, isRead: 0 });
    store.seedItemState({ userId: user.id, itemId: third.id, isRead: 1 });

    const counts = await getUnreadCounts(store as unknown as EntryStore, user.id);

    expect(counts).toEqual([
      {
        streamId: toFeedStreamId(feed.url),
        count: 1,
        newestItemTimestampUsec: String(first.publishedAt * 1_000_000),
      },
    ]);
  });

  it("returns user info and null for a missing user", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice", email: "alice@example.com" });

    await expect(getUserInfo(store as unknown as EntryStore, user.id)).resolves.toEqual(
      user,
    );
    await expect(getUserInfo(store as unknown as EntryStore, 999)).resolves.toBeNull();
  });
});
