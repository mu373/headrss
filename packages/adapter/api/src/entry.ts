import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  editLabel,
  getEntriesById,
  listEntries,
  listLabels,
  markEntries,
} from "@headrss/core";
import type { EntryStore } from "@headrss/core";
import { createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  ApiError,
  encodeContinuationToken,
  errorResponseSchema,
  idPathParam,
  labelSchema,
  listEntriesResponseSchema,
  listLabelsResponseSchema,
  okResponseSchema,
  parseContinuationToken,
  publicIdPathParam,
  requireFeed,
  requireOwnedLabel,
  timestampSchema,
  toNativeEntry,
  entrySchema,
} from "./shared.js";
import type { NativeApiEnv } from "./shared.js";
import {
  READ_STREAM_ID,
  READING_LIST_STREAM_ID,
  STARRED_STREAM_ID,
  toFeedStreamId,
  toLabelStreamId,
} from "./stream-id.js";

const entryPathParamsSchema = z.object({
  id: publicIdPathParam("id"),
});

const labelPathParamsSchema = z.object({
  id: idPathParam("id"),
});

const booleanQuerySchema = z
  .enum(["true", "false"])
  .transform((value) => value === "true")
  .optional();

const listEntriesQuerySchema = z
  .object({
    continuation: z
      .string()
      .regex(/^\d+:\d+$/, "Expected continuation token in publishedAt:id format.")
      .optional(),
    feed: z.coerce.number().int().positive().optional(),
    folder: z.coerce.number().int().positive().optional(),
    label: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    starred: booleanQuerySchema,
    unread: booleanQuerySchema,
  })
  .refine(
    (query) => !(query.feed !== undefined && query.folder !== undefined),
    "Only one of feed or folder may be provided.",
  );

const updateEntryBodySchema = z
  .object({
    labels: z.array(z.number().int().positive()).optional(),
    read: z.boolean().optional(),
    starred: z.boolean().optional(),
  })
  .refine(
    (value) =>
      value.read !== undefined ||
      value.starred !== undefined ||
      value.labels !== undefined,
    "At least one of read, starred, or labels is required.",
  );

const createLabelBodySchema = z.object({
  name: z.string().min(1),
});

const listEntriesRoute = createRoute({
  method: "get",
  path: "/entries",
  request: {
    query: listEntriesQuerySchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: listEntriesResponseSchema,
        },
      },
      description: "Entries for the authenticated user.",
    },
    400: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Invalid request.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
    404: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Feed or label not found.",
    },
  },
});

const getEntryRoute = createRoute({
  method: "get",
  path: "/entries/{id}",
  request: {
    params: entryPathParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: entrySchema,
        },
      },
      description: "Single entry.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
    404: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Entry not found.",
    },
  },
});

const updateEntryRoute = createRoute({
  method: "put",
  path: "/entries/{id}",
  request: {
    params: entryPathParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateEntryBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: entrySchema,
        },
      },
      description: "Updated entry state.",
    },
    400: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Invalid request.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
    404: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Entry or label not found.",
    },
  },
});

const listLabelsRoute = createRoute({
  method: "get",
  path: "/labels",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: listLabelsResponseSchema,
        },
      },
      description: "Item labels for the authenticated user.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
  },
});

const createLabelRoute = createRoute({
  method: "post",
  path: "/labels",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createLabelBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: labelSchema,
        },
      },
      description: "Created or reused label.",
    },
    400: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Invalid request.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
  },
});

const deleteLabelRoute = createRoute({
  method: "delete",
  path: "/labels/{id}",
  request: {
    params: labelPathParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: okResponseSchema,
        },
      },
      description: "Label deleted.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
    404: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Label not found.",
    },
  },
});

interface EntryRouteDeps {
  authMiddleware: MiddlewareHandler<NativeApiEnv>;
  store: EntryStore;
}

export function registerEntryRoutes(
  app: OpenAPIHono<NativeApiEnv>,
  deps: EntryRouteDeps,
): void {
  const openapi = app.openapi.bind(app) as any;

  openapi(
    {
      ...listEntriesRoute,
      middleware: deps.authMiddleware,
    },
    async (c: any) => {
      const userId = c.get("userId");
      const query = c.req.valid("query") as z.output<typeof listEntriesQuerySchema>;
      const streamId = await resolveEntryStreamId(deps.store, userId, query);
      const includeTags: string[] = [];

      if (query.label !== undefined) {
        const label = await requireOwnedLabel(deps.store, userId, query.label);
        includeTags.push(toLabelStreamId(label.name));
      }

      if (query.starred === true && streamId !== STARRED_STREAM_ID) {
        includeTags.push(STARRED_STREAM_ID);
      }

      const continuation = parseContinuationToken(query.continuation);
      const excludeTag = query.unread === true ? READ_STREAM_ID : undefined;
      const filter = {
        streamId,
        count: query.limit,
        sortOrder: "newest" as const,
        ...(continuation !== undefined ? { continuation } : {}),
        ...(excludeTag !== undefined ? { excludeTag } : {}),
      };

      if (includeTags.length === 1) {
        Object.assign(filter, { includeTag: includeTags[0] });
      } else if (includeTags.length > 1) {
        Object.assign(filter, { includeTags });
      }

      const result = await listEntries(deps.store, userId, filter);

      return c.json(
        {
          continuation: encodeContinuationToken(result.continuation),
          items: result.items.map(toNativeEntry),
        },
        200,
      );
    },
  );

  openapi(
    {
      ...getEntryRoute,
      middleware: deps.authMiddleware,
    },
    async (c: any) => {
      const params = c.req.valid("param") as z.output<typeof entryPathParamsSchema>;
      const entry = await getSingleEntry(deps.store, c.get("userId"), params.id);
      return c.json(toNativeEntry(entry), 200);
    },
  );

  openapi(
    {
      ...updateEntryRoute,
      middleware: deps.authMiddleware,
    },
    async (c: any) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param") as z.output<typeof entryPathParamsSchema>;
      const body = c.req.valid("json") as z.output<typeof updateEntryBodySchema>;
      const existing = await getSingleEntry(deps.store, userId, id);
      const nextLabelIds = body.labels === undefined ? undefined : [...new Set(body.labels)];
      const addLabelIds = nextLabelIds === undefined
        ? undefined
        : nextLabelIds.filter(
          (labelId) => !existing.labels.some((label) => label.id === labelId),
        );
      const removeLabelIds = nextLabelIds === undefined
        ? undefined
        : existing.labels
          .filter((label) => !nextLabelIds.includes(label.id))
          .map((label) => label.id);

      await markEntries(deps.store, {
        publicIds: [id],
        userId,
        ...(addLabelIds !== undefined ? { addLabelIds } : {}),
        ...(body.read !== undefined ? { read: body.read } : {}),
        ...(removeLabelIds !== undefined ? { removeLabelIds } : {}),
        ...(body.starred !== undefined ? { starred: body.starred } : {}),
      });

      const updated = await getSingleEntry(deps.store, userId, id);
      return c.json(toNativeEntry(updated), 200);
    },
  );

  openapi(
    {
      ...listLabelsRoute,
      middleware: deps.authMiddleware,
    },
    async (c: any) => {
      const labels = await listLabels(deps.store, c.get("userId"));
      return c.json({ items: labels }, 200);
    },
  );

  openapi(
    {
      ...createLabelRoute,
      middleware: deps.authMiddleware,
    },
    async (c: any) => {
      const label = await editLabel(deps.store, {
        action: "create",
        name: (c.req.valid("json") as z.output<typeof createLabelBodySchema>).name,
        userId: c.get("userId"),
      });

      if (label === null) {
        throw new ApiError(500, "internal_error", "Label creation did not return a label.");
      }

      return c.json(label, 200);
    },
  );

  openapi(
    {
      ...deleteLabelRoute,
      middleware: deps.authMiddleware,
    },
    async (c: any) => {
      const params = c.req.valid("param") as z.output<typeof labelPathParamsSchema>;
      await editLabel(deps.store, {
        action: "delete",
        labelId: params.id,
        target: "item-label",
        userId: c.get("userId"),
      });

      return c.json({ ok: true as const }, 200);
    },
  );
}

async function resolveEntryStreamId(
  store: EntryStore,
  userId: number,
  query: z.output<typeof listEntriesQuerySchema>,
): Promise<string> {
  if (query.feed !== undefined) {
    const feed = await requireFeed(store, query.feed);
    return toFeedStreamId(feed.url);
  }

  if (query.folder !== undefined) {
    const folder = await requireOwnedLabel(store, userId, query.folder);
    return toLabelStreamId(folder.name);
  }

  if (query.starred === true) {
    return STARRED_STREAM_ID;
  }

  return READING_LIST_STREAM_ID;
}

async function getSingleEntry(store: EntryStore, userId: number, publicId: string) {
  const [entry] = await getEntriesById(store, userId, [publicId]);

  if (entry === undefined) {
    throw new ApiError(404, "not_found", `Entry ${publicId} was not found.`);
  }

  return entry;
}
