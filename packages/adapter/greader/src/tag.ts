import {
  editLabel,
  listLabels,
  type EntryStore,
} from "@headrss/core";
import type { Hono } from "hono";
import {
  READ_STREAM_ID,
  READING_LIST_STREAM_ID,
  STARRED_STREAM_ID,
  parseStreamId,
  toLabelStreamId,
} from "./stream-id.js";

import { requireCsrf } from "./auth.js";
import {
  badRequest,
  getFirstParam,
  getUserId,
  type GReaderAppEnv,
  toSortId,
} from "./shared.js";
import type { TokenSignerLike } from "./token-signer.js";

interface TagRouteDependencies {
  store: EntryStore;
  tokenSigner: TokenSignerLike<Record<string, unknown>>;
}

export function registerTagRoutes(
  app: Hono<GReaderAppEnv>,
  deps: TagRouteDependencies,
): void {
  app.get("/reader/api/0/tag/list", async (c) => {
    const labels = await listLabels(deps.store, getUserId(c));

    return c.json({
      tags: [
        {
          id: READING_LIST_STREAM_ID,
          sortid: "0000000000000001",
          type: "state",
        },
        {
          id: READ_STREAM_ID,
          sortid: "0000000000000002",
          type: "state",
        },
        {
          id: STARRED_STREAM_ID,
          sortid: "0000000000000003",
          type: "state",
        },
        ...labels.map((label) => ({
          id: toLabelStreamId(label.name),
          sortid: toSortId(label.id),
          type: "label",
        })),
      ],
    });
  });

  app.post(
    "/reader/api/0/rename-tag",
    requireCsrf(deps.tokenSigner),
    async (c) => {
      const userId = getUserId(c);
      const source = await getFirstParam(c, "s");
      const dest = await getFirstParam(c, "dest");

      if (source === undefined || dest === undefined) {
        badRequest("s and dest are required.");
      }

      const sourceLabel = await requireUserLabel(deps.store, userId, source);
      const destName = parseLabelName(dest);

      await editLabel(deps.store, {
        action: "rename",
        userId,
        labelId: sourceLabel.id,
        name: destName,
      });

      return c.text("OK");
    },
  );

  app.post(
    "/reader/api/0/disable-tag",
    requireCsrf(deps.tokenSigner),
    async (c) => {
      const userId = getUserId(c);
      const source = await getFirstParam(c, "s");

      if (source === undefined) {
        badRequest("s is required.");
      }

      const label = await requireUserLabel(deps.store, userId, source);

      await editLabel(deps.store, {
        action: "delete",
        userId,
        labelId: label.id,
        target: "folder",
      });
      await editLabel(deps.store, {
        action: "delete",
        userId,
        labelId: label.id,
        target: "item-label",
      });

      return c.text("OK");
    },
  );
}

async function requireUserLabel(
  store: EntryStore,
  userId: number,
  value: string,
) {
  const labelName = parseLabelName(value);
  const label = await store.getLabelByName(userId, labelName);

  if (label === null) {
    badRequest("Label was not found.");
  }

  return label;
}

function parseLabelName(value: string): string {
  if (!value.includes("/")) {
    return value;
  }

  const parsed = parseStreamId(value);

  if (parsed.kind !== "label") {
    badRequest(`Unsupported label stream: ${value}`);
  }

  return parsed.labelName;
}
