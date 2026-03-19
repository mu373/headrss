import { describe, expect, it } from "vitest";

import { markEntries } from "../commands/mark-entries.js";
import type { EntryStore } from "../ports/entry-store.js";
import { InMemoryEntryStore } from "../test-support/entry-store.mock.js";

describe("markEntries", () => {
  it("applies read and unread overrides relative to the subscription cursor", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const first = store.seedEntry({
      feedId: feed.id,
      publicId: "entry-1",
      publishedAt: 100,
    });
    const second = store.seedEntry({
      feedId: feed.id,
      publicId: "entry-2",
      publishedAt: 200,
    });

    store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: first.id,
    });

    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [second.publicId],
      read: true,
    });
    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [first.publicId],
      read: false,
    });

    expect(await store.getItemState(user.id, second.id)).toMatchObject({
      isRead: 1,
      isStarred: 0,
    });
    expect(await store.getItemState(user.id, first.id)).toMatchObject({
      isRead: 0,
      isStarred: 0,
    });
  });

  it("preserves starred rows while clearing default read overrides", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const first = store.seedEntry({
      feedId: feed.id,
      publicId: "entry-1",
      publishedAt: 100,
    });

    store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: first.id,
    });

    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [first.publicId],
      read: false,
      starred: true,
      starredAt: 123,
    });
    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [first.publicId],
      read: true,
    });

    expect(await store.getItemState(user.id, first.id)).toEqual({
      itemId: first.id,
      userId: user.id,
      isRead: null,
      isStarred: 1,
      starredAt: 123,
    });

    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [first.publicId],
      starred: false,
    });

    expect(await store.getItemState(user.id, first.id)).toBeNull();
  });

  it("adds and removes item labels and rejects foreign labels", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const otherUser = store.seedUser({ username: "bob" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const entry = store.seedEntry({
      feedId: feed.id,
      publicId: "entry-1",
      publishedAt: 100,
    });
    const ownedLabel = store.seedLabel({ userId: user.id, name: "Work" });
    const foreignLabel = store.seedLabel({ userId: otherUser.id, name: "Other" });

    store.seedSubscription({ userId: user.id, feedId: feed.id });

    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [entry.publicId],
      addLabelIds: [ownedLabel.id],
    });
    expect(await store.listItemLabels(user.id, entry.id)).toEqual([ownedLabel]);

    await markEntries(store as unknown as EntryStore, {
      userId: user.id,
      publicIds: [entry.publicId],
      removeLabelIds: [ownedLabel.id],
    });
    expect(await store.listItemLabels(user.id, entry.id)).toEqual([]);

    await expect(
      markEntries(store as unknown as EntryStore, {
        userId: user.id,
        publicIds: [entry.publicId],
        addLabelIds: [foreignLabel.id],
      }),
    ).rejects.toThrow("Label ownership mismatch.");
  });
});
