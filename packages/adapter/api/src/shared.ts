import type {
  ContinuationToken,
  DomainErrorCode,
  EntryStore,
  Feed,
  Label,
} from "@headrss/core";
import { DEFAULT_PAGE_SIZE, DomainError, MAX_PAGE_SIZE } from "@headrss/core";
import type { Hook, OpenAPIHono } from "@hono/zod-openapi";
import { z } from "@hono/zod-openapi";
import type { Context } from "hono";

const publicIdPattern = /^[0-9A-Za-z]{22}$/;

export interface NativeApiEnv {
  Variables: {
    appPasswordId: number;
    passwordVersion: number;
    userId: number;
  };
}

export interface NativeRouteDeps {
  store: EntryStore;
}

export const idSchema = z.number().int().positive();
export const timestampSchema = z.number().int().nonnegative();
export const nullableTimestampSchema = timestampSchema.nullable();
export const publicIdSchema = z
  .string()
  .regex(publicIdPattern, "Expected a 22-character base62 public ID.");
export const continuationSchema = z
  .string()
  .regex(/^\d+:\d+$/, "Expected continuation token in publishedAt:id format.");

export const feedSchema = z.object({
  id: idSchema,
  url: z.url(),
  title: z.string().min(1).nullable(),
  siteUrl: z.url().nullable(),
  faviconUrl: z.url().nullable(),
  etag: z.string().min(1).nullable(),
  lastModified: z.string().min(1).nullable(),
  lastFetchedAt: nullableTimestampSchema,
  fetchErrorCount: z.number().int(),
  nextFetchAt: nullableTimestampSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

export const labelSchema = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1),
});

export const subscriptionSchema = z.object({
  id: idSchema,
  feedId: idSchema,
  title: z.string().min(1).nullable(),
  readCursorItemId: idSchema.nullable(),
  feed: feedSchema,
  folders: z.array(labelSchema),
});

export const entryStateSchema = z.object({
  isRead: z.boolean(),
  isStarred: z.boolean(),
  starredAt: nullableTimestampSchema,
});

export const entrySchema = z.object({
  id: publicIdSchema,
  feedId: idSchema,
  guid: z.string().min(1),
  title: z.string().min(1).nullable(),
  url: z.url().nullable(),
  author: z.string().min(1).nullable(),
  content: z.string().nullable(),
  summary: z.string().nullable(),
  publishedAt: timestampSchema,
  crawlTimeMs: z.number().int().nonnegative().nullable(),
  createdAt: timestampSchema,
  state: entryStateSchema,
  labels: z.array(labelSchema),
});

export const tokenResponseSchema = z.object({
  expiresIn: z.number().int().positive(),
  token: z.string().min(1),
  tokenType: z.literal("Bearer"),
});

export const okResponseSchema = z.object({
  ok: z.literal(true),
});

export const listSubscriptionsResponseSchema = z.object({
  items: z.array(subscriptionSchema),
});

export const listLabelsResponseSchema = z.object({
  items: z.array(labelSchema),
});

export const listEntriesResponseSchema = z.object({
  continuation: continuationSchema.optional(),
  items: z.array(entrySchema),
});

export const errorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const errorResponseSchema = z.object({
  error: errorSchema,
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly headers: Record<string, string> | undefined;

  public constructor(
    status: number,
    code: string,
    message: string,
    headers?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export const validationHook: Hook<any, NativeApiEnv, string, any> = (
  result,
  c,
) => {
  if (result.success) {
    return;
  }

  return jsonError(
    c,
    new ApiError(400, "invalid_request", formatZodIssues(result.error.issues)),
  );
};

export function installCommonHandlers(app: OpenAPIHono<NativeApiEnv>): void {
  app.onError((error, c) => jsonError(c, toApiError(error)));
  app.notFound((c) =>
    jsonError(c, new ApiError(404, "not_found", "Route not found.")),
  );
}

export function jsonError(c: Context, error: ApiError): Response {
  if (error.headers !== undefined) {
    for (const [name, value] of Object.entries(error.headers)) {
      c.header(name, value);
    }
  }

  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
      },
    },
    error.status as 400 | 401 | 404 | 409 | 429 | 500,
  );
}

const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  OWNERSHIP_MISMATCH: 403,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
  UNSUPPORTED: 400,
};

const DOMAIN_ERROR_API_CODE: Record<DomainErrorCode, string> = {
  NOT_FOUND: "not_found",
  OWNERSHIP_MISMATCH: "forbidden",
  ALREADY_EXISTS: "conflict",
  INVALID_INPUT: "invalid_request",
  UNSUPPORTED: "invalid_request",
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) {
    return error;
  }

  if (error instanceof DomainError) {
    return new ApiError(
      DOMAIN_ERROR_STATUS[error.code],
      DOMAIN_ERROR_API_CODE[error.code],
      error.message,
    );
  }

  if (error instanceof Error) {
    console.error(error);
  }

  return new ApiError(500, "internal_error", "Internal server error.");
}

export function parseContinuationToken(
  raw: string | undefined,
): ContinuationToken | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const [publishedAt, id] = raw.split(":");

  if (
    publishedAt === undefined ||
    id === undefined ||
    !/^\d+$/.test(publishedAt) ||
    !/^\d+$/.test(id)
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      "Expected continuation token in publishedAt:id format.",
    );
  }

  return {
    publishedAt: Number(publishedAt),
    id: Number(id),
  };
}

export function encodeContinuationToken(
  token: ContinuationToken | undefined,
): string | undefined {
  if (token === undefined) {
    return undefined;
  }

  return `${token.publishedAt}:${token.id}`;
}

export function parseBooleanQuery(value: unknown): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === "true" || value === true) {
    return true;
  }

  if (value === "false" || value === false) {
    return false;
  }

  throw new ApiError(
    400,
    "invalid_request",
    "Boolean query values must be true or false.",
  );
}

export async function requireOwnedLabel(
  store: EntryStore,
  userId: number,
  labelId: number,
): Promise<Label> {
  const label = await store.getLabelById(labelId);

  if (label === null || label.userId !== userId) {
    throw new ApiError(404, "not_found", `Label ${labelId} was not found.`);
  }

  return label;
}

export async function requireFeed(
  store: EntryStore,
  feedId: number,
): Promise<Feed> {
  const feed = await store.getFeedById(feedId);

  if (feed === null) {
    throw new ApiError(404, "not_found", `Feed ${feedId} was not found.`);
  }

  return feed;
}

export function toNativeSubscription(subscription: {
  id: number;
  feedId: number;
  customTitle: string | null;
  readCursorItemId: number | null;
  feed: Feed;
  labels: Label[];
}): z.infer<typeof subscriptionSchema> {
  return {
    id: subscription.id,
    feedId: subscription.feedId,
    title: subscription.customTitle,
    readCursorItemId: subscription.readCursorItemId,
    feed: subscription.feed,
    folders: subscription.labels,
  };
}

export function toNativeEntry(entry: {
  publicId: string;
  feedId: number;
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  publishedAt: number;
  crawlTimeMs: number | null;
  createdAt: number;
  state: {
    isRead: boolean;
    isStarred: boolean;
    starredAt: number | null;
  };
  labels: Label[];
}): z.infer<typeof entrySchema> {
  return {
    id: entry.publicId,
    feedId: entry.feedId,
    guid: entry.guid,
    title: entry.title,
    url: entry.url,
    author: entry.author,
    content: entry.content,
    summary: entry.summary,
    publishedAt: entry.publishedAt,
    crawlTimeMs: entry.crawlTimeMs,
    createdAt: entry.createdAt,
    state: entry.state,
    labels: entry.labels,
  };
}

export function limitQuerySchema() {
  return z.coerce
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE);
}

export function idPathParam(name: string) {
  return z.coerce
    .number()
    .int()
    .positive()
    .openapi({
      param: {
        in: "path",
        name,
        required: true,
      },
    });
}

export function publicIdPathParam(name: string) {
  return publicIdSchema.openapi({
    param: {
      in: "path",
      name,
      required: true,
    },
  });
}

function formatZodIssues(
  issues: ReadonlyArray<{ message: string; path: PropertyKey[] }>,
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    })
    .join("; ");
}
