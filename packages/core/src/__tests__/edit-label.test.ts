import { describe, expect, it } from "vitest";

import { editLabel } from "../commands/edit-label.js";
import type { EntryStore } from "../ports/entry-store.js";
import { InMemoryEntryStore } from "../test-support/entry-store.mock.js";

describe("editLabel", () => {
  it("creates a label and reuses the existing row for the same name", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });

    const first = await editLabel(store as unknown as EntryStore, {
      action: "create",
      userId: user.id,
      name: "Work",
    });
    const second = await editLabel(store as unknown as EntryStore, {
      action: "create",
      userId: user.id,
      name: "Work",
    });

    expect(first).toEqual(second);
  });

  it("renames a label and rejects cross-user ownership violations", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const otherUser = store.seedUser({ username: "bob" });
    const label = store.seedLabel({ userId: user.id, name: "Old" });
    const foreign = store.seedLabel({ userId: otherUser.id, name: "Foreign" });

    await expect(
      editLabel(store as unknown as EntryStore, {
        action: "rename",
        userId: user.id,
        labelId: label.id,
        name: "New",
      }),
    ).resolves.toMatchObject({ name: "New" });

    await expect(
      editLabel(store as unknown as EntryStore, {
        action: "delete",
        userId: user.id,
        labelId: foreign.id,
        target: "folder",
      }),
    ).rejects.toThrow("Label ownership mismatch.");
  });

  it("deletes folder assignments but preserves the label row while item labels still exist", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const label = store.seedLabel({ userId: user.id, name: "Work" });
    const subscription = store.seedSubscription({ userId: user.id, feedId: feed.id });
    const entry = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });

    store.seedSubscriptionLabel(subscription.id, label.id);
    store.seedItemLabel(user.id, entry.id, label.id);

    await editLabel(store as unknown as EntryStore, {
      action: "delete",
      userId: user.id,
      labelId: label.id,
      target: "folder",
    });

    expect(await store.listSubscriptionLabels(subscription.id)).toEqual([]);
    expect(await store.listItemLabels(user.id, entry.id)).toEqual([label]);
    expect(await store.getLabelById(label.id)).toEqual(label);
  });

  it("deletes item-label assignments but preserves the label row while subscription labels still exist", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const label = store.seedLabel({ userId: user.id, name: "Work" });
    const subscription = store.seedSubscription({ userId: user.id, feedId: feed.id });
    const entry = store.seedEntry({ feedId: feed.id, publicId: "entry-1", publishedAt: 100 });

    store.seedSubscriptionLabel(subscription.id, label.id);
    store.seedItemLabel(user.id, entry.id, label.id);

    await editLabel(store as unknown as EntryStore, {
      action: "delete",
      userId: user.id,
      labelId: label.id,
      target: "item-label",
    });

    expect(await store.listItemLabels(user.id, entry.id)).toEqual([]);
    expect(await store.listSubscriptionLabels(subscription.id)).toEqual([label]);
    expect(await store.getLabelById(label.id)).toEqual(label);
  });
});
