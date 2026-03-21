import { DomainError } from "../errors.js";
import type { EntryStore } from "../ports/entry-store.js";

export async function validateOwnedLabels(
  store: EntryStore,
  userId: number,
  labelIds: ReadonlyArray<number>,
): Promise<void> {
  for (const labelId of dedupeNumbers(labelIds)) {
    const label = await store.getLabelById(labelId);

    if (label === null) {
      throw new DomainError("NOT_FOUND", `Label ${labelId} was not found.`);
    }

    if (label.userId !== userId) {
      throw new DomainError("OWNERSHIP_MISMATCH", "Label ownership mismatch.");
    }
  }
}

export function dedupeNumbers(values: ReadonlyArray<number>): number[] {
  return [...new Set(values)];
}
