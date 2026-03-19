import {
  editSubscription,
  extractFeedCredentials,
  listSubscriptions,
  markAllRead,
} from "@headrss/core";
import type { EntryStore, FeedCredentialStore, OnFeedSubscribed } from "@headrss/core";
import { createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  ApiError,
  errorResponseSchema,
  idPathParam,
  listSubscriptionsResponseSchema,
  okResponseSchema,
  subscriptionSchema,
  timestampSchema,
  toNativeSubscription,
} from "./shared.js";
import type { NativeApiEnv } from "./shared.js";
import { toFeedStreamId } from "./stream-id.js";

const subscriptionPathParamsSchema = z.object({
  id: idPathParam("id"),
});

const createSubscriptionBodySchema = z.object({
  folder: z.number().int().positive().nullable().optional(),
  title: z.string().min(1).nullable().optional(),
  url: z.url(),
});

const updateSubscriptionBodySchema = z
  .object({
    folder: z.number().int().positive().nullable().optional(),
    title: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) => value.title !== undefined || value.folder !== undefined,
    "At least one of title or folder is required.",
  );

const markAllReadBodySchema = z.object({
  before: timestampSchema.optional(),
});

const listSubscriptionsRoute = createRoute({
  method: "get",
  path: "/subscriptions",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: listSubscriptionsResponseSchema,
        },
      },
      description: "Subscriptions for the authenticated user.",
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

const createSubscriptionRoute = createRoute({
  method: "post",
  path: "/subscriptions",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createSubscriptionBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: subscriptionSchema,
        },
      },
      description: "Created or updated subscription.",
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
      description: "Folder not found.",
    },
  },
});

const updateSubscriptionRoute = createRoute({
  method: "put",
  path: "/subscriptions/{id}",
  request: {
    params: subscriptionPathParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: updateSubscriptionBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: subscriptionSchema,
        },
      },
      description: "Updated subscription.",
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
      description: "Subscription or folder not found.",
    },
  },
});

const deleteSubscriptionRoute = createRoute({
  method: "delete",
  path: "/subscriptions/{id}",
  request: {
    params: subscriptionPathParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: okResponseSchema,
        },
      },
      description: "Subscription removed.",
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
      description: "Subscription not found.",
    },
  },
});

const markAllReadRoute = createRoute({
  method: "post",
  path: "/subscriptions/{id}/mark-all-read",
  request: {
    params: subscriptionPathParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: markAllReadBodySchema,
        },
      },
      required: false,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: okResponseSchema,
        },
      },
      description: "All matching entries marked as read.",
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
      description: "Subscription not found.",
    },
  },
});

interface SubscriptionRouteDeps {
  authMiddleware: MiddlewareHandler<NativeApiEnv>;
  store: EntryStore;
  credentialStore: FeedCredentialStore;
  onFeedSubscribed?: OnFeedSubscribed | undefined;
}

export function registerSubscriptionRoutes(
  app: OpenAPIHono<NativeApiEnv>,
  deps: SubscriptionRouteDeps,
): void {
  const openapi = app.openapi.bind(app) as any;

  openapi(
    {
      ...listSubscriptionsRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const subscriptions = await listSubscriptions(deps.store, c.get("userId"));

      return c.json(
        {
          items: subscriptions.map(toNativeSubscription),
        },
        200,
      );
    },
  );

  openapi(
    {
      ...createSubscriptionRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const userId = c.get("userId");
      const body = c.req.valid("json" as never) as z.output<typeof createSubscriptionBodySchema>;
      const { url: strippedUrl, credentials } = extractFeedCredentials(body.url);
      const labelIds = body.folder === undefined
        ? undefined
        : body.folder === null
          ? []
          : [body.folder];

      await editSubscription(deps.store, {
        action: "subscribe",
        feedUrl: strippedUrl,
        userId,
        ...(body.title !== undefined ? { customTitle: body.title } : {}),
        ...(labelIds !== undefined ? { labelIds } : {}),
      });

      if (credentials !== null) {
        const feed = await deps.store.getFeedByUrl(strippedUrl);
        if (feed !== null) {
          const payload = new TextEncoder().encode(
            JSON.stringify({ username: credentials.username, password: credentials.password }),
          );
          await deps.credentialStore.set(feed.id, {
            authType: "basic",
            credentialsEncrypted: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
          });
        }
      }

      if (deps.onFeedSubscribed) {
        const feed = await deps.store.getFeedByUrl(strippedUrl);
        if (feed !== null && feed.lastFetchedAt === null && feed.fetchErrorCount === 0) {
          const promise = deps.onFeedSubscribed({ feedId: feed.id, feedUrl: feed.url });
          c.executionCtx?.waitUntil?.(promise);
        }
      }

      const subscription = await loadSubscriptionViewByFeedUrl(deps.store, userId, strippedUrl);

      return c.json(toNativeSubscription(subscription), 200);
    },
  );

  openapi(
    {
      ...updateSubscriptionRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param" as never) as z.output<
        typeof subscriptionPathParamsSchema
      >;
      const body = c.req.valid("json" as never) as z.output<
        typeof updateSubscriptionBodySchema
      >;

      await requireOwnedSubscription(deps.store, userId, id);

      if (body.title !== undefined) {
        await editSubscription(deps.store, {
          action: "rename",
          customTitle: body.title,
          subscriptionId: id,
          userId,
        });
      }

      if (body.folder !== undefined) {
        await editSubscription(deps.store, {
          action: "move",
          labelIds: body.folder === null ? [] : [body.folder],
          subscriptionId: id,
          userId,
        });
      }

      const subscription = await loadSubscriptionViewById(deps.store, userId, id);

      return c.json(toNativeSubscription(subscription), 200);
    },
  );

  openapi(
    {
      ...deleteSubscriptionRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param" as never) as z.output<
        typeof subscriptionPathParamsSchema
      >;

      await requireOwnedSubscription(deps.store, userId, id);
      await editSubscription(deps.store, {
        action: "unsubscribe",
        subscriptionId: id,
        userId,
      });

      return c.json({ ok: true as const }, 200);
    },
  );

  openapi(
    {
      ...markAllReadRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const userId = c.get("userId");
      const { id } = c.req.valid("param" as never) as z.output<
        typeof subscriptionPathParamsSchema
      >;
      const body = (c.req.valid("json" as never) ?? {}) as z.output<
        typeof markAllReadBodySchema
      >;
      const before = body.before;
      const subscription = await requireOwnedSubscription(deps.store, userId, id);
      const feed = await deps.store.getFeedById(subscription.feedId);

      if (feed === null) {
        throw new ApiError(404, "not_found", `Feed ${subscription.feedId} was not found.`);
      }

      const timestampUsec = before === undefined ? undefined : before * 1_000_000;
      await markAllRead(deps.store, {
        streamId: toFeedStreamId(feed.url),
        userId,
        ...(timestampUsec !== undefined ? { timestampUsec } : {}),
      });

      return c.json({ ok: true as const }, 200);
    },
  );
}

async function requireOwnedSubscription(
  store: EntryStore,
  userId: number,
  subscriptionId: number,
) {
  const subscription = await store.getSubscriptionById(subscriptionId);

  if (subscription === null || subscription.userId !== userId) {
    throw new ApiError(404, "not_found", `Subscription ${subscriptionId} was not found.`);
  }

  return subscription;
}

async function loadSubscriptionViewByFeedUrl(
  store: EntryStore,
  userId: number,
  feedUrl: string,
) {
  const subscriptions = await store.listSubscriptionsByUserId(userId);
  const subscription = subscriptions.find((item) => item.feed.url === feedUrl);

  if (subscription === undefined) {
    throw new ApiError(404, "not_found", "Subscription was not found after update.");
  }

  return subscription;
}

async function loadSubscriptionViewById(
  store: EntryStore,
  userId: number,
  subscriptionId: number,
) {
  const subscriptions = await store.listSubscriptionsByUserId(userId);
  const subscription = subscriptions.find((item) => item.id === subscriptionId);

  if (subscription === undefined) {
    throw new ApiError(404, "not_found", `Subscription ${subscriptionId} was not found.`);
  }

  return subscription;
}
