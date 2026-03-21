import {
  type ContinuationToken,
  DEFAULT_PAGE_SIZE,
  DomainError,
  type DomainErrorCode,
  type EntryStore,
  type EntryView,
  type Feed,
  MAX_PAGE_SIZE,
} from "@headrss/core";
import type { Context, Hono } from "hono";
import { numericIdToGReaderId } from "./id.js";
import {
  READ_STREAM_ID,
  READING_LIST_STREAM_ID,
  STARRED_STREAM_ID,
  toFeedStreamId,
  toLabelStreamId,
} from "./stream-id.js";

export interface GReaderAppEnv {
  Variables: {
    userId: number;
  };
}

export interface AuthTokenPayload {
  kind: "auth";
  userId: number;
  appPasswordId: number;
  passwordVersion: number;
}

export interface CsrfTokenPayload {
  kind: "csrf";
  userId: number;
}

export class GReaderHttpError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function badRequest(message: string): never {
  throw new GReaderHttpError(400, "BAD_REQUEST", message);
}

export function forbidden(message: string): never {
  throw new GReaderHttpError(403, "FORBIDDEN", message);
}

export function notFound(message: string): never {
  throw new GReaderHttpError(404, "NOT_FOUND", message);
}

export function conflict(message: string): never {
  throw new GReaderHttpError(409, "CONFLICT", message);
}

export function appErrorResponse(
  error: unknown,
  _c: Context<GReaderAppEnv>,
): Response {
  if (error instanceof GReaderHttpError) {
    return new Response(
      JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
      {
        status: error.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  if (error instanceof DomainError) {
    return new Response(
      JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
        },
      }),
      {
        status: domainErrorStatus(error.code),
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      },
    );
  }

  if (error instanceof Error) {
    console.error(error);
  }

  return new Response(
    JSON.stringify({
      error: {
        code: "INTERNAL_ERROR",
        message: "Unexpected error",
      },
    }),
    {
      status: 500,
      headers: {
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}

const DOMAIN_ERROR_STATUS: Record<DomainErrorCode, number> = {
  NOT_FOUND: 404,
  OWNERSHIP_MISMATCH: 403,
  ALREADY_EXISTS: 409,
  INVALID_INPUT: 400,
  UNSUPPORTED: 400,
};

function domainErrorStatus(code: DomainErrorCode): number {
  return DOMAIN_ERROR_STATUS[code];
}

export async function getParamValues(
  c: Context<GReaderAppEnv>,
  name: string,
): Promise<string[]> {
  const values: string[] = [];

  if (c.req.method !== "GET") {
    values.push(...(await getBodyParamValues(c, name)));
  }

  const queryValues = new URL(c.req.url).searchParams.getAll(name);
  values.push(...queryValues);

  return values;
}

export async function getFirstParam(
  c: Context<GReaderAppEnv>,
  name: string,
): Promise<string | undefined> {
  const values = await getParamValues(c, name);
  return values[0];
}

async function getBodyParamValues(
  c: Context<GReaderAppEnv>,
  name: string,
): Promise<string[]> {
  const contentType = c.req.header("content-type") ?? "";

  if (
    !contentType.includes("application/x-www-form-urlencoded") &&
    !contentType.includes("multipart/form-data")
  ) {
    return [];
  }

  const form = await c.req.raw.clone().formData();
  return form
    .getAll(name)
    .flatMap((value) => (typeof value === "string" ? [value] : []));
}

export function requireInteger(
  value: string | undefined,
  name: string,
): number {
  if (value === undefined || value.length === 0) {
    badRequest(`Missing required parameter: ${name}`);
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    badRequest(`Invalid integer parameter: ${name}`);
  }

  return parsed;
}

export function parseOptionalInteger(
  value: string | undefined,
  name: string,
): number | undefined {
  if (value === undefined || value.length === 0) {
    return undefined;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed)) {
    badRequest(`Invalid integer parameter: ${name}`);
  }

  return parsed;
}

export function parseStreamCount(value: string | undefined): number {
  const count = parseOptionalInteger(value, "n") ?? DEFAULT_PAGE_SIZE;
  return Math.max(1, Math.min(MAX_PAGE_SIZE, count));
}

export function encodeContinuationToken(token: ContinuationToken): string {
  return btoa(`${token.publishedAt}:${token.id}`);
}

export function decodeContinuationToken(
  token: string | undefined,
): ContinuationToken | undefined {
  if (token === undefined || token.length === 0) {
    return undefined;
  }

  let decoded = "";

  try {
    decoded = atob(token);
  } catch {
    badRequest("Invalid continuation token.");
  }

  const [publishedAtText, idText, extra] = decoded.split(":");

  if (
    publishedAtText === undefined ||
    idText === undefined ||
    extra !== undefined
  ) {
    badRequest("Invalid continuation token.");
  }

  const publishedAt = Number(publishedAtText);
  const id = Number(idText);

  if (!Number.isInteger(publishedAt) || !Number.isInteger(id)) {
    badRequest("Invalid continuation token.");
  }

  return { publishedAt, id };
}

export function extractClientIp(c: Context<GReaderAppEnv>): string {
  const forwardedFor = c.req.header("x-forwarded-for");

  if (forwardedFor !== undefined && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0]?.trim() ?? "unknown";
  }

  return (
    c.req.header("cf-connecting-ip") ?? c.req.header("x-real-ip") ?? "unknown"
  );
}

export function getUserId(c: Context<GReaderAppEnv>): number {
  return c.get("userId");
}

export async function loadFeedsById(
  store: EntryStore,
  feedIds: ReadonlyArray<number>,
): Promise<Map<number, Feed>> {
  const feeds = new Map<number, Feed>();

  for (const feedId of new Set(feedIds)) {
    const feed = await store.getFeedById(feedId);

    if (feed !== null) {
      feeds.set(feedId, feed);
    }
  }

  return feeds;
}

export function toSortId(id: number): string {
  return String(id).padStart(16, "0");
}

export function buildGReaderItem(
  entry: EntryView,
  feed: Feed | undefined,
): Record<string, unknown> {
  const categories = [
    READING_LIST_STREAM_ID,
    ...(entry.state.isRead ? [READ_STREAM_ID] : []),
    ...(entry.state.isStarred ? [STARRED_STREAM_ID] : []),
    ...entry.labels.map((label) => toLabelStreamId(label.name)),
  ];

  const publishedMsec = String(entry.publishedAt * 1000);
  const publishedUsec = String(entry.publishedAt * 1_000_000);

  const item: Record<string, unknown> = {
    id: numericIdToGReaderId(entry.id),
    crawlTimeMsec: publishedMsec,
    timestampUsec: publishedUsec,
    categories,
    title: entry.title ?? "",
    published: entry.publishedAt,
    updated: entry.publishedAt,
    author: entry.author ?? "",
    origin: {
      streamId: feed ? toFeedStreamId(feed.url) : "",
      title: feed?.title ?? feed?.url ?? "",
      htmlUrl: feed?.siteUrl ?? feed?.url ?? "",
    },
  };

  if (entry.url !== null) {
    const links = [{ href: entry.url }];
    item.canonical = links;
    item.alternate = [{ href: entry.url, type: "text/html" }];
  }

  if (entry.content !== null) {
    item.summary = { direction: "ltr", content: entry.content };
  } else if (entry.summary !== null) {
    item.summary = { direction: "ltr", content: entry.summary };
  }

  return item;
}

export function installStubRoutes(app: Hono<GReaderAppEnv>): void {
  app.get("/health", (c) => c.json({ ok: true }));
  app.get("/reader/ping", (c) => c.text("OK"));
  app.get("/reader/api/0/preference/list", (c) => c.json({ prefs: {} }));
  app.get("/reader/api/0/preference/stream/list", (c) =>
    c.json({ streamprefs: {} }),
  );
  app.get("/reader/api/0/friend/list", (c) => c.json({ friends: [] }));
}
