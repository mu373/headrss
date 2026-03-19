import { getUnreadCounts, type EntryStore } from "@headrss/core";
import type { Hono } from "hono";

import { getUserId, type GReaderAppEnv } from "./shared.js";

interface UnreadRouteDependencies {
  store: EntryStore;
}

export function registerUnreadRoutes(
  app: Hono<GReaderAppEnv>,
  deps: UnreadRouteDependencies,
): void {
  app.get("/reader/api/0/unread-count", async (c) => {
    const unreadcounts = await getUnreadCounts(deps.store, getUserId(c));
    return c.json({ unreadcounts });
  });
}
