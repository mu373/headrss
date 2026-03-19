import type { EntryStore } from "../ports/entry-store.js";
import type { ContinuationToken, StreamFilter } from "../types.js";

export interface ListEntryIdsResult {
  ids: string[];
  continuation?: ContinuationToken;
}

export async function listEntryIds(
  store: EntryStore,
  userId: number,
  filter: StreamFilter,
): Promise<ListEntryIdsResult> {
  const result = await store.listEntryIds(userId, filter);

  if (result.continuation === undefined) {
    return {
      ids: result.items.map((item) => item.publicId),
    };
  }

  return {
    ids: result.items.map((item) => item.publicId),
    continuation: result.continuation,
  };
}
