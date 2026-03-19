import {
  RATE_LIMIT_MAX_ATTEMPTS,
  RATE_LIMIT_WINDOW_SECONDS,
  TOKEN_TTL,
} from "@headrss/core";
import type { AuthProvider, EntryStore } from "@headrss/core";
import { createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { OpenAPIHono } from "@hono/zod-openapi";

import {
  ApiError,
  errorResponseSchema,
  tokenResponseSchema,
} from "./shared.js";
import type { NativeApiEnv } from "./shared.js";
import type { TokenSignerLike } from "./token-signer.js";

const AUTH_ENDPOINT = "auth/token";

const tokenPayloadSchema = z.object({
  app_password_id: z.number().int().positive(),
  password_version: z.number().int().nonnegative(),
  user_id: z.number().int().positive(),
});

const tokenRequestSchema = z.object({
  password: z.string().min(1),
  username: z.string().min(1),
});

const tokenRoute = createRoute({
  method: "post",
  path: "/auth/token",
  request: {
    body: {
      content: {
        "application/json": {
          schema: tokenRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: tokenResponseSchema,
        },
      },
      description: "Signed bearer token.",
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
      description: "Invalid credentials.",
    },
    429: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Rate limit exceeded.",
    },
  },
});

interface AuthRouteDeps {
  auth: AuthProvider;
  store: EntryStore;
  tokenSigner: TokenSignerLike;
}

export function registerAuthRoutes(
  app: OpenAPIHono<NativeApiEnv>,
  deps: AuthRouteDeps,
): void {
  const openapi = app.openapi.bind(app) as any;

  openapi(
    tokenRoute as any,
    async (c: any) => {
      const ip = getClientIp(c.req.header("cf-connecting-ip"), c.req.header("x-forwarded-for"));
      const currentRateLimit = await deps.store.getRateLimit(ip, AUTH_ENDPOINT);
      const now = nowInSeconds();

      if (isRateLimitExceeded(currentRateLimit, now)) {
        throw new ApiError(
          429,
          "rate_limited",
          "Too many failed authentication attempts.",
          {
            "Retry-After": String(RATE_LIMIT_WINDOW_SECONDS),
          },
        );
      }

      const { username, password } = c.req.valid("json" as never) as z.output<
        typeof tokenRequestSchema
      >;
      const result = await deps.auth.validateCredentials(username, password);

      if (result === null) {
        await deps.store.incrementRateLimit(
          ip,
          AUTH_ENDPOINT,
          resolveWindowStart(currentRateLimit, now),
        );
        throw new ApiError(401, "invalid_credentials", "Invalid username or password.");
      }

      await deps.store.resetRateLimit(ip, AUTH_ENDPOINT);

      const token = await deps.tokenSigner.sign(
        {
          user_id: result.userId,
          app_password_id: result.appPasswordId,
          password_version: result.passwordVersion,
        },
        TOKEN_TTL,
      );

      return c.json(
        {
          expiresIn: TOKEN_TTL,
          token,
          tokenType: "Bearer",
        },
        200,
      );
    },
  );
}

export function createAuthMiddleware(
  auth: AuthProvider,
  tokenSigner: TokenSignerLike,
): MiddlewareHandler<NativeApiEnv> {
  return async (c, next) => {
    const authorization = c.req.header("authorization");

    if (authorization === undefined) {
      throw new ApiError(401, "authorization_required", "Authorization header is required.");
    }

    const [scheme, token, ...rest] = authorization.split(/\s+/);

    if (scheme !== "Bearer" || token === undefined || rest.length > 0) {
      throw new ApiError(401, "invalid_authorization", "Expected Authorization: Bearer TOKEN.");
    }

    const payload = tokenPayloadSchema.safeParse(await tokenSigner.verify(token));

    if (!payload.success) {
      throw new ApiError(401, "invalid_token", "Token is invalid or expired.");
    }

    const isValid = await auth.validatePasswordVersion(
      payload.data.user_id,
      payload.data.app_password_id,
      payload.data.password_version,
    );

    if (!isValid) {
      throw new ApiError(401, "invalid_token", "Token is invalid or expired.");
    }

    c.set("appPasswordId", payload.data.app_password_id);
    c.set("passwordVersion", payload.data.password_version);
    c.set("userId", payload.data.user_id);

    await next();
  };
}

function getClientIp(
  cfConnectingIp: string | undefined,
  xForwardedFor: string | undefined,
): string {
  if (cfConnectingIp !== undefined && cfConnectingIp.length > 0) {
    return cfConnectingIp;
  }

  if (xForwardedFor !== undefined) {
    const first = xForwardedFor.split(",")[0]?.trim();

    if (first !== undefined && first.length > 0) {
      return first;
    }
  }

  return "unknown";
}

function isRateLimitExceeded(
  rateLimit: {
    attempts: number;
    windowStart: number;
  } | null,
  now: number,
): boolean {
  return (
    rateLimit !== null &&
    rateLimit.windowStart >= now - RATE_LIMIT_WINDOW_SECONDS &&
    rateLimit.attempts >= RATE_LIMIT_MAX_ATTEMPTS
  );
}

function resolveWindowStart(
  rateLimit: {
    windowStart: number;
  } | null,
  now: number,
): number {
  if (rateLimit !== null && rateLimit.windowStart >= now - RATE_LIMIT_WINDOW_SECONDS) {
    return rateLimit.windowStart;
  }

  return now;
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
