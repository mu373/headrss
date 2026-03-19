import { describe, expect, it } from "vitest";

import { markAllRead } from "../commands/mark-all-read.js";
import { READING_LIST_STREAM_ID, toLabelStreamId } from "../internal/stream-id.js";
import type { EntryStore } from "../ports/entry-store.js";
import { InMemoryEntryStore } from "../test-support/entry-store.mock.js";

describe("markAllRead", () => {
  it("advances the cursor, cleans stale overrides, and protects post-cutoff items", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const first = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });
    const second = store.seedEntry({ feedId: feed.id, publicId: "entry-2", publishedAt: 200 });
    const third = store.seedEntry({ feedId: feed.id, publicId: "entry-3", publishedAt: 400 });
    const fourth = store.seedEntry({ feedId: feed.id, publicId: "entry-4", publishedAt: 150 });
    const subscription = store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: first.id,
    });

    store.seedItemState({
      userId: user.id,
      itemId: first.id,
      isRead: 0,
      isStarred: 1,
      starredAt: 10,
    });
    store.seedItemState({
      userId: user.id,
      itemId: second.id,
      isRead: 0,
      isStarred: 0,
    });

    await markAllRead(store as unknown as EntryStore, {
      userId: user.id,
      streamId: `feed/${feed.url}`,
      timestampUsec: 250_000_000,
    });

    expect(await store.getSubscriptionById(subscription.id)).toMatchObject({
      readCursorItemId: fourth.id,
    });
    expect(await store.getItemState(user.id, second.id)).toBeNull();
    expect(await store.getItemState(user.id, first.id)).toEqual({
      itemId: first.id,
      userId: user.id,
      isRead: null,
      isStarred: 1,
      starredAt: 10,
    });
    expect(await store.getItemState(user.id, third.id)).toEqual({
      itemId: third.id,
      userId: user.id,
      isRead: 0,
      isStarred: 0,
      starredAt: null,
    });
  });

  it("applies the algorithm to every subscription in a label scope", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const label = store.seedLabel({ userId: user.id, name: "Work" });
    const feedA = store.seedFeed({ url: "https://example.com/a.xml" });
    const feedB = store.seedFeed({ url: "https://example.com/b.xml" });
    const subA = store.seedSubscription({ userId: user.id, feedId: feedA.id });
    const subB = store.seedSubscription({ userId: user.id, feedId: feedB.id });

    store.seedSubscriptionLabel(subA.id, label.id);
    store.seedSubscriptionLabel(subB.id, label.id);
    const entryA = store.seedEntry({ feedId: feedA.id, publicId: "a-1", publishedAt: 100 });
    const entryB = store.seedEntry({ feedId: feedB.id, publicId: "b-1", publishedAt: 200 });

    await markAllRead(store as unknown as EntryStore, {
      userId: user.id,
      streamId: toLabelStreamId(label.name),
    });

    expect(await store.getSubscriptionById(subA.id)).toMatchObject({
      readCursorItemId: entryA.id,
    });
    expect(await store.getSubscriptionById(subB.id)).toMatchObject({
      readCursorItemId: entryB.id,
    });
  });

  it("applies the algorithm to every subscription in the reading list scope", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feedA = store.seedFeed({ url: "https://example.com/a.xml" });
    const feedB = store.seedFeed({ url: "https://example.com/b.xml" });
    const subA = store.seedSubscription({ userId: user.id, feedId: feedA.id });
    const subB = store.seedSubscription({ userId: user.id, feedId: feedB.id });

    const entryA = store.seedEntry({ feedId: feedA.id, publicId: "a-1", publishedAt: 100 });
    const entryB = store.seedEntry({ feedId: feedB.id, publicId: "b-1", publishedAt: 200 });

    await markAllRead(store as unknown as EntryStore, {
      userId: user.id,
      streamId: READING_LIST_STREAM_ID,
    });

    expect(await store.getSubscriptionById(subA.id)).toMatchObject({
      readCursorItemId: entryA.id,
    });
    expect(await store.getSubscriptionById(subB.id)).toMatchObject({
      readCursorItemId: entryB.id,
    });
  });

  it("does not clean overrides or protect items when the cursor does not advance", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const first = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });
    const second = store.seedEntry({ feedId: feed.id, publicId: "entry-2", publishedAt: 200 });
    const third = store.seedEntry({ feedId: feed.id, publicId: "entry-3", publishedAt: 300 });
    const subscription = store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      readCursorItemId: second.id,
    });

    store.seedItemState({
      userId: user.id,
      itemId: first.id,
      isRead: 0,
      isStarred: 0,
    });

    await markAllRead(store as unknown as EntryStore, {
      userId: user.id,
      streamId: `feed/${feed.url}`,
      timestampUsec: 200_000_000,
    });

    expect(await store.getSubscriptionById(subscription.id)).toMatchObject({
      readCursorItemId: second.id,
    });
    expect(await store.getItemState(user.id, first.id)).toEqual({
      itemId: first.id,
      userId: user.id,
      isRead: 0,
      isStarred: 0,
      starredAt: null,
    });
    expect(await store.getItemState(user.id, third.id)).toBeNull();
  });
});
