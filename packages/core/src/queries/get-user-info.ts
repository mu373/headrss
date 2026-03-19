import type { EntryStore } from "../ports/entry-store.js";
import type { User } from "../types.js";

export async function getUserInfo(
  store: EntryStore,
  userId: number,
): Promise<User | null> {
  return store.getUserById(userId);
}
