import {
  CSRF_TTL,
  type EntryStore,
  editLabel,
  listEntries,
  listEntryIds,
  markAllRead,
  markEntries,
} from "@headrss/core";
import type { Context, Hono } from "hono";
import { requireCsrf } from "./auth.js";
import { gReaderIdToNumericId, numericIdToGReaderShortId } from "./id.js";
import {
  badRequest,
  buildGReaderItem,
  decodeContinuationToken,
  encodeContinuationToken,
  type GReaderAppEnv,
  getFirstParam,
  getParamValues,
  getUserId,
  loadFeedsById,
  parseOptionalInteger,
  parseStreamCount,
} from "./shared.js";
import {
  parseStreamId,
  READ_STREAM_ID,
  STARRED_STREAM_ID,
  toFeedStreamId,
} from "./stream-id.js";
import type { TokenSignerLike } from "./token-signer.js";

interface StreamRouteDependencies {
  store: EntryStore;
  tokenSigner: TokenSignerLike<Record<string, unknown>>;
}

export function registerStreamRoutes(
  app: Hono<GReaderAppEnv>,
  deps: StreamRouteDependencies,
): void {
  app.get("/reader/api/0/token", async (c) =>
    c.text(
      await deps.tokenSigner.sign(
        {
          kind: "csrf",
          userId: getUserId(c),
        },
        CSRF_TTL,
      ),
    ),
  );

  app.get("/reader/api/0/stream/items/ids", async (c) => {
    return handleStreamItemIds(c, deps.store);
  });
  app.post("/reader/api/0/stream/items/ids", async (c) => {
    return handleStreamItemIds(c, deps.store);
  });

  app.get("/reader/api/0/stream/items/contents", async (c) => {
    return handleStreamItemContents(c, deps.store);
  });
  app.post("/reader/api/0/stream/items/contents", async (c) => {
    return handleStreamItemContents(c, deps.store);
  });

  app.get("/reader/api/0/stream/contents", async (c) => {
    return handleStreamContents(c, deps.store);
  });
  app.get("/reader/api/0/stream/contents/*", async (c) => {
    return handleStreamContents(c, deps.store);
  });

  app.post(
    "/reader/api/0/edit-tag",
    requireCsrf(deps.tokenSigner),
    async (c) => {
      const userId = getUserId(c);
      const ids = await getParamValues(c, "i");
      const addTags = await getParamValues(c, "a");
      const removeTags = await getParamValues(c, "r");

      if (ids.length === 0) {
        badRequest("At least one i parameter is required.");
      }

      const numericIds = ids.map(decodeGReaderNumericId);
      const entries = await deps.store.getEntriesByNumericIds(
        userId,
        numericIds,
      );
      const publicIds = entries.map((e) => e.publicId);
      const read = resolveBooleanTag(addTags, removeTags, READ_STREAM_ID);
      const starred = resolveBooleanTag(addTags, removeTags, STARRED_STREAM_ID);
      const addLabelIds = await resolveLabelIdsForAdd(
        deps.store,
        userId,
        addTags,
      );
      const removeLabelIds = await resolveLabelIdsForRemove(
        deps.store,
        userId,
        removeTags,
      );

      await markEntries(deps.store, {
        userId,
        publicIds,
        ...(read !== undefined ? { read } : {}),
        ...(starred !== undefined ? { starred } : {}),
        ...(addLabelIds.length > 0 ? { addLabelIds } : {}),
        ...(removeLabelIds.length > 0 ? { removeLabelIds } : {}),
      });

      return c.text("OK");
    },
  );

  app.post(
    "/reader/api/0/mark-all-as-read",
    requireCsrf(deps.tokenSigner),
    async (c) => {
      const streamId = await getFirstParam(c, "s");

      if (streamId === undefined) {
        badRequest("s is required.");
      }

      const timestampUsec = parseOptionalInteger(
        await getFirstParam(c, "ts"),
        "ts",
      );

      await markAllRead(deps.store, {
        userId: getUserId(c),
        streamId,
        ...(timestampUsec !== undefined ? { timestampUsec } : {}),
      });

      return c.text("OK");
    },
  );
}

async function handleStreamItemIds(
  c: Context<GReaderAppEnv>,
  store: EntryStore,
): Promise<Response> {
  const filter = await parseStreamFilter(c);
  const result = await listEntryIds(store, getUserId(c), filter);
  const feeds = await loadFeedsById(
    store,
    result.entries.map((entry) => entry.feedId),
  );

  return c.json({
    itemRefs: result.entries.map((entry) => {
      const feed = feeds.get(entry.feedId);
      return {
        id: numericIdToGReaderShortId(entry.id),
        directStreamIds: feed ? [toFeedStreamId(feed.url)] : [],
        timestampUsec: String(entry.publishedAt * 1_000_000),
      };
    }),
    ...(result.continuation !== undefined
      ? { continuation: encodeContinuationToken(result.continuation) }
      : {}),
  });
}

async function handleStreamItemContents(
  c: Context<GReaderAppEnv>,
  store: EntryStore,
): Promise<Response> {
  const rawIds = await getParamValues(c, "i");
  const numericIds = rawIds.map(decodeGReaderNumericId);
  const entries =
    numericIds.length === 0
      ? []
      : await store.getEntriesByNumericIds(getUserId(c), numericIds);
  const feeds = await loadFeedsById(
    store,
    entries.map((entry) => entry.feedId),
  );

  return c.json({
    direction: "ltr",
    id: "user/-/state/com.google/reading-list",
    updated: Math.floor(Date.now() / 1000),
    items: entries.map((entry) =>
      buildGReaderItem(entry, feeds.get(entry.feedId)),
    ),
  });
}

async function handleStreamContents(
  c: Context<GReaderAppEnv>,
  store: EntryStore,
): Promise<Response> {
  const filter = await parseStreamFilter(c, resolveStreamIdFromRequest(c));
  const result = await listEntries(store, getUserId(c), filter);
  const feeds = await loadFeedsById(
    store,
    result.items.map((entry) => entry.feedId),
  );

  return c.json({
    id: filter.streamId,
    updated: Math.floor(Date.now() / 1000),
    items: result.items.map((entry) =>
      buildGReaderItem(entry, feeds.get(entry.feedId)),
    ),
    ...(result.continuation !== undefined
      ? { continuation: encodeContinuationToken(result.continuation) }
      : {}),
  });
}

async function parseStreamFilter(
  c: Context<GReaderAppEnv>,
  providedStreamId?: string,
) {
  const streamId = providedStreamId ?? (await getFirstParam(c, "s"));

  if (streamId === undefined || streamId.length === 0) {
    badRequest("s is required.");
  }

  const oldestTimestamp = parseOptionalInteger(
    await getFirstParam(c, "ot"),
    "ot",
  );
  const newestTimestamp = parseOptionalInteger(
    await getFirstParam(c, "nt"),
    "nt",
  );
  const continuation = decodeContinuationToken(await getFirstParam(c, "c"));
  const excludeTag = await getFirstParam(c, "xt");
  const includeTag = await getFirstParam(c, "it");

  return {
    streamId,
    count: parseStreamCount(await getFirstParam(c, "n")),
    ...(oldestTimestamp !== undefined ? { oldestTimestamp } : {}),
    ...(newestTimestamp !== undefined ? { newestTimestamp } : {}),
    ...(continuation !== undefined ? { continuation } : {}),
    ...(excludeTag !== undefined ? { excludeTag } : {}),
    ...(includeTag !== undefined ? { includeTag } : {}),
    sortOrder:
      (await getFirstParam(c, "r")) === "o"
        ? ("oldest" as const)
        : ("newest" as const),
  };
}

const STREAM_CONTENTS_PREFIX = "/reader/api/0/stream/contents/";

function resolveStreamIdFromRequest(
  c: Context<GReaderAppEnv>,
): string | undefined {
  const suffix = c.req.param("*");
  if (suffix !== undefined && suffix !== "") {
    return decodeURIComponent(suffix);
  }

  const path = c.req.path;
  const idx = path.indexOf(STREAM_CONTENTS_PREFIX);
  if (idx !== -1) {
    const raw = path.slice(idx + STREAM_CONTENTS_PREFIX.length);
    if (raw.length > 0) {
      return decodeURIComponent(raw);
    }
  }

  return undefined;
}

function decodeGReaderNumericId(grId: string): number {
  try {
    return gReaderIdToNumericId(grId);
  } catch (error) {
    if (error instanceof Error) {
      badRequest(error.message);
    }

    badRequest("Invalid Google Reader item ID.");
  }
}

function resolveBooleanTag(
  addTags: ReadonlyArray<string>,
  removeTags: ReadonlyArray<string>,
  tag: string,
): boolean | undefined {
  const shouldAdd = addTags.includes(tag);
  const shouldRemove = removeTags.includes(tag);

  if (shouldAdd && shouldRemove) {
    badRequest(`Conflicting tag mutation for ${tag}.`);
  }

  if (shouldAdd) {
    return true;
  }

  if (shouldRemove) {
    return false;
  }

  return undefined;
}

async function resolveLabelIdsForAdd(
  store: EntryStore,
  userId: number,
  tags: ReadonlyArray<string>,
): Promise<number[]> {
  const labelIds: number[] = [];

  for (const tag of tags) {
    if (tag === READ_STREAM_ID || tag === STARRED_STREAM_ID) {
      continue;
    }

    const parsed = parseStreamId(tag);

    if (parsed.kind !== "label") {
      badRequest(`Unsupported item tag: ${tag}`);
    }

    const label = await editLabel(store, {
      action: "create",
      userId,
      name: parsed.labelName,
    });

    if (label === null) {
      badRequest(`Failed to create label for tag: ${tag}`);
    }

    labelIds.push(label.id);
  }

  return [...new Set(labelIds)];
}

async function resolveLabelIdsForRemove(
  store: EntryStore,
  userId: number,
  tags: ReadonlyArray<string>,
): Promise<number[]> {
  const labelIds: number[] = [];

  for (const tag of tags) {
    if (tag === READ_STREAM_ID || tag === STARRED_STREAM_ID) {
      continue;
    }

    const parsed = parseStreamId(tag);

    if (parsed.kind !== "label") {
      badRequest(`Unsupported item tag: ${tag}`);
    }

    const label = await store.getLabelByName(userId, parsed.labelName);

    if (label !== null) {
      labelIds.push(label.id);
    }
  }

  return [...new Set(labelIds)];
}
