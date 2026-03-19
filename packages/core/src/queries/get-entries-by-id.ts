import { ENTRIES_PER_BATCH_QUERY } from "../constants.js";
import { chunkArray } from "../internal/chunk.js";
import type { EntryStore, EntryView } from "../ports/entry-store.js";

export async function getEntriesById(
  store: EntryStore,
  userId: number,
  publicIds: ReadonlyArray<string>,
): Promise<EntryView[]> {
  const uniquePublicIds = [...new Set(publicIds)];
  const entriesById = new Map<string, EntryView>();

  for (const batch of chunkArray(uniquePublicIds, ENTRIES_PER_BATCH_QUERY)) {
    for (const entry of await store.getEntriesByPublicIds(userId, batch)) {
      entriesById.set(entry.publicId, entry);
    }
  }

  return publicIds
    .map((publicId) => entriesById.get(publicId))
    .filter((entry): entry is EntryView => entry !== undefined);
}
