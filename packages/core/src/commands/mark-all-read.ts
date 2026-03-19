import { parseStreamId, READING_LIST_STREAM_ID } from "../internal/stream-id.js";
import type { EntryStore } from "../ports/entry-store.js";
import type { Subscription } from "../types.js";

export interface MarkAllReadInput {
  userId: number;
  streamId: string;
  timestampUsec?: number;
}

export async function markAllRead(
  store: EntryStore,
  input: MarkAllReadInput,
): Promise<void> {
  const cutoffSeconds = input.timestampUsec === undefined
    ? undefined
    : Math.floor(input.timestampUsec / 1_000_000);
  const subscriptionIds = await resolveSubscriptionIdsForStream(
    store,
    input.userId,
    input.streamId,
  );

  for (const subscriptionId of subscriptionIds) {
    const subscription = await store.getSubscriptionById(subscriptionId);

    if (subscription === null || subscription.userId !== input.userId) {
      continue;
    }

    await markSubscriptionRead(store, subscription, cutoffSeconds);
  }
}

async function resolveSubscriptionIdsForStream(
  store: EntryStore,
  userId: number,
  streamId: string,
): Promise<number[]> {
  const parsed = parseStreamId(streamId);

  if (parsed.kind === "feed") {
    const feed = await store.getFeedByUrl(parsed.feedUrl);

    if (feed === null) {
      return [];
    }

    const subscription = await store.getSubscriptionByUserAndFeed(userId, feed.id);

    return subscription === null ? [] : [subscription.id];
  }

  if (parsed.kind === "label") {
    const label = await store.getLabelByName(userId, parsed.labelName);

    if (label === null) {
      return [];
    }

    return store.listSubscriptionIdsByLabel(userId, label.id);
  }

  if (streamId === READING_LIST_STREAM_ID) {
    const subscriptions = await store.listSubscriptionsByUserId(userId);
    return subscriptions.map((subscription) => subscription.id);
  }

  throw new Error(`Unsupported mark-all-read stream: ${streamId}`);
}

async function markSubscriptionRead(
  store: EntryStore,
  subscription: Subscription,
  cutoffSeconds?: number,
): Promise<void> {
  const oldCursor = subscription.readCursorItemId ?? 0;
  const maxItemId = await store.getMaxItemIdForFeed(
    subscription.feedId,
    cutoffSeconds,
  );

  if (maxItemId === null) {
    return;
  }

  const nextCursor = Math.max(oldCursor, maxItemId);

  if (nextCursor <= oldCursor) {
    return;
  }

  await store.setSubscriptionReadCursor(subscription.id, nextCursor);
  await store.cleanStaleOverrides(subscription.userId, subscription.feedId, nextCursor);

  if (cutoffSeconds !== undefined) {
    await store.protectPostCutoffItems(
      subscription.userId,
      subscription.feedId,
      oldCursor,
      nextCursor,
      cutoffSeconds,
    );
  }
}
