import type { EntryReference, EntryStore } from "../ports/entry-store.js";
import type { ContinuationToken, StreamFilter } from "../types.js";

export interface ListEntryIdsResult {
  ids: string[];
  entries: EntryReference[];
  continuation?: ContinuationToken;
}

export async function listEntryIds(
  store: EntryStore,
  userId: number,
  filter: StreamFilter,
): Promise<ListEntryIdsResult> {
  const result = await store.listEntryIds(userId, filter);

  return {
    ids: result.items.map((item) => item.publicId),
    entries: result.items,
    ...(result.continuation !== undefined
      ? { continuation: result.continuation }
      : {}),
  };
}
