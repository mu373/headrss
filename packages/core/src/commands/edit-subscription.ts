import type { EntryStore } from "../ports/entry-store.js";
import type { Subscription } from "../types.js";

export type EditSubscriptionInput =
  | {
      action: "subscribe";
      userId: number;
      feedUrl: string;
      customTitle?: string | null;
      labelIds?: ReadonlyArray<number>;
    }
  | {
      action: "unsubscribe";
      userId: number;
      subscriptionId?: number;
      feedUrl?: string;
    }
  | {
      action: "rename";
      userId: number;
      subscriptionId: number;
      customTitle: string | null;
    }
  | {
      action: "move";
      userId: number;
      subscriptionId: number;
      labelIds: ReadonlyArray<number>;
    };

export async function editSubscription(
  store: EntryStore,
  input: EditSubscriptionInput,
): Promise<Subscription | null> {
  switch (input.action) {
    case "subscribe":
      return subscribe(store, input);
    case "unsubscribe":
      return unsubscribe(store, input);
    case "rename":
      return renameSubscription(store, input);
    case "move":
      return moveSubscription(store, input);
  }
}

async function subscribe(
  store: EntryStore,
  input: Extract<EditSubscriptionInput, { action: "subscribe" }>,
): Promise<Subscription> {
  const labelIds = dedupeNumbers(input.labelIds ?? []);
  await validateOwnedLabels(store, input.userId, labelIds);

  const feed = await store.upsertFeed({ url: input.feedUrl });
  const existing = await store.getSubscriptionByUserAndFeed(input.userId, feed.id);
  const subscription =
    existing ??
    (await store.createSubscription({
      userId: input.userId,
      feedId: feed.id,
      customTitle: input.customTitle ?? null,
    }));

  if (existing !== null && input.customTitle !== undefined) {
    const updated = await store.updateSubscription(subscription.id, {
      customTitle: input.customTitle,
    });

    if (updated !== null) {
      return replaceLabelsIfNeeded(store, updated, labelIds, input.labelIds !== undefined);
    }
  }

  return replaceLabelsIfNeeded(store, subscription, labelIds, input.labelIds !== undefined);
}

async function unsubscribe(
  store: EntryStore,
  input: Extract<EditSubscriptionInput, { action: "unsubscribe" }>,
): Promise<null> {
  const subscription = await resolveSubscription(store, input.userId, input);

  if (subscription !== null) {
    await store.deleteSubscription(subscription.id);
  }

  return null;
}

async function renameSubscription(
  store: EntryStore,
  input: Extract<EditSubscriptionInput, { action: "rename" }>,
): Promise<Subscription> {
  const subscription = await requireOwnedSubscription(
    store,
    input.userId,
    input.subscriptionId,
  );
  const updated = await store.updateSubscription(subscription.id, {
    customTitle: input.customTitle,
  });

  if (updated === null) {
    throw new Error(`Subscription ${subscription.id} was not found.`);
  }

  return updated;
}

async function moveSubscription(
  store: EntryStore,
  input: Extract<EditSubscriptionInput, { action: "move" }>,
): Promise<Subscription> {
  const subscription = await requireOwnedSubscription(
    store,
    input.userId,
    input.subscriptionId,
  );
  const labelIds = dedupeNumbers(input.labelIds);

  await validateOwnedLabels(store, input.userId, labelIds);
  await store.replaceSubscriptionLabels(subscription.id, labelIds);

  return subscription;
}

async function replaceLabelsIfNeeded(
  store: EntryStore,
  subscription: Subscription,
  labelIds: number[],
  shouldReplace: boolean,
): Promise<Subscription> {
  if (shouldReplace) {
    await store.replaceSubscriptionLabels(subscription.id, labelIds);
  }

  return subscription;
}

async function resolveSubscription(
  store: EntryStore,
  userId: number,
  input: { subscriptionId?: number; feedUrl?: string },
): Promise<Subscription | null> {
  if (input.subscriptionId !== undefined) {
    const subscription = await store.getSubscriptionById(input.subscriptionId);

    if (subscription === null) {
      return null;
    }

    if (subscription.userId !== userId) {
      throw new Error("Subscription ownership mismatch.");
    }

    return subscription;
  }

  if (input.feedUrl !== undefined) {
    const feed = await store.getFeedByUrl(input.feedUrl);

    if (feed === null) {
      return null;
    }

    return store.getSubscriptionByUserAndFeed(userId, feed.id);
  }

  throw new Error("A subscriptionId or feedUrl is required.");
}

async function requireOwnedSubscription(
  store: EntryStore,
  userId: number,
  subscriptionId: number,
): Promise<Subscription> {
  const subscription = await store.getSubscriptionById(subscriptionId);

  if (subscription === null) {
    throw new Error(`Subscription ${subscriptionId} was not found.`);
  }

  if (subscription.userId !== userId) {
    throw new Error("Subscription ownership mismatch.");
  }

  return subscription;
}

async function validateOwnedLabels(
  store: EntryStore,
  userId: number,
  labelIds: ReadonlyArray<number>,
): Promise<void> {
  for (const labelId of dedupeNumbers(labelIds)) {
    const label = await store.getLabelById(labelId);

    if (label === null) {
      throw new Error(`Label ${labelId} was not found.`);
    }

    if (label.userId !== userId) {
      throw new Error("Label ownership mismatch.");
    }
  }
}

function dedupeNumbers(values: ReadonlyArray<number>): number[] {
  return [...new Set(values)];
}
