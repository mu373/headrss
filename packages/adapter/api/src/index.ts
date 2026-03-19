import type { AuthProvider, EntryStore, FeedCredentialStore } from "@headrss/core";
import { OpenAPIHono } from "@hono/zod-openapi";

import { createAuthMiddleware, registerAuthRoutes } from "./auth.js";
import { registerEntryRoutes } from "./entry.js";
import { registerFolderRoutes } from "./folder.js";
import { installCommonHandlers, validationHook } from "./shared.js";
import type { NativeApiEnv } from "./shared.js";
import { registerSubscriptionRoutes } from "./subscription.js";
import type { TokenSignerLike } from "./token-signer.js";

export function nativeApiAdapter(
  store: EntryStore,
  auth: AuthProvider,
  tokenSigner: TokenSignerLike,
  credentialStore: FeedCredentialStore,
) {
  const app = new OpenAPIHono<NativeApiEnv>({
    defaultHook: validationHook,
  });
  const authMiddleware = createAuthMiddleware(auth, tokenSigner);

  installCommonHandlers(app);
  registerAuthRoutes(app, { auth, store, tokenSigner });
  registerSubscriptionRoutes(app, { authMiddleware, store, credentialStore });
  registerFolderRoutes(app, { authMiddleware, store });
  registerEntryRoutes(app, { authMiddleware, store });

  return app;
}
