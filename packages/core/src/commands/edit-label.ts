import type { EntryStore } from "../ports/entry-store.js";
import type { Label } from "../types.js";

export type EditLabelInput =
  | {
      action: "create";
      userId: number;
      name: string;
    }
  | {
      action: "rename";
      userId: number;
      labelId: number;
      name: string;
    }
  | {
      action: "delete";
      userId: number;
      labelId: number;
      target: "folder" | "item-label";
    };

export async function editLabel(
  store: EntryStore,
  input: EditLabelInput,
): Promise<Label | null> {
  switch (input.action) {
    case "create":
      return createLabel(store, input);
    case "rename":
      return renameLabel(store, input);
    case "delete":
      return deleteLabel(store, input);
  }
}

async function createLabel(
  store: EntryStore,
  input: Extract<EditLabelInput, { action: "create" }>,
): Promise<Label> {
  const existing = await store.getLabelByName(input.userId, input.name);

  if (existing !== null) {
    return existing;
  }

  return store.createLabel({
    userId: input.userId,
    name: input.name,
  });
}

async function renameLabel(
  store: EntryStore,
  input: Extract<EditLabelInput, { action: "rename" }>,
): Promise<Label> {
  const label = await requireOwnedLabel(store, input.userId, input.labelId);

  if (label.name === input.name) {
    return label;
  }

  const existing = await store.getLabelByName(input.userId, input.name);

  if (existing !== null && existing.id !== label.id) {
    throw new Error("Label name already exists.");
  }

  const updated = await store.updateLabel(label.id, { name: input.name });

  if (updated === null) {
    throw new Error(`Label ${label.id} was not found.`);
  }

  return updated;
}

async function deleteLabel(
  store: EntryStore,
  input: Extract<EditLabelInput, { action: "delete" }>,
): Promise<null> {
  await requireOwnedLabel(store, input.userId, input.labelId);

  if (input.target === "folder") {
    await store.deleteSubscriptionLabelsByLabelId(input.labelId);

    if (!(await store.hasItemLabelReferences(input.userId, input.labelId))) {
      await store.deleteLabel(input.labelId);
    }

    return null;
  }

  await store.deleteItemLabelsByLabelId(input.userId, input.labelId);

  if (!(await store.hasSubscriptionLabelReferences(input.labelId))) {
    await store.deleteLabel(input.labelId);
  }

  return null;
}

async function requireOwnedLabel(
  store: EntryStore,
  userId: number,
  labelId: number,
): Promise<Label> {
  const label = await store.getLabelById(labelId);

  if (label === null) {
    throw new Error(`Label ${labelId} was not found.`);
  }

  if (label.userId !== userId) {
    throw new Error("Label ownership mismatch.");
  }

  return label;
}
