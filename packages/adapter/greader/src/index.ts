import type { AuthProvider, EntryStore, FeedCredentialStore } from "@headrss/core";
import { Hono } from "hono";

import { registerAuthRoutes, requireAuth } from "./auth.js";
import { registerSubscriptionRoutes } from "./subscription.js";
import { appErrorResponse, type GReaderAppEnv, installStubRoutes } from "./shared.js";
import { registerStreamRoutes } from "./stream.js";
import { registerTagRoutes } from "./tag.js";
import { registerUnreadRoutes } from "./unread.js";
import { registerUserRoutes } from "./user.js";
import type { TokenSignerLike } from "./token-signer.js";

export function greaderAdapter(
  store: EntryStore,
  auth: AuthProvider,
  tokenSigner: TokenSignerLike<Record<string, unknown>>,
  credentialStore: FeedCredentialStore,
): Hono<GReaderAppEnv> {
  const app = new Hono<GReaderAppEnv>();

  app.onError((error, c) => appErrorResponse(error, c));

  registerAuthRoutes(app, { store, auth, tokenSigner });

  app.use("/reader/api/0/*", requireAuth(auth, tokenSigner));

  registerUserRoutes(app, { store });
  registerSubscriptionRoutes(app, { store, tokenSigner, credentialStore });
  registerStreamRoutes(app, { store, tokenSigner });
  registerTagRoutes(app, { store, tokenSigner });
  registerUnreadRoutes(app, { store });
  installStubRoutes(app);

  return app;
}

export * from "./auth.js";
export * from "./id.js";
