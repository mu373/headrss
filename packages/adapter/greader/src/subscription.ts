import {
  editLabel,
  editSubscription,
  escapeXml,
  extractFeedCredentials,
  type EntryStore,
  type FeedCredentialStore,
  type OnFeedSubscribed,
  listSubscriptions,
} from "@headrss/core";
import type { Hono } from "hono";
import {
  parseStreamId,
  toFeedStreamId,
  toLabelStreamId,
} from "./stream-id.js";

import { requireCsrf } from "./auth.js";
import {
  badRequest,
  getFirstParam,
  getParamValues,
  getUserId,
  type GReaderAppEnv,
  toSortId,
} from "./shared.js";
import type { TokenSignerLike } from "./token-signer.js";

interface SubscriptionRouteDependencies {
  store: EntryStore;
  tokenSigner: TokenSignerLike<Record<string, unknown>>;
  credentialStore: FeedCredentialStore;
  onFeedSubscribed?: OnFeedSubscribed | undefined;
}

export function registerSubscriptionRoutes(
  app: Hono<GReaderAppEnv>,
  deps: SubscriptionRouteDependencies,
): void {
  app.get("/reader/api/0/subscription/list", async (c) => {
    const subscriptions = await listSubscriptions(deps.store, getUserId(c));

    return c.json({
      subscriptions: subscriptions.map((subscription) => ({
        id: toFeedStreamId(subscription.feed.url),
        title: subscription.customTitle ?? subscription.feed.title ?? subscription.feed.url,
        categories: subscription.labels.map((label) => ({
          id: toLabelStreamId(label.name),
          label: label.name,
        })),
        url: subscription.feed.url,
        htmlUrl: subscription.feed.siteUrl ?? subscription.feed.url,
        iconUrl: subscription.feed.faviconUrl ?? undefined,
        firstitemmsec: String(subscription.feed.createdAt * 1000),
        sortid: toSortId(subscription.id),
      })),
    });
  });

  app.post(
    "/reader/api/0/subscription/edit",
    requireCsrf(deps.tokenSigner),
    async (c) => {
      const userId = getUserId(c);
      const action = await getFirstParam(c, "ac");
      const streamId = await getFirstParam(c, "s");

      if (action === undefined || streamId === undefined) {
        badRequest("ac and s are required.");
      }

      const feedUrl = requireFeedUrl(streamId);
      const title = await getFirstParam(c, "t");
      const addTags = await getParamValues(c, "a");
      const removeTags = await getParamValues(c, "r");

      if (action === "subscribe") {
        const { url: strippedUrl, credentials } = extractFeedCredentials(feedUrl);
        const subscription = await deps.store.getSubscriptionByUserAndFeed(
          userId,
          (await ensureFeedId(deps.store, strippedUrl)) ?? -1,
        );
        const labelIds = await resolveNextSubscriptionLabelIds(
          deps.store,
          userId,
          subscription?.id,
          addTags,
          removeTags,
        );

        await editSubscription(deps.store, {
          action: "subscribe",
          userId,
          feedUrl: strippedUrl,
          ...(title !== undefined ? { customTitle: title } : {}),
          ...(labelIds !== undefined ? { labelIds } : {}),
        });

        if (credentials !== null) {
          const feed = await deps.store.getFeedByUrl(strippedUrl);
          if (feed !== null) {
            await storeBasicCredentials(deps.credentialStore, feed.id, credentials);
          }
        }

        if (deps.onFeedSubscribed) {
          const feed = await deps.store.getFeedByUrl(strippedUrl);
          if (feed !== null && feed.lastFetchedAt === null && feed.fetchErrorCount === 0) {
            const promise = deps.onFeedSubscribed({ feedId: feed.id, feedUrl: feed.url });
            c.executionCtx?.waitUntil?.(promise);
          }
        }

        return c.text("OK");
      }

      if (action === "unsubscribe") {
        await editSubscription(deps.store, {
          action: "unsubscribe",
          userId,
          feedUrl,
        });

        return c.text("OK");
      }

      if (action !== "edit") {
        badRequest(`Unsupported subscription action: ${action}`);
      }

      const feed = await deps.store.getFeedByUrl(feedUrl);

      if (feed === null) {
        badRequest("Subscription feed was not found.");
      }

      const subscription = await deps.store.getSubscriptionByUserAndFeed(
        userId,
        feed.id,
      );

      if (subscription === null) {
        badRequest("Subscription was not found.");
      }

      if (title !== undefined) {
        await editSubscription(deps.store, {
          action: "rename",
          userId,
          subscriptionId: subscription.id,
          customTitle: title,
        });
      }

      const nextLabelIds = await resolveNextSubscriptionLabelIds(
        deps.store,
        userId,
        subscription.id,
        addTags,
        removeTags,
      );

      if (nextLabelIds !== undefined) {
        await editSubscription(deps.store, {
          action: "move",
          userId,
          subscriptionId: subscription.id,
          labelIds: nextLabelIds,
        });
      }

      return c.text("OK");
    },
  );

  app.post(
    "/reader/api/0/subscription/quickadd",
    requireCsrf(deps.tokenSigner),
    async (c) => {
      const userId = getUserId(c);
      const query = await getFirstParam(c, "quickadd");

      if (query === undefined || query.length === 0) {
        badRequest("quickadd is required.");
      }

      const { url: strippedUrl, credentials } = extractFeedCredentials(query);

      await editSubscription(deps.store, {
        action: "subscribe",
        userId,
        feedUrl: strippedUrl,
      });

      if (credentials !== null) {
        const feed = await deps.store.getFeedByUrl(strippedUrl);
        if (feed !== null) {
          await storeBasicCredentials(deps.credentialStore, feed.id, credentials);
        }
      }

      if (deps.onFeedSubscribed) {
        const feed = await deps.store.getFeedByUrl(strippedUrl);
        if (feed !== null && feed.lastFetchedAt === null && feed.fetchErrorCount === 0) {
          const promise = deps.onFeedSubscribed({ feedId: feed.id, feedUrl: feed.url });
          c.executionCtx?.waitUntil?.(promise);
        }
      }

      return c.json({
        query,
        numResults: 1,
        streamId: toFeedStreamId(strippedUrl),
        streamName: strippedUrl,
      });
    },
  );

  app.get("/reader/api/0/subscription/export", async (c) => {
    const subscriptions = await listSubscriptions(deps.store, getUserId(c));
    const outlines = subscriptions.map((subscription) => {
      const categories = subscription.labels.map((label) => label.name).join(",");
      const attrs = [
        `text="${escapeXml(subscription.customTitle ?? subscription.feed.title ?? subscription.feed.url)}"`,
        `title="${escapeXml(subscription.customTitle ?? subscription.feed.title ?? subscription.feed.url)}"`,
        `type="rss"`,
        `xmlUrl="${escapeXml(subscription.feed.url)}"`,
        `htmlUrl="${escapeXml(subscription.feed.siteUrl ?? subscription.feed.url)}"`,
        ...(categories.length > 0 ? [`category="${escapeXml(categories)}"`] : []),
      ];

      return `    <outline ${attrs.join(" ")} />`;
    });

    const opml = [
      `<?xml version="1.0" encoding="UTF-8"?>`,
      `<opml version="1.0">`,
      `  <head>`,
      `    <title>HeadRSS Export</title>`,
      `  </head>`,
      `  <body>`,
      ...outlines,
      `  </body>`,
      `</opml>`,
      ``,
    ].join("\n");

    c.header("Content-Type", "text/x-opml; charset=utf-8");
    return c.body(opml);
  });
}

async function resolveNextSubscriptionLabelIds(
  store: EntryStore,
  userId: number,
  subscriptionId: number | undefined,
  addTags: ReadonlyArray<string>,
  removeTags: ReadonlyArray<string>,
): Promise<number[] | undefined> {
  if (addTags.length === 0 && removeTags.length === 0) {
    return undefined;
  }

  const currentLabelIds = subscriptionId === undefined
    ? new Set<number>()
    : new Set(
      (await store.listSubscriptionLabels(subscriptionId)).map((label) => label.id),
    );
  const addLabelIds = await resolveLabelIdsForAdd(store, userId, addTags);
  const removeLabelIds = await resolveLabelIdsForRemove(store, userId, removeTags);

  for (const labelId of addLabelIds) {
    currentLabelIds.add(labelId);
  }

  for (const labelId of removeLabelIds) {
    currentLabelIds.delete(labelId);
  }

  return [...currentLabelIds];
}

async function resolveLabelIdsForAdd(
  store: EntryStore,
  userId: number,
  tags: ReadonlyArray<string>,
): Promise<number[]> {
  const labelIds: number[] = [];

  for (const tag of tags) {
    const parsed = parseStreamId(tag);

    if (parsed.kind !== "label") {
      badRequest(`Unsupported subscription tag: ${tag}`);
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
    const parsed = parseStreamId(tag);

    if (parsed.kind !== "label") {
      badRequest(`Unsupported subscription tag: ${tag}`);
    }

    const label = await store.getLabelByName(userId, parsed.labelName);

    if (label !== null) {
      labelIds.push(label.id);
    }
  }

  return [...new Set(labelIds)];
}

function requireFeedUrl(streamId: string): string {
  const parsed = parseStreamId(streamId);

  if (parsed.kind !== "feed") {
    badRequest(`Unsupported subscription stream: ${streamId}`);
  }

  return parsed.feedUrl;
}

async function ensureFeedId(
  store: EntryStore,
  feedUrl: string,
): Promise<number | undefined> {
  return (await store.getFeedByUrl(feedUrl))?.id;
}

async function storeBasicCredentials(
  credentialStore: FeedCredentialStore,
  feedId: number,
  credentials: { username: string; password: string },
): Promise<void> {
  const payload = new TextEncoder().encode(
    JSON.stringify({ username: credentials.username, password: credentials.password }),
  );
  await credentialStore.set(feedId, {
    authType: "basic",
    credentialsEncrypted: payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength),
  });
}
