import { type EntryStore, getUserInfo } from "@headrss/core";
import type { Hono } from "hono";

import { type GReaderAppEnv, getUserId, notFound } from "./shared.js";

interface UserRouteDependencies {
  store: EntryStore;
}

export function registerUserRoutes(
  app: Hono<GReaderAppEnv>,
  deps: UserRouteDependencies,
): void {
  app.get("/reader/api/0/user-info", async (c) => {
    const user = await getUserInfo(deps.store, getUserId(c));

    if (user === null) {
      notFound("User not found.");
    }

    return c.json({
      userId: String(user.id),
      userName: user.username,
      userProfileId: String(user.id),
      userEmail: user.email ?? user.username,
      isBloggerUser: false,
      signupTimeSec: user.createdAt,
      isMultiLoginEnabled: false,
    });
  });
}
