import {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
  TOKEN_TTL,
  type AuthProvider,
  type EntryStore,
} from "@headrss/core";
import type { Hono, MiddlewareHandler } from "hono";

import {
  badRequest,
  extractClientIp,
  forbidden,
  getFirstParam,
  type AuthTokenPayload,
  type CsrfTokenPayload,
  type GReaderAppEnv,
} from "./shared.js";
import type { TokenSignerLike } from "./token-signer.js";

interface AuthRouteDependencies {
  store: EntryStore;
  auth: AuthProvider;
  tokenSigner: TokenSignerLike<Record<string, unknown>>;
}

export function registerAuthRoutes(
  app: Hono<GReaderAppEnv>,
  deps: AuthRouteDependencies,
): void {
  const handler = createClientLoginHandler(deps);
  app.post("/accounts/ClientLogin", handler);
  app.get("/accounts/ClientLogin", handler);
}

export function requireAuth(
  auth: AuthProvider,
  tokenSigner: TokenSignerLike<Record<string, unknown>>,
): MiddlewareHandler<GReaderAppEnv> {
  return async (c, next) => {
    const authorization = c.req.header("authorization");

    if (authorization === undefined) {
      return c.text("Unauthorized", 401);
    }

    const match = authorization.match(/^GoogleLogin auth=(.+)$/i);

    if (match === null) {
      return c.text("Unauthorized", 401);
    }

    const token = match[1];

    if (token === undefined) {
      return c.text("Unauthorized", 401);
    }

    const payload = parseAuthToken(await tokenSigner.verify(token));

    if (payload === null) {
      return c.text("Unauthorized", 401);
    }

    const passwordVersionValid = await auth.validatePasswordVersion(
      payload.userId,
      payload.appPasswordId,
      payload.passwordVersion,
    );

    if (!passwordVersionValid) {
      return c.text("Unauthorized", 401);
    }

    c.set("userId", payload.userId);
    await next();
  };
}

export function requireCsrf(
  tokenSigner: TokenSignerLike<Record<string, unknown>>,
): MiddlewareHandler<GReaderAppEnv> {
  return async (c, next) => {
    const rawToken = c.req.header("T") ?? await getFirstParam(c, "T");

    if (rawToken === undefined) {
      forbidden("Missing CSRF token.");
    }

    const payload = parseCsrfToken(await tokenSigner.verify(rawToken));

    if (payload === null || payload.userId !== c.get("userId")) {
      forbidden("Invalid CSRF token.");
    }

    await next();
  };
}

function createClientLoginHandler(
  deps: AuthRouteDependencies,
): MiddlewareHandler<GReaderAppEnv> {
  return async (c) => {
    const ip = extractClientIp(c);
    const endpoint = "ClientLogin";
    const windowStart = currentWindowStart();
    const currentLimit = await deps.store.getRateLimit(ip, endpoint);

    if (
      currentLimit !== null &&
      currentLimit.windowStart === windowStart &&
      currentLimit.attempts >= RATE_LIMIT_MAX_ATTEMPTS
    ) {
      c.header("Retry-After", String(RATE_LIMIT_WINDOW_SECONDS));
      return c.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many failed login attempts.",
          },
        },
        429,
      );
    }

    const username = await getFirstParam(c, "Email");
    const password = await getFirstParam(c, "Passwd");

    if (username === undefined || password === undefined) {
      badRequest("Email and Passwd are required.");
    }

    const result = await deps.auth.validateCredentials(username, password);

    if (result === null) {
      await deps.store.incrementRateLimit(ip, endpoint, windowStart);
      return c.text("Unauthorized", 401);
    }

    await deps.store.resetRateLimit(ip, endpoint);

    const token = await deps.tokenSigner.sign(
      {
        kind: "auth",
        userId: result.userId,
        appPasswordId: result.appPasswordId,
        passwordVersion: result.passwordVersion,
      },
      TOKEN_TTL,
    );

    return c.text(`SID=${token}\nLSID=${token}\nAuth=${token}`);
  };
}

function currentWindowStart(): number {
  const now = Math.floor(Date.now() / 1000);
  return now - (now % RATE_LIMIT_WINDOW_SECONDS);
}

function parseAuthToken(
  payload: Record<string, unknown> | null,
): AuthTokenPayload | null {
  const userId = asInteger(payload?.userId);
  const appPasswordId = asInteger(payload?.appPasswordId);
  const passwordVersion = asInteger(payload?.passwordVersion);

  if (
    payload?.kind !== "auth" ||
    userId === null ||
    appPasswordId === null ||
    passwordVersion === null
  ) {
    return null;
  }

  return {
    kind: "auth",
    userId,
    appPasswordId,
    passwordVersion,
  };
}

function parseCsrfToken(
  payload: Record<string, unknown> | null,
): CsrfTokenPayload | null {
  const userId = asInteger(payload?.userId);

  if (payload?.kind !== "csrf" || userId === null) {
    return null;
  }

  return {
    kind: "csrf",
    userId,
  };
}

function asInteger(value: unknown): number | null {
  return Number.isInteger(value) ? (value as number) : null;
}
