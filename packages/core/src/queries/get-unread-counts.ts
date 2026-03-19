import type { EntryStore } from "../ports/entry-store.js";
import type { UnreadCount } from "../types.js";

export async function getUnreadCounts(
  store: EntryStore,
  userId: number,
): Promise<UnreadCount[]> {
  return store.getUnreadCounts(userId);
}
