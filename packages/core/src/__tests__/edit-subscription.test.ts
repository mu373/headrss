import { describe, expect, it } from "vitest";

import { editSubscription } from "../commands/edit-subscription.js";
import type { EntryStore } from "../ports/entry-store.js";
import { InMemoryEntryStore } from "../test-support/entry-store.mock.js";

describe("editSubscription", () => {
  it("subscribes by upserting a placeholder feed and assigning labels", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const label = store.seedLabel({ userId: user.id, name: "Tech" });

    const subscription = await editSubscription(
      store as unknown as EntryStore,
      {
        action: "subscribe",
        userId: user.id,
        feedUrl: "https://example.com/feed.xml",
        customTitle: "Example Feed",
        labelIds: [label.id],
      },
    );

    expect(subscription).not.toBeNull();
    expect(
      await store.getFeedByUrl("https://example.com/feed.xml"),
    ).toMatchObject({
      title: null,
    });
    expect(await store.listSubscriptionLabels(subscription!.id)).toEqual([
      label,
    ]);
  });

  it("renames, moves, and unsubscribes a subscription", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const feed = store.seedFeed({ url: "https://example.com/feed.xml" });
    const label = store.seedLabel({ userId: user.id, name: "News" });
    const subscription = store.seedSubscription({
      userId: user.id,
      feedId: feed.id,
      customTitle: "Old Title",
    });

    await editSubscription(store as unknown as EntryStore, {
      action: "rename",
      userId: user.id,
      subscriptionId: subscription.id,
      customTitle: "New Title",
    });
    expect(await store.getSubscriptionById(subscription.id)).toMatchObject({
      customTitle: "New Title",
    });

    await editSubscription(store as unknown as EntryStore, {
      action: "move",
      userId: user.id,
      subscriptionId: subscription.id,
      labelIds: [label.id],
    });
    expect(await store.listSubscriptionLabels(subscription.id)).toEqual([
      label,
    ]);

    await editSubscription(store as unknown as EntryStore, {
      action: "unsubscribe",
      userId: user.id,
      subscriptionId: subscription.id,
    });
    expect(await store.getSubscriptionById(subscription.id)).toBeNull();
    expect(await store.listSubscriptionLabels(subscription.id)).toEqual([]);
  });

  it("rejects assigning a label owned by another user", async () => {
    const store = new InMemoryEntryStore();
    const user = store.seedUser({ username: "alice" });
    const otherUser = store.seedUser({ username: "bob" });
    const foreignLabel = store.seedLabel({
      userId: otherUser.id,
      name: "Other",
    });

    await expect(
      editSubscription(store as unknown as EntryStore, {
        action: "subscribe",
        userId: user.id,
        feedUrl: "https://example.com/feed.xml",
        labelIds: [foreignLabel.id],
      }),
    ).rejects.toThrow("Label ownership mismatch.");
  });
});
