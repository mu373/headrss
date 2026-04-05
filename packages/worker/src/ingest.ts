import {
  type EntryStore,
  type Feed,
  type FeedUpdateInput,
  INGEST_BATCH_SIZE,
  type IngestEntryInput,
  ingestEntries,
} from "@headrss/core";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";

interface IngestBindings {
  INGEST_API_KEY?: string;
}

type IngestEnv = {
  Bindings: IngestBindings;
};

const jsonContentType = "application/json";

const jsonErrorSchema = z
  .object({
    error: z.string(),
  })
  .openapi("IngestError");

const ingestResultSchema = z
  .object({
    inserted: z.number().int().nonnegative(),
    skipped: z.number().int().nonnegative(),
  })
  .openapi("IngestResult");

const partialIngestResultSchema = ingestResultSchema
  .extend({
    failedBatches: z
      .array(
        z.object({
          index: z.number().int().nonnegative(),
          size: z.number().int().positive(),
          error: z.string(),
        }),
      )
      .nonempty(),
  })
  .openapi("PartialIngestResult");

const feedSchema = z
  .object({
    id: z.number().int(),
    url: z.string(),
    title: z.string().nullable(),
    siteUrl: z.string().nullable(),
    faviconUrl: z.string().nullable(),
    etag: z.string().nullable(),
    lastModified: z.string().nullable(),
    lastFetchedAt: z.number().int().nullable(),
    fetchErrorCount: z.number().int(),
    nextFetchAt: z.number().int().nullable(),
    createdAt: z.number().int(),
    updatedAt: z.number().int(),
  })
  .openapi("Feed");

const feedIdParamsSchema = z.object({
  feedId: z.coerce.number().int().positive(),
});

const ingestItemSchema = z
  .object({
    guid: z.string().min(1),
    title: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    author: z.string().nullable().optional(),
    content: z.string().nullable().optional(),
    summary: z.string().nullable().optional(),
    publishedAt: z.number().int(),
  })
  .strict()
  .openapi("IngestItem");

const ingestItemsSchema = z.array(ingestItemSchema).openapi("IngestItems");

const feedUpdateSchema = z
  .object({
    title: z.string().nullable().optional(),
    siteUrl: z.string().nullable().optional(),
    faviconUrl: z.string().nullable().optional(),
    etag: z.string().nullable().optional(),
    lastModified: z.string().nullable().optional(),
    lastFetchedAt: z.number().int().nullable().optional(),
    fetchErrorCount: z.number().int().optional(),
    nextFetchAt: z.number().int().nullable().optional(),
  })
  .strict()
  .openapi("FeedUpdateInput");

const postFeedItemsRoute = createRoute({
  method: "post",
  path: "/feeds/:feedId/items",
  request: {
    params: feedIdParamsSchema,
    headers: z.object({
      authorization: z.string().openapi({
        example: "Bearer your-ingest-api-key",
      }),
    }),
    body: {
      required: true,
      content: {
        [jsonContentType]: {
          schema: ingestItemsSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "All items were ingested successfully.",
      content: {
        [jsonContentType]: {
          schema: ingestResultSchema,
        },
      },
    },
    207: {
      description: "Some ingest batches succeeded and some failed.",
      content: {
        [jsonContentType]: {
          schema: partialIngestResultSchema,
        },
      },
    },
    400: {
      description: "Request validation failed.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    401: {
      description: "Authorization failed.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    404: {
      description: "Feed not found.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    415: {
      description: "Unsupported media type.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    500: {
      description: "Ingest failed.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
  },
  tags: ["ingest"],
});

const putFeedRoute = createRoute({
  method: "put",
  path: "/feeds/:feedId",
  request: {
    params: feedIdParamsSchema,
    headers: z.object({
      authorization: z.string().openapi({
        example: "Bearer your-ingest-api-key",
      }),
    }),
    body: {
      required: true,
      content: {
        [jsonContentType]: {
          schema: feedUpdateSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Feed updated successfully.",
      content: {
        [jsonContentType]: {
          schema: feedSchema,
        },
      },
    },
    400: {
      description: "Request validation failed.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    401: {
      description: "Authorization failed.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    404: {
      description: "Feed not found.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
    415: {
      description: "Unsupported media type.",
      content: {
        [jsonContentType]: {
          schema: jsonErrorSchema,
        },
      },
    },
  },
  tags: ["ingest"],
});

export function apiKeyAuth(
  configuredKey?: string,
): MiddlewareHandler<IngestEnv> {
  return async (c, next) => {
    const expectedKey = configuredKey ?? c.env.INGEST_API_KEY;
    const authorization = c.req.header("Authorization");

    if (!expectedKey) {
      throw new HTTPException(500, {
        message: "INGEST_API_KEY is not configured.",
      });
    }

    if (authorization !== `Bearer ${expectedKey}`) {
      throw new HTTPException(401, {
        message: "Unauthorized.",
      });
    }

    await next();
  };
}

function isJsonRequest(contentTypeHeader: string | undefined): boolean {
  return contentTypeHeader?.toLowerCase().startsWith(jsonContentType) ?? false;
}

function splitIntoBatches<T>(
  items: ReadonlyArray<T>,
  batchSize: number,
): T[][] {
  const batches: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    batches.push(items.slice(index, index + batchSize));
  }

  return batches;
}

function isMissingFeedError(error: unknown, feedId: number): boolean {
  return (
    error instanceof Error && error.message === `Feed ${feedId} was not found.`
  );
}

function toFeedUpdateInput(
  input: z.infer<typeof feedUpdateSchema>,
): FeedUpdateInput {
  const update: FeedUpdateInput = {};

  if (input.title !== undefined) {
    update.title = input.title;
  }

  if (input.siteUrl !== undefined) {
    update.siteUrl = input.siteUrl;
  }

  if (input.faviconUrl !== undefined) {
    update.faviconUrl = input.faviconUrl;
  }

  if (input.etag !== undefined) {
    update.etag = input.etag;
  }

  if (input.lastModified !== undefined) {
    update.lastModified = input.lastModified;
  }

  if (input.lastFetchedAt !== undefined) {
    update.lastFetchedAt = input.lastFetchedAt;
  }

  if (input.fetchErrorCount !== undefined) {
    update.fetchErrorCount = input.fetchErrorCount;
  }

  if (input.nextFetchAt !== undefined) {
    update.nextFetchAt = input.nextFetchAt;
  }

  return update;
}

function toFeedResponse(feed: Feed) {
  return {
    id: feed.id,
    url: feed.url,
    title: feed.title,
    siteUrl: feed.siteUrl,
    faviconUrl: feed.faviconUrl,
    etag: feed.etag,
    lastModified: feed.lastModified,
    lastFetchedAt: feed.lastFetchedAt,
    fetchErrorCount: feed.fetchErrorCount,
    nextFetchAt: feed.nextFetchAt,
    createdAt: feed.createdAt,
    updatedAt: feed.updatedAt,
  };
}

export function ingestRoutes(store: EntryStore): OpenAPIHono<IngestEnv>;
export function ingestRoutes(
  store: EntryStore,
  ingestApiKey?: string,
): OpenAPIHono<IngestEnv>;
export function ingestRoutes(
  store: EntryStore,
  ingestApiKey?: string,
): OpenAPIHono<IngestEnv> {
  const app = new OpenAPIHono<IngestEnv>();
  const authMiddleware =
    ingestApiKey === undefined ? undefined : apiKeyAuth(ingestApiKey);

  if (authMiddleware !== undefined) {
    app.use("*", authMiddleware);
  }

  app.onError((error, c) => {
    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }

    return c.json({ error: "Internal Server Error" }, 500);
  });

  app.openapi(postFeedItemsRoute, async (c) => {
    if (!isJsonRequest(c.req.header("Content-Type"))) {
      return c.json({ error: "Content-Type must be application/json." }, 415);
    }

    const { feedId } = c.req.valid("param");
    const items = c.req.valid("json") as IngestEntryInput[];
    const failedBatches: Array<{ index: number; size: number; error: string }> =
      [];

    let inserted = 0;
    let skipped = 0;

    for (const [index, batch] of splitIntoBatches(
      items,
      INGEST_BATCH_SIZE,
    ).entries()) {
      try {
        const result = await ingestEntries(store, { feedId, items: batch });
        inserted += result.inserted;
        skipped += result.skipped;
      } catch (error) {
        if (isMissingFeedError(error, feedId)) {
          return c.json({ error: `Feed ${feedId} was not found.` }, 404);
        }

        failedBatches.push({
          index,
          size: batch.length,
          error:
            error instanceof Error ? error.message : "Batch ingest failed.",
        });
      }
    }

    if (failedBatches.length === 0) {
      return c.json({ inserted, skipped }, 200);
    }

    if (inserted === 0 && skipped === 0) {
      return c.json({ error: "Failed to ingest any batches." }, 500);
    }

    return c.json({ inserted, skipped, failedBatches }, 207);
  });

  app.openapi(putFeedRoute, async (c) => {
    if (!isJsonRequest(c.req.header("Content-Type"))) {
      return c.json({ error: "Content-Type must be application/json." }, 415);
    }

    const { feedId } = c.req.valid("param");
    const input = toFeedUpdateInput(c.req.valid("json"));
    const feed = await store.updateFeed(feedId, input);

    if (feed === null) {
      return c.json({ error: `Feed ${feedId} was not found.` }, 404);
    }

    return c.json(toFeedResponse(feed), 200);
  });

  return app;
}
