import type { FeedMetaUpdate } from "@headrss/core";

import { getHeadrssUrl } from "./config.js";

export interface TokenResponse {
  expiresIn: number;
  token: string;
  tokenType: "Bearer";
}

export interface NativeLabel {
  id: number;
  userId: number;
  name: string;
}

export interface NativeFeed {
  id: number;
  url: string;
  title: string | null;
  siteUrl: string | null;
  faviconUrl: string | null;
  etag: string | null;
  lastModified: string | null;
  lastFetchedAt: number | null;
  fetchErrorCount: number;
  nextFetchAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface NativeSubscription {
  id: number;
  feedId: number;
  title: string | null;
  readCursorItemId: number | null;
  feed: NativeFeed;
  folders: NativeLabel[];
}

export interface AdminUser {
  id: number;
  username: string;
  email: string | null;
  created_at: number;
}

export interface AdminAppPassword {
  id: number;
  user_id: number;
  label: string;
  last_used_at: number | null;
  created_at: number;
}

export interface AdminFeed {
  id: number;
  url: string;
  title: string | null;
  site_url: string | null;
  favicon_url: string | null;
  etag: string | null;
  last_modified: string | null;
  last_fetched_at: number | null;
  fetch_error_count: number;
  next_fetch_at: number | null;
  created_at: number;
  updated_at: number;
  has_credentials: boolean;
}

export interface FeedCredentials {
  feed_id: number;
  auth_type: string;
  credentials: unknown;
  created_at: number;
}

export interface AdminPaginationResponse<T> {
  items: T[];
  limit: number;
  offset: number;
}

export interface IngestPushResult {
  inserted: number;
  skipped: number;
  failedBatches?: Array<{
    index: number;
    size: number;
    error: string;
  }>;
}

export interface IngestItemPayload {
  guid: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  content?: string | null;
  summary?: string | null;
  publishedAt: number;
}

type AuthConfig =
  | { kind: "admin"; apiKey: string }
  | { kind: "fetch"; apiKey: string }
  | { kind: "ingest"; apiKey: string }
  | { kind: "native"; token: string };

interface RequestOptions {
  auth: AuthConfig;
  body?: unknown;
  expectedStatus?: number | number[];
  headers?: Record<string, string>;
  method?: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly responseBody: unknown;

  constructor(status: number, message: string, responseBody: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.responseBody = responseBody;
  }
}

export class HeadrssApiClient {
  #baseUrl: string | undefined;

  constructor(baseUrl?: string) {
    this.#baseUrl = baseUrl;
  }

  get baseUrl(): string {
    this.#baseUrl ??= getHeadrssUrl();
    return this.#baseUrl;
  }

  async exchangeToken(username: string, password: string): Promise<TokenResponse> {
    return this.request<TokenResponse>({
      auth: { kind: "native", token: "" },
      body: { username, password },
      method: "POST",
      path: "/api/native/v0/auth/token",
    });
  }

  async listSubscriptions(token: string): Promise<{ items: NativeSubscription[] }> {
    return this.request({
      auth: { kind: "native", token },
      path: "/api/native/v0/subscriptions",
    });
  }

  async addSubscription(
    token: string,
    input: {
      folder?: number | null;
      title?: string | null;
      url: string;
    },
  ): Promise<NativeSubscription> {
    return this.request({
      auth: { kind: "native", token },
      body: input,
      method: "POST",
      path: "/api/native/v0/subscriptions",
    });
  }

  async deleteSubscription(token: string, id: number): Promise<{ ok: true }> {
    return this.request({
      auth: { kind: "native", token },
      method: "DELETE",
      path: `/api/native/v0/subscriptions/${id}`,
    });
  }

  async listFolders(token: string): Promise<{ items: NativeLabel[] }> {
    return this.request({
      auth: { kind: "native", token },
      path: "/api/native/v0/folders",
    });
  }

  async addFolder(token: string, name: string): Promise<NativeLabel> {
    return this.request({
      auth: { kind: "native", token },
      body: { name },
      method: "POST",
      path: "/api/native/v0/folders",
    });
  }

  async deleteFolder(token: string, id: number): Promise<{ ok: true }> {
    return this.request({
      auth: { kind: "native", token },
      method: "DELETE",
      path: `/api/native/v0/folders/${id}`,
    });
  }

  async listUsers(apiKey: string): Promise<AdminUser[]> {
    return this.listAllPages<AdminUser>({
      auth: { kind: "admin", apiKey },
      path: "/admin/users",
    });
  }

  async addUser(
    apiKey: string,
    username: string,
    email?: string,
  ): Promise<AdminUser> {
    return this.request({
      auth: { kind: "admin", apiKey },
      body: email === undefined ? { username } : { email, username },
      expectedStatus: 201,
      method: "POST",
      path: "/admin/users",
    });
  }

  async deleteUser(apiKey: string, id: number): Promise<{ deleted: true; id: number }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      method: "DELETE",
      path: `/admin/users/${id}`,
    });
  }

  async listAppPasswords(apiKey: string, userId: number): Promise<{
    items: AdminAppPassword[];
    user_id: number;
  }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      path: `/admin/users/${userId}/app-passwords`,
    });
  }

  async addAppPassword(
    apiKey: string,
    userId: number,
    label: string,
  ): Promise<{
    app_password: AdminAppPassword;
    plaintext_password: string;
  }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      body: { label },
      expectedStatus: 201,
      method: "POST",
      path: `/admin/users/${userId}/app-passwords`,
    });
  }

  async deleteAppPassword(
    apiKey: string,
    id: number,
  ): Promise<{ deleted: true; id: number }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      method: "DELETE",
      path: `/admin/app-passwords/${id}`,
    });
  }

  async listFeeds(apiKey: string): Promise<AdminFeed[]> {
    return this.listAllPages<AdminFeed>({
      auth: { kind: "admin", apiKey },
      path: "/admin/feeds",
    });
  }

  async listDueFeeds(apiKey: string): Promise<AdminFeed[]> {
    return this.listAllPages<AdminFeed>({
      auth: { kind: "fetch", apiKey },
      path: "/admin/feeds/due",
    });
  }

  async deleteFeed(apiKey: string, id: number): Promise<{ deleted: true; id: number }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      method: "DELETE",
      path: `/admin/feeds/${id}`,
    });
  }

  async updateAdminFeed(
    apiKey: string,
    id: number,
    body: {
      url?: string;
    },
  ): Promise<AdminFeed> {
    return this.request({
      auth: { kind: "admin", apiKey },
      body,
      method: "PUT",
      path: `/admin/feeds/${id}`,
    });
  }

  async getFeedCredentials(apiKey: string, feedId: number): Promise<FeedCredentials> {
    return this.request({
      auth: { kind: "fetch", apiKey },
      path: `/admin/feeds/${feedId}/credentials`,
    });
  }

  async importOpml(
    apiKey: string,
    userId: number,
    opml: string,
  ): Promise<unknown> {
    return this.request({
      auth: { kind: "admin", apiKey },
      body: {
        opml,
        user_id: userId,
      },
      method: "POST",
      path: "/admin/opml/import",
    });
  }

  async exportOpml(
    apiKey: string,
    userId: number,
  ): Promise<{ opml: string; user_id: number }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      path: `/admin/opml/export/${userId}`,
    });
  }

  async purge(
    apiKey: string,
    retentionDays: number,
  ): Promise<{
    cutoff_timestamp: number;
    deleted: number;
    retention_days: number;
    skipped_starred: number;
    skipped_unread_override: number;
  }> {
    return this.request({
      auth: { kind: "admin", apiKey },
      body: { retention_days: retentionDays },
      method: "POST",
      path: "/admin/maintenance/purge",
    });
  }

  async ingestItems(
    apiKey: string,
    feedId: number,
    items: IngestItemPayload[],
  ): Promise<IngestPushResult> {
    return this.request({
      auth: { kind: "ingest", apiKey },
      body: items,
      expectedStatus: [200, 207],
      method: "POST",
      path: `/ingest/feeds/${feedId}/items`,
    });
  }

  async updateIngestFeed(
    apiKey: string,
    feedId: number,
    meta: FeedMetaUpdate,
  ): Promise<unknown> {
    return this.request({
      auth: { kind: "ingest", apiKey },
      body: meta,
      method: "PUT",
      path: `/ingest/feeds/${feedId}`,
    });
  }

  private async listAllPages<T>(input: {
    auth: Extract<AuthConfig, { kind: "admin" | "fetch" }>;
    path: string;
  }): Promise<T[]> {
    const items: T[] = [];
    const limit = 500;
    let offset = 0;

    while (true) {
      const page = await this.request<AdminPaginationResponse<T>>({
        auth: input.auth,
        path: `${input.path}?limit=${limit}&offset=${offset}`,
      });
      items.push(...page.items);

      if (page.items.length < limit) {
        return items;
      }

      offset += limit;
    }
  }

  private async request<T>(options: RequestOptions): Promise<T> {
    const headers = new Headers(options.headers);

    if (options.auth.kind === "admin" || options.auth.kind === "fetch" || options.auth.kind === "ingest") {
      headers.set("Authorization", `Bearer ${options.auth.apiKey}`);
    } else if (options.auth.token.length > 0) {
      headers.set("Authorization", `Bearer ${options.auth.token}`);
    }

    let body: string | undefined;

    if (options.body !== undefined) {
      body = JSON.stringify(options.body);
      headers.set("Content-Type", "application/json");
    }

    const response = await fetch(new URL(options.path, this.baseUrl), {
      ...(body === undefined ? {} : { body }),
      headers,
      method: options.method ?? "GET",
    });

    const parsedBody = await parseResponseBody(response);
    const expected = Array.isArray(options.expectedStatus)
      ? options.expectedStatus
      : [options.expectedStatus ?? 200];

    if (!expected.includes(response.status)) {
      throw new ApiClientError(response.status, getErrorMessage(parsedBody, response), parsedBody);
    }

    return parsedBody as T;
  }
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text) as unknown;
  }

  return text;
}

function getErrorMessage(body: unknown, response: Response): string {
  if (typeof body === "object" && body !== null) {
    const error = (body as { error?: { message?: unknown } }).error;
    if (error !== undefined && typeof error.message === "string") {
      return error.message;
    }
  }

  if (typeof body === "string" && body.length > 0) {
    return body;
  }

  return `${response.status} ${response.statusText}`.trim();
}
