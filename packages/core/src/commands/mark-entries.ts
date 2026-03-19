import { ENTRIES_PER_BATCH_QUERY } from "../constants.js";
import { chunkArray } from "../internal/chunk.js";
import type { EntryStore } from "../ports/entry-store.js";
import type { EntryView } from "../ports/entry-store.js";
import type { ItemState } from "../types.js";

export interface MarkEntriesInput {
  userId: number;
  publicIds: ReadonlyArray<string>;
  read?: boolean;
  starred?: boolean;
  starredAt?: number;
  addLabelIds?: ReadonlyArray<number>;
  removeLabelIds?: ReadonlyArray<number>;
}

interface ResolvedEntryContext {
  entry: EntryView;
  userId: number;
  cursor: number;
  state: ItemState | null;
}

export async function markEntries(
  store: EntryStore,
  input: MarkEntriesInput,
): Promise<void> {
  const addLabelIds = dedupeNumbers(input.addLabelIds ?? []);
  const removeLabelIds = dedupeNumbers(input.removeLabelIds ?? []);
  await validateOwnedLabels(store, input.userId, [...addLabelIds, ...removeLabelIds]);

  const entries = await loadEntriesByPublicIds(
    store,
    input.userId,
    dedupeStrings(input.publicIds),
  );

  if (entries.length === 0) {
    return;
  }

  const contexts = await buildEntryContexts(store, input.userId, entries);
  const starredAt = input.starred === true ? (input.starredAt ?? nowInSeconds()) : null;

  for (const context of contexts) {
    const nextState = resolveNextState(context, input.read, input.starred, starredAt);

    if (nextState === null) {
      await store.deleteItemState(input.userId, context.entry.id);
    } else {
      await store.upsertItemState(nextState);
    }

    for (const labelId of addLabelIds) {
      await store.addItemLabel({
        userId: input.userId,
        itemId: context.entry.id,
        labelId,
      });
    }

    for (const labelId of removeLabelIds) {
      await store.removeItemLabel(input.userId, context.entry.id, labelId);
    }
  }
}

async function loadEntriesByPublicIds(
  store: EntryStore,
  userId: number,
  publicIds: ReadonlyArray<string>,
): Promise<EntryView[]> {
  const entries: EntryView[] = [];

  for (const batch of chunkArray(publicIds, ENTRIES_PER_BATCH_QUERY)) {
    entries.push(...(await store.getEntriesByPublicIds(userId, batch)));
  }

  return entries;
}

async function buildEntryContexts(
  store: EntryStore,
  userId: number,
  entries: ReadonlyArray<EntryView>,
): Promise<ResolvedEntryContext[]> {
  const subscriptionByFeedId = new Map<number, number>();

  for (const entry of entries) {
    if (!subscriptionByFeedId.has(entry.feedId)) {
      const subscription = await store.getSubscriptionByUserAndFeed(userId, entry.feedId);

      if (subscription !== null) {
        subscriptionByFeedId.set(entry.feedId, subscription.readCursorItemId ?? 0);
      }
    }
  }

  const itemStates = await store.listItemStates(
    userId,
    entries.map((entry) => entry.id),
  );
  const stateByItemId = new Map(itemStates.map((state) => [state.itemId, state]));

  return entries
    .filter((entry) => subscriptionByFeedId.has(entry.feedId))
    .map((entry) => ({
      entry,
      userId,
      cursor: subscriptionByFeedId.get(entry.feedId) ?? 0,
      state: stateByItemId.get(entry.id) ?? null,
    }));
}

function resolveNextState(
  context: ResolvedEntryContext,
  read: boolean | undefined,
  starred: boolean | undefined,
  starredAt: number | null,
): ItemState | null {
  let isRead = context.state?.isRead ?? null;
  let isStarred = context.state?.isStarred ?? 0;
  let nextStarredAt = context.state?.starredAt ?? null;

  if (read !== undefined) {
    isRead = resolveReadOverride(context.entry.id, context.cursor, read);
  }

  if (starred !== undefined) {
    isStarred = starred ? 1 : 0;
    nextStarredAt = starred ? starredAt : null;
  }

  if (isRead === null && isStarred === 0) {
    return null;
  }

  return {
    itemId: context.entry.id,
    userId: context.userId,
    isRead,
    isStarred,
    starredAt: nextStarredAt,
  };
}

function resolveReadOverride(
  itemId: number,
  cursor: number,
  read: boolean,
): number | null {
  const isReadByDefault = itemId <= cursor;

  if (read === isReadByDefault) {
    return null;
  }

  return read ? 1 : 0;
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

function dedupeStrings(values: ReadonlyArray<string>): string[] {
  return [...new Set(values)];
}

function dedupeNumbers(values: ReadonlyArray<number>): number[] {
  return [...new Set(values)];
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
