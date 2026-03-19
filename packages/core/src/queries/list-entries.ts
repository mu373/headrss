import type { EntryStore, PaginatedResult, EntryView } from "../ports/entry-store.js";
import type { StreamFilter } from "../types.js";

export async function listEntries(
  store: EntryStore,
  userId: number,
  filter: StreamFilter,
): Promise<PaginatedResult<EntryView>> {
  return store.listEntries(userId, filter);
}
