import type {
  AppPassword,
  EntryStore,
  Feed,
  FeedCredentialStore,
  Label,
  SubscriptionView,
  User,
} from "@headrss/core";
import {
  extractFeedCredentials,
  MAX_OPML_FEEDS,
  OPML_BATCH_SIZE,
  RATE_LIMIT_WINDOW_SECONDS,
} from "@headrss/core";
import { XMLParser } from "fast-xml-parser";
import type { Context, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { z, ZodError } from "zod";

interface AdminBindings {
  ADMIN_API_KEY?: string;
  FETCH_API_KEY?: string;
}

type AdminEnv = {
  Bindings: AdminBindings;
};

type AdminContext = Context<AdminEnv>;

class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

interface ImportedFeedOutline {
  url: string;
  title: string | null;
  siteUrl: string | null;
  labels: string[];
}

interface GroupedImportFeed {
  url: string;
  title: string | null;
  siteUrl: string | null;
  labelNames: string[];
}

const ADMIN_DEFAULT_LIMIT = 100;
const ADMIN_MAX_LIMIT = 500;
const DEFAULT_RETENTION_DAYS = 90;
const PASSWORD_RANDOM_BYTES = 24;
const decoder = new TextDecoder();
const encoder = new TextEncoder();

const nullableStringSchema = z.union([z.string(), z.null()]);
const nullableUrlSchema = z.union([z.string().url(), z.null()]);
const nullableTimestampSchema = z.union([z.coerce.number().int().nonnegative(), z.null()]);

const paginationSchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(ADMIN_MAX_LIMIT).default(ADMIN_DEFAULT_LIMIT),
    offset: z.coerce.number().int().min(0).default(0),
  })
  .strict();

const idParamSchema = z
  .object({
    id: z.coerce.number().int().positive(),
  })
  .strict();

const userIdParamSchema = z
  .object({
    userId: z.coerce.number().int().positive(),
  })
  .strict();

const feedCreateSchema = z
  .object({
    url: z.string().url(),
    title: nullableStringSchema.optional(),
    site_url: nullableUrlSchema.optional(),
    favicon_url: nullableUrlSchema.optional(),
    etag: nullableStringSchema.optional(),
    last_modified: nullableStringSchema.optional(),
    last_fetched_at: nullableTimestampSchema.optional(),
    fetch_error_count: z.coerce.number().int().optional(),
    next_fetch_at: nullableTimestampSchema.optional(),
  })
  .strict();

const feedUpdateSchema = z
  .object({
    url: z.string().url().optional(),
    title: nullableStringSchema.optional(),
    site_url: nullableUrlSchema.optional(),
    favicon_url: nullableUrlSchema.optional(),
    etag: nullableStringSchema.optional(),
    last_modified: nullableStringSchema.optional(),
    last_fetched_at: nullableTimestampSchema.optional(),
    fetch_error_count: z.coerce.number().int().optional(),
    next_fetch_at: nullableTimestampSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

const userCreateSchema = z
  .object({
    username: z.string().trim().min(1),
    email: z.union([z.string().email(), z.null()]).optional(),
  })
  .strict();

const userUpdateSchema = z
  .object({
    username: z.string().trim().min(1).optional(),
    email: z.union([z.string().email(), z.null()]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one field must be provided.",
  });

const appPasswordCreateSchema = z
  .object({
    label: z.string().trim().min(1),
  })
  .strict();

const credentialSchema = z
  .object({
    auth_type: z.string().trim().min(1),
    credentials: z.unknown(),
  })
  .strict();

const recountSchema = z
  .object({
    user_id: z.coerce.number().int().positive().optional(),
  })
  .strict()
  .default({});

const purgeSchema = z
  .object({
    retention_days: z.coerce.number().int().positive().default(DEFAULT_RETENTION_DAYS),
  })
  .strict()
  .default({ retention_days: DEFAULT_RETENTION_DAYS });

const opmlImportSchema = z
  .object({
    user_id: z.coerce.number().int().positive(),
    opml: z.string().trim().min(1),
  })
  .strict();

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const jsonError = (code: string, message: string) => ({
  error: {
    code,
    message,
  },
});

const apiError = (status: number, code: string, message: string): ApiError =>
  new ApiError(status, code, message);

const validationMessage = (error: ZodError): string => {
  const issue = error.issues[0];
  if (issue === undefined) {
    return "Invalid request.";
  }

  const path = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
  return `${path}${issue.message}`;
};

const parseParams = <TSchema extends z.ZodTypeAny>(
  c: AdminContext,
  schema: TSchema,
): z.infer<TSchema> => {
  const result = schema.safeParse(c.req.param());
  if (!result.success) {
    throw apiError(400, "validation_error", validationMessage(result.error));
  }
  return result.data;
};

const parseQuery = <TSchema extends z.ZodTypeAny>(
  c: AdminContext,
  schema: TSchema,
): z.infer<TSchema> => {
  const query = Object.fromEntries(new URL(c.req.url).searchParams.entries());
  const result = schema.safeParse(query);
  if (!result.success) {
    throw apiError(400, "validation_error", validationMessage(result.error));
  }
  return result.data;
};

const parseJsonText = (rawBody: string): unknown => {
  try {
    return JSON.parse(rawBody) as unknown;
  } catch {
    throw apiError(400, "invalid_json", "Request body must be valid JSON.");
  }
};

const readJsonBody = async <TSchema extends z.ZodTypeAny>(
  c: AdminContext,
  schema: TSchema,
): Promise<z.infer<TSchema>> => {
  const rawBody = await c.req.text();
  if (rawBody.trim() === "") {
    throw apiError(400, "validation_error", "Request body is required.");
  }

  const result = schema.safeParse(parseJsonText(rawBody));
  if (!result.success) {
    throw apiError(400, "validation_error", validationMessage(result.error));
  }
  return result.data;
};

const readOptionalJsonBody = async <TSchema extends z.ZodTypeAny>(
  c: AdminContext,
  schema: TSchema,
): Promise<z.infer<TSchema>> => {
  const rawBody = await c.req.text();
  const payload = rawBody.trim() === "" ? {} : parseJsonText(rawBody);
  const result = schema.safeParse(payload);
  if (!result.success) {
    throw apiError(400, "validation_error", validationMessage(result.error));
  }
  return result.data;
};

const serializeUser = (user: User) => ({
  id: user.id,
  username: user.username,
  email: user.email,
  created_at: user.createdAt,
});

const serializeFeed = (feed: Feed, hasCredentials: boolean) => ({
  id: feed.id,
  url: feed.url,
  title: feed.title,
  site_url: feed.siteUrl,
  favicon_url: feed.faviconUrl,
  etag: feed.etag,
  last_modified: feed.lastModified,
  last_fetched_at: feed.lastFetchedAt,
  fetch_error_count: feed.fetchErrorCount,
  next_fetch_at: feed.nextFetchAt,
  created_at: feed.createdAt,
  updated_at: feed.updatedAt,
  has_credentials: hasCredentials,
});

const serializeAppPassword = (password: AppPassword) => ({
  id: password.id,
  user_id: password.userId,
  label: password.label,
  last_used_at: password.lastUsedAt,
  created_at: password.createdAt,
});

const serializePagination = <TItem>(items: TItem[], limit: number, offset: number) => ({
  items,
  limit,
  offset,
});

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

interface OpmlOutlineNode {
  "@_xmlUrl"?: string;
  "@_xmlurl"?: string;
  "@_htmlUrl"?: string;
  "@_htmlurl"?: string;
  "@_title"?: string;
  "@_text"?: string;
  "@_type"?: string;
  "@_category"?: string;
  "@_categories"?: string;
  outline?: OpmlOutlineNode | OpmlOutlineNode[];
}

const getOutlineAttr = (
  node: OpmlOutlineNode,
  names: readonly string[],
): string | null => {
  for (const name of names) {
    const key = `@_${name}` as keyof OpmlOutlineNode;
    const value = node[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }
  }
  return null;
};

const parseCredentialPayload = (payload: ArrayBuffer): unknown => {
  const text = decoder.decode(payload);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
};

const encodeCredentialPayload = (credentials: unknown): ArrayBuffer =>
  toArrayBuffer(encoder.encode(JSON.stringify(credentials)));

const randomToken = (byteLength: number): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => (byte % 36).toString(36)).join("");
};

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
};

const hashPassword = async (plaintext: string): Promise<string> => {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(plaintext),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const iterations = 100_000;
  const digest = new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations,
      },
      key,
      256,
    ),
  );
  return `pbkdf2$${iterations}$${toBase64Url(salt)}$${toBase64Url(digest)}`;
};

const normalizeAdminPath = (pathname: string): string => {
  if (pathname === "/admin") {
    return "/";
  }

  return pathname.startsWith("/admin/") ? pathname.slice("/admin".length) : pathname;
};

const isFetchScopeRoute = (pathname: string, method: string): boolean => {
  if (method !== "GET") {
    return false;
  }

  const path = normalizeAdminPath(pathname);
  return (
    path === "/feeds" ||
    path === "/feeds/due" ||
    /^\/feeds\/[^/]+\/credentials$/.test(path)
  );
};

export function scopedAdminAuth(
  env?: AdminBindings,
): MiddlewareHandler<AdminEnv> {
  return async (c, next) => {
    const authorization = c.req.header("Authorization");
    if (authorization === undefined || !authorization.startsWith("Bearer ")) {
      return c.json(
        jsonError("unauthorized", "Authorization header must be a Bearer token."),
        401,
      );
    }

    const token = authorization.slice("Bearer ".length).trim();
    const adminApiKey = env?.ADMIN_API_KEY ?? c.env.ADMIN_API_KEY;
    const fetchApiKey = env?.FETCH_API_KEY ?? c.env.FETCH_API_KEY;
    const isAllowed =
      token === adminApiKey ||
      (isFetchScopeRoute(new URL(c.req.url).pathname, c.req.method) &&
        token === fetchApiKey);

    if (!isAllowed) {
      return c.json(jsonError("forbidden", "Invalid API key for this route."), 403);
    }

    await next();
  };
}

const isUniqueConstraintError = (error: unknown): boolean =>
  error instanceof Error && error.message.includes("UNIQUE constraint failed");

const loadFeedCredentialFlags = async (
  feeds: Feed[],
  credStore: FeedCredentialStore,
): Promise<Map<number, boolean>> => {
  const values = await Promise.all(
    feeds.map(async (feed) => [feed.id, (await credStore.get(feed.id)) !== null] as const),
  );
  return new Map(values);
};

const ensureUser = async (store: EntryStore, id: number): Promise<User> => {
  const user = await store.getUserById(id);
  if (user === null) {
    throw apiError(404, "not_found", "User not found.");
  }
  return user;
};

const ensureFeed = async (store: EntryStore, id: number): Promise<Feed> => {
  const feed = await store.getFeedById(id);
  if (feed === null) {
    throw apiError(404, "not_found", "Feed not found.");
  }
  return feed;
};

const parseOpml = (xml: string): ImportedFeedOutline[] => {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    isArray: (name) => name === "outline",
  });

  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    throw apiError(400, "invalid_opml", "OPML could not be parsed.");
  }

  const opml = parsed.opml as Record<string, unknown> | undefined;
  const body = (opml?.body ?? parsed.body) as
    | { outline?: OpmlOutlineNode | OpmlOutlineNode[] }
    | undefined;

  if (body === undefined) {
    throw apiError(400, "invalid_opml", "OPML body element is required.");
  }

  const outlines: ImportedFeedOutline[] = [];

  const parseCategoryLabels = (node: OpmlOutlineNode): string[] => {
    const categories = getOutlineAttr(node, ["category", "categories"]);
    if (categories === null) {
      return [];
    }
    return categories
      .split(/[,/]/)
      .map((value) => value.trim())
      .filter((value) => value.length > 0);
  };

  const toArray = (
    value: OpmlOutlineNode | OpmlOutlineNode[] | undefined,
  ): OpmlOutlineNode[] => {
    if (value === undefined) return [];
    return Array.isArray(value) ? value : [value];
  };

  const walk = (nodes: OpmlOutlineNode[], labels: string[]): void => {
    for (const node of nodes) {
      const xmlUrl = getOutlineAttr(node, ["xmlUrl", "xmlurl"]);
      if (xmlUrl !== null) {
        const outlineLabels = [
          ...new Set([...labels, ...parseCategoryLabels(node)]),
        ];
        outlines.push({
          url: xmlUrl,
          title: getOutlineAttr(node, ["title", "text"]),
          siteUrl: getOutlineAttr(node, ["htmlUrl", "htmlurl"]),
          labels: outlineLabels,
        });
        continue;
      }

      const labelName = getOutlineAttr(node, ["title", "text"]);
      walk(
        toArray(node.outline),
        labelName === null ? labels : [...labels, labelName],
      );
    }
  };

  walk(toArray(body.outline), []);

  if (outlines.length === 0) {
    throw apiError(
      400,
      "invalid_opml",
      "No feed outlines were found in the OPML document.",
    );
  }

  return outlines;
};

const groupImportedFeeds = (feeds: ImportedFeedOutline[]): GroupedImportFeed[] => {
  const grouped = new Map<string, GroupedImportFeed>();

  for (const feed of feeds) {
    const existing = grouped.get(feed.url);
    if (existing === undefined) {
      grouped.set(feed.url, {
        url: feed.url,
        title: feed.title,
        siteUrl: feed.siteUrl,
        labelNames: [...new Set(feed.labels)],
      });
      continue;
    }

    existing.title ??= feed.title;
    existing.siteUrl ??= feed.siteUrl;
    existing.labelNames = [...new Set([...existing.labelNames, ...feed.labels])];
  }

  return [...grouped.values()];
};

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size) as T[]);
  }
  return batches;
};

const buildOpml = (user: User, subscriptions: SubscriptionView[]): string => {
  const folders = new Map<string, SubscriptionView[]>();
  const unfiled: SubscriptionView[] = [];

  for (const subscription of subscriptions) {
    if (subscription.labels.length === 0) {
      unfiled.push(subscription);
      continue;
    }

    for (const label of subscription.labels) {
      const entries = folders.get(label.name) ?? [];
      entries.push(subscription);
      folders.set(label.name, entries);
    }
  }

  const renderSubscription = (subscription: SubscriptionView, indent: string): string => {
    const title =
      subscription.customTitle ??
      subscription.feed.title ??
      subscription.feed.siteUrl ??
      subscription.feed.url;
    const attributes = [
      `type="rss"`,
      `text="${escapeXml(title)}"`,
      `title="${escapeXml(title)}"`,
      `xmlUrl="${escapeXml(subscription.feed.url)}"`,
      ...(subscription.feed.siteUrl === null
        ? []
        : [`htmlUrl="${escapeXml(subscription.feed.siteUrl)}"`]),
    ];

    return `${indent}<outline ${attributes.join(" ")} />`;
  };

  const bodyLines: string[] = [];

  for (const [label, items] of [...folders.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    bodyLines.push(
      `    <outline text="${escapeXml(label)}" title="${escapeXml(label)}">`,
    );
    for (const subscription of items) {
      bodyLines.push(renderSubscription(subscription, "      "));
    }
    bodyLines.push("    </outline>");
  }

  for (const subscription of unfiled) {
    bodyLines.push(renderSubscription(subscription, "    "));
  }

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<opml version="2.0">',
    "  <head>",
    `    <title>${escapeXml(`HeadRSS subscriptions for ${user.username}`)}</title>`,
    `    <dateCreated>${escapeXml(new Date(user.createdAt * 1000).toUTCString())}</dateCreated>`,
    "  </head>",
    "  <body>",
    ...bodyLines,
    "  </body>",
    "</opml>",
  ].join("\n");
};

export const adminRoutes = (
  store: EntryStore,
  credStore: FeedCredentialStore,
): Hono<AdminEnv> => {
  const app = new Hono<AdminEnv>();

  app.onError((error, c) => {
    if (error instanceof ApiError) {
      return new Response(JSON.stringify(jsonError(error.code, error.message)), {
        status: error.status,
        headers: {
          "content-type": "application/json; charset=utf-8",
        },
      });
    }

    if (error instanceof ZodError) {
      return c.json(jsonError("validation_error", validationMessage(error)), 400);
    }

    if (isUniqueConstraintError(error)) {
      return c.json(
        jsonError("conflict", "The requested resource conflicts with existing data."),
        409,
      );
    }

    console.error(error);
    const message = error instanceof Error ? error.message : "An unexpected error occurred.";
    return c.json(
      jsonError("internal_error", message),
      500,
    );
  });

  app.notFound((c) => c.json(jsonError("not_found", "Route not found."), 404));

  app.get("/feeds", async (c) => {
    const { limit, offset } = parseQuery(c, paginationSchema);
    const feeds = await store.listFeeds({ limit, offset });
    const flags = await loadFeedCredentialFlags(feeds, credStore);

    return c.json(
      serializePagination(
        feeds.map((feed) => serializeFeed(feed, flags.get(feed.id) ?? false)),
        limit,
        offset,
      ),
    );
  });

  app.get("/feeds/due", async (c) => {
    const { limit, offset } = parseQuery(c, paginationSchema);
    const feeds = await store.listDueFeeds(nowSeconds(), { limit, offset });
    const flags = await loadFeedCredentialFlags(feeds, credStore);

    return c.json(
      serializePagination(
        feeds.map((feed) => serializeFeed(feed, flags.get(feed.id) ?? false)),
        limit,
        offset,
      ),
    );
  });

  app.post("/feeds", async (c) => {
    const body = await readJsonBody(c, feedCreateSchema);
    const feed = await store.createFeed({
      url: body.url,
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.site_url !== undefined ? { siteUrl: body.site_url } : {}),
      ...(body.favicon_url !== undefined ? { faviconUrl: body.favicon_url } : {}),
      ...(body.etag !== undefined ? { etag: body.etag } : {}),
      ...(body.last_modified !== undefined ? { lastModified: body.last_modified } : {}),
      ...(body.last_fetched_at !== undefined ? { lastFetchedAt: body.last_fetched_at } : {}),
      ...(body.fetch_error_count !== undefined
        ? { fetchErrorCount: body.fetch_error_count }
        : {}),
      ...(body.next_fetch_at !== undefined ? { nextFetchAt: body.next_fetch_at } : {}),
    });

    return c.json(serializeFeed(feed, false), 201);
  });

  app.put("/feeds/:id", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    const body = await readJsonBody(c, feedUpdateSchema);
    const feed = await store.updateFeed(id, {
      ...(body.url !== undefined ? { url: body.url } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.site_url !== undefined ? { siteUrl: body.site_url } : {}),
      ...(body.favicon_url !== undefined ? { faviconUrl: body.favicon_url } : {}),
      ...(body.etag !== undefined ? { etag: body.etag } : {}),
      ...(body.last_modified !== undefined ? { lastModified: body.last_modified } : {}),
      ...(body.last_fetched_at !== undefined ? { lastFetchedAt: body.last_fetched_at } : {}),
      ...(body.fetch_error_count !== undefined
        ? { fetchErrorCount: body.fetch_error_count }
        : {}),
      ...(body.next_fetch_at !== undefined ? { nextFetchAt: body.next_fetch_at } : {}),
      updatedAt: nowSeconds(),
    });

    if (feed === null) {
      throw apiError(404, "not_found", "Feed not found.");
    }

    const hasCredentials = (await credStore.get(feed.id)) !== null;
    return c.json(serializeFeed(feed, hasCredentials));
  });

  app.delete("/feeds/:id", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    const deleted = await store.deleteFeed(id);

    if (!deleted) {
      throw apiError(404, "not_found", "Feed not found.");
    }

    return c.json({ deleted: true, id });
  });

  app.get("/users", async (c) => {
    const { limit, offset } = parseQuery(c, paginationSchema);
    const users = await store.listUsers({ limit, offset });

    return c.json(
      serializePagination(
        users.map(serializeUser),
        limit,
        offset,
      ),
    );
  });

  app.post("/users", async (c) => {
    const body = await readJsonBody(c, userCreateSchema);
    const user = await store.createUser({
      username: body.username,
      ...(body.email !== undefined ? { email: body.email } : {}),
    });

    return c.json(serializeUser(user), 201);
  });

  app.put("/users/:id", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    const body = await readJsonBody(c, userUpdateSchema);
    const user = await store.updateUser(id, {
      ...(body.username !== undefined ? { username: body.username } : {}),
      ...(body.email !== undefined ? { email: body.email } : {}),
    });

    if (user === null) {
      throw apiError(404, "not_found", "User not found.");
    }

    return c.json(serializeUser(user));
  });

  app.delete("/users/:id", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    const deleted = await store.deleteUser(id);

    if (!deleted) {
      throw apiError(404, "not_found", "User not found.");
    }

    return c.json({ deleted: true, id });
  });

  app.get("/users/:id/app-passwords", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    await ensureUser(store, id);
    const passwords = await store.listAppPasswordsByUserId(id);

    return c.json({
      user_id: id,
      items: passwords.map(serializeAppPassword),
    });
  });

  app.post("/users/:id/app-passwords", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    await ensureUser(store, id);
    const body = await readJsonBody(c, appPasswordCreateSchema);
    const plaintextPassword = `hrss_${randomToken(PASSWORD_RANDOM_BYTES)}`;
    const password = await store.createAppPassword({
      userId: id,
      label: body.label,
      passwordHash: await hashPassword(plaintextPassword),
      passwordVersion: 1,
    });

    return c.json(
      {
        app_password: serializeAppPassword(password),
        plaintext_password: plaintextPassword,
      },
      201,
    );
  });

  app.delete("/app-passwords/:id", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    const deleted = await store.deleteAppPassword(id);

    if (!deleted) {
      throw apiError(404, "not_found", "App password not found.");
    }

    return c.json({ deleted: true, id });
  });

  app.get("/feeds/:id/credentials", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    await ensureFeed(store, id);
    const credential = await credStore.get(id);

    if (credential === null) {
      throw apiError(404, "not_found", "Feed credential not found.");
    }

    return c.json({
      feed_id: id,
      auth_type: credential.authType,
      credentials: parseCredentialPayload(credential.credentialsEncrypted),
      created_at: credential.createdAt,
    });
  });

  app.put("/feeds/:id/credentials", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    await ensureFeed(store, id);
    const body = await readJsonBody(c, credentialSchema);
    const credential = await credStore.set(id, {
      authType: body.auth_type,
      credentialsEncrypted: encodeCredentialPayload(body.credentials),
    });

    return c.json({
      feed_id: id,
      auth_type: credential.authType,
      credentials: parseCredentialPayload(credential.credentialsEncrypted),
      created_at: credential.createdAt,
    });
  });

  app.delete("/feeds/:id/credentials", async (c) => {
    const { id } = parseParams(c, idParamSchema);
    await ensureFeed(store, id);
    const deleted = await credStore.delete(id);

    if (!deleted) {
      throw apiError(404, "not_found", "Feed credential not found.");
    }

    return c.json({ deleted: true, feed_id: id });
  });

  app.post("/maintenance/recount", async (c) => {
    const body = await readOptionalJsonBody(c, recountSchema);
    const counts = await store.recountUnreadCounts(body.user_id);

    return c.json({
      items: counts.map((count) => ({
        subscription_id: count.subscriptionId,
        unread_count: count.unreadCount,
      })),
    });
  });

  app.post("/maintenance/purge", async (c) => {
    const body = await readOptionalJsonBody(c, purgeSchema);
    const now = nowSeconds();
    const cutoffTimestamp = now - body.retention_days * 24 * 60 * 60;
    const result = await store.purgeItemsOlderThan(cutoffTimestamp);
    const deletedRateLimits = await store.deleteExpiredRateLimits(
      now - RATE_LIMIT_WINDOW_SECONDS,
    );

    return c.json({
      retention_days: body.retention_days,
      cutoff_timestamp: cutoffTimestamp,
      deleted: result.deleted,
      skipped_starred: result.skippedStarred,
      skipped_unread_override: result.skippedUnreadOverride,
      deleted_rate_limits: deletedRateLimits,
    });
  });

  app.get("/opml/export/:userId", async (c) => {
    const { userId } = parseParams(c, userIdParamSchema);
    const user = await ensureUser(store, userId);
    const subscriptions = await store.listSubscriptionsByUserId(userId);

    return c.json({
      user_id: userId,
      opml: buildOpml(user, subscriptions),
    });
  });

  app.post("/opml/import", async (c) => {
    const body = await readJsonBody(c, opmlImportSchema);
    await ensureUser(store, body.user_id);

    const feeds = groupImportedFeeds(parseOpml(body.opml));
    if (feeds.length > MAX_OPML_FEEDS) {
      throw apiError(
        400,
        "validation_error",
        `OPML import exceeds the ${MAX_OPML_FEEDS} feed limit.`,
      );
    }

    const labelByName = new Map<string, Label>();
    const labelNames = [...new Set(feeds.flatMap((feed) => feed.labelNames))].sort();

    for (const labelName of labelNames) {
      const existing = await store.getLabelByName(body.user_id, labelName);
      const label =
        existing ??
        (await store.createLabel({
          userId: body.user_id,
          name: labelName,
        }));
      labelByName.set(labelName, label);
    }

    const batches = chunk(feeds, OPML_BATCH_SIZE);
    const batchResults: Array<{
      batch_index: number;
      size: number;
      status: "success" | "failed";
      imported: number;
      error?: string;
    }> = [];

    let imported = 0;

    // TODO: This stays sequential until adapter-layer batch primitives exist for D1-backed OPML imports.
    for (const [batchIndex, batch] of batches.entries()) {
      try {
        for (const feedInput of batch) {
          const { url: strippedUrl, credentials } = extractFeedCredentials(feedInput.url);
          const feed = await store.upsertFeed({
            url: strippedUrl,
            title: feedInput.title,
            siteUrl: feedInput.siteUrl,
            updatedAt: nowSeconds(),
          });

          if (credentials !== null) {
            const payload = new TextEncoder().encode(
              JSON.stringify({ username: credentials.username, password: credentials.password }),
            );
            await credStore.set(feed.id, {
              authType: "basic",
              credentialsEncrypted: payload.buffer as ArrayBuffer,
            });
          }

          const existingSubscription = await store.getSubscriptionByUserAndFeed(
            body.user_id,
            feed.id,
          );
          const subscription =
            existingSubscription ??
            (await store.createSubscription({
              userId: body.user_id,
              feedId: feed.id,
            }));

          const labelIds = new Set(
            (await store.listSubscriptionLabels(subscription.id)).map((label) => label.id),
          );

          for (const labelName of feedInput.labelNames) {
            const label = labelByName.get(labelName);
            if (label === undefined) {
              throw apiError(
                500,
                "internal_error",
                `Missing label mapping for "${labelName}".`,
              );
            }
            labelIds.add(label.id);
          }

          await store.replaceSubscriptionLabels(subscription.id, [...labelIds]);
          imported += 1;
        }

        batchResults.push({
          batch_index: batchIndex,
          size: batch.length,
          status: "success",
          imported: batch.length,
        });
      } catch (error) {
        batchResults.push({
          batch_index: batchIndex,
          size: batch.length,
          status: "failed",
          imported: 0,
          error: error instanceof Error ? error.message : "Unknown batch failure.",
        });

        return c.json(
          {
            user_id: body.user_id,
            imported,
            total_feeds: feeds.length,
            total_batches: batches.length,
            batches: batchResults,
          },
          imported > 0 ? 207 : 400,
        );
      }
    }

    return c.json({
      user_id: body.user_id,
      imported,
      total_feeds: feeds.length,
      total_batches: batches.length,
      batches: batchResults,
    });
  });

  return app;
};
