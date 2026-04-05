import { nativeApiAdapter } from "@headrss/adapter-api";
import { D1CredentialStore, D1EntryStore } from "@headrss/adapter-d1";
import { greaderAdapter } from "@headrss/adapter-greader";
import { VERSION } from "@headrss/core";
import { swaggerUI } from "@hono/swagger-ui";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { adminRoutes, scopedAdminAuth } from "./admin.js";
import { HmacTokenSigner } from "./auth/hmac-token-signer.js";
import { LocalAuthProvider } from "./auth/local-auth-provider.js";
import { fetchFeedOnSubscribe } from "./fetch-on-subscribe.js";
import { apiKeyAuth, ingestRoutes } from "./ingest.js";
import type { AppEnv } from "./types.js";

type OpenApiDocumentFactory = (config: {
  openapi: string;
  info: {
    title: string;
    version: string;
  };
  servers?: Array<{
    url: string;
  }>;
}) => Record<string, unknown>;

const structuredError = (
  status: number,
  code: string,
  message: string,
): Response =>
  Response.json(
    {
      error: {
        code,
        message,
      },
    },
    { status },
  );

const toStructuredError = (error: unknown): Response => {
  if (error instanceof HTTPException) {
    return structuredError(error.status, "http_error", error.message);
  }

  if (error instanceof Error) {
    console.error(error);
    return structuredError(500, "internal_error", error.message);
  }

  console.error(error);
  return structuredError(500, "internal_error", "Internal server error.");
};

const resolveOpenApiDocument = (app: unknown): Record<string, unknown> => {
  const getOpenAPI31Document = (
    app as { getOpenAPI31Document?: OpenApiDocumentFactory }
  ).getOpenAPI31Document;

  if (typeof getOpenAPI31Document === "function") {
    return getOpenAPI31Document({
      openapi: "3.1.0",
      info: {
        title: "HeadRSS Native API",
        version: VERSION,
      },
      servers: [{ url: "/api/native/v0" }],
    });
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "HeadRSS Native API",
      version: "0.0.0",
    },
    servers: [{ url: "/api/native/v0" }],
    paths: {},
  };
};

export const createWorkerApp = (env: AppEnv["Bindings"]): Hono<AppEnv> => {
  const store = new D1EntryStore(env.DB);
  const credentialStore = new D1CredentialStore(env.DB, env.CREDENTIAL_KEY);
  const clientAuth = new LocalAuthProvider(store);
  const tokenSigner = new HmacTokenSigner(env.TOKEN_KEY);

  const onFeedSubscribed = (
    event: import("@headrss/core").FeedSubscribedEvent,
  ) => fetchFeedOnSubscribe(store, credentialStore, event);

  const greader = greaderAdapter(
    store,
    clientAuth,
    tokenSigner,
    credentialStore,
    onFeedSubscribed,
  );
  const nativeApi = nativeApiAdapter(
    store,
    clientAuth,
    tokenSigner,
    credentialStore,
    onFeedSubscribed,
  );
  const ingest = ingestRoutes(store);
  const admin = adminRoutes(store, credentialStore);
  const openApiDocument = resolveOpenApiDocument(nativeApi);
  const app = new Hono<AppEnv>();

  app.onError((error) => toStructuredError(error));
  app.notFound(() => structuredError(404, "not_found", "Route not found."));

  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/api/openapi.json", (c) => c.json(openApiDocument));
  app.get("/api/docs", swaggerUI({ url: "/api/openapi.json" }));

  app.all(
    "/api/google",
    () =>
      new Response("Unauthorized", {
        status: 401,
        headers: { "Google-Bad-Token": "true" },
      }),
  );

  app.route("/api/google", greader);
  app.route("/api/native/v0", nativeApi);

  app.use("/ingest", apiKeyAuth(env.INGEST_API_KEY));
  app.use("/ingest/*", apiKeyAuth(env.INGEST_API_KEY));
  app.route("/ingest", ingest);

  app.use("/admin", scopedAdminAuth(env));
  app.use("/admin/*", scopedAdminAuth(env));
  app.route("/admin", admin);

  return app;
};

let cachedApp: Hono<AppEnv> | null = null;

const getOrCreateApp = (env: AppEnv["Bindings"]): Hono<AppEnv> => {
  if (cachedApp === null) {
    cachedApp = createWorkerApp(env);
  }
  return cachedApp;
};

export default {
  fetch(request, env, executionCtx) {
    return getOrCreateApp(env).fetch(request, env, executionCtx);
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;

export type { AppEnv } from "./types.js";
