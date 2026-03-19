import type { EntryStore } from "../ports/entry-store.js";
import type { Label } from "../types.js";

export async function listLabels(
  store: EntryStore,
  userId: number,
): Promise<Label[]> {
  return store.listLabelsByUserId(userId);
}
