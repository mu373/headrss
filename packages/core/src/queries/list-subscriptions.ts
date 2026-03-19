import type { EntryStore, SubscriptionView } from "../ports/entry-store.js";

export async function listSubscriptions(
  store: EntryStore,
  userId: number,
): Promise<SubscriptionView[]> {
  return store.listSubscriptionsByUserId(userId);
}
