import type {
  AppPassword,
  AppPasswordCreateInput,
  AppPasswordUpdateInput,
  ContinuationToken,
  Entry,
  EntryInsertInput,
  EntryReference,
  EntryStore,
  EntryView,
  Feed,
  FeedCreateInput,
  FeedListParams,
  FeedUpdateInput,
  IngestResult,
  ItemLabel,
  ItemState,
  Label,
  LabelCreateInput,
  LabelUpdateInput,
  PaginatedResult,
  PaginationParams,
  PurgeResult,
  RateLimit,
  StreamFilter,
  Subscription,
  SubscriptionCreateInput,
  SubscriptionLabel,
  SubscriptionUnreadCount,
  SubscriptionUpdateInput,
  SubscriptionView,
  UnreadCount,
  User,
  UserCreateInput,
  UserUpdateInput,
} from "@headrss/core";
import {
  D1_MAX_BOUND_PARAMS,
  INGEST_BATCH_SIZE,
  PURGE_BATCH_SIZE,
} from "@headrss/core";

interface UserRow {
  id: number;
  username: string;
  email: string | null;
  created_at: number;
}

interface AppPasswordRow {
  id: number;
  user_id: number;
  label: string;
  password_hash: string;
  password_version: number;
  last_used_at: number | null;
  created_at: number;
}

interface FeedRow {
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
}

interface SubscriptionRow {
  id: number;
  user_id: number;
  feed_id: number;
  custom_title: string | null;
  read_cursor_item_id: number | null;
}

interface LabelRow {
  id: number;
  user_id: number;
  name: string;
}

interface EntryRow {
  id: number;
  public_id: string;
  feed_id: number;
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  published_at: number;
  crawl_time_ms: number | null;
  created_at: number;
}

interface EntryListRow extends EntryRow {
  resolved_is_read: number;
  is_starred: number | null;
  starred_at: number | null;
}

interface EntryReferenceRow {
  id: number;
  public_id: string;
  feed_id: number;
  published_at: number;
}

interface ItemStateRow {
  item_id: number;
  user_id: number;
  is_read: number | null;
  is_starred: number;
  starred_at: number | null;
}

interface RateLimitRow {
  ip: string;
  endpoint: string;
  window_start: number;
  attempts: number;
}

interface LabelAssignmentRow extends LabelRow {
  subscription_id?: number;
  item_id?: number;
}

interface UnreadAggregateRow {
  stream_id: string;
  unread_count: number;
  newest_published_at: number | null;
}

interface SubscriptionUnreadRow {
  subscription_id: number;
  unread_count: number;
}

interface IdRow {
  id: number;
}

interface CountRow {
  count: number;
}

type StreamScope =
  | { kind: "feed"; feedUrl: string }
  | { kind: "reading-list" }
  | { kind: "read" }
  | { kind: "starred" }
  | { kind: "label"; labelName: string };

type TagScope =
  | { kind: "read" }
  | { kind: "starred" }
  | { kind: "reading-list" }
  | { kind: "label"; labelName: string };

const READ_STREAM_ID = "user/-/state/com.google/reading-list";
const STARRED_STREAM_ID = "user/-/state/com.google/starred";
const READ_TAG_ID = "user/-/state/com.google/read";
const LABEL_PREFIX = "user/-/label/";
const FEED_PREFIX = "feed/";

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const chunk = <T>(values: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size) as T[]);
  }
  return result;
};

const placeholders = (count: number): string =>
  Array.from({ length: count }, () => "?").join(", ");

const hasOwn = <T extends object>(value: T, key: PropertyKey): key is keyof T =>
  Object.hasOwn(value, key);

const mapUser = (row: UserRow): User => ({
  id: row.id,
  username: row.username,
  email: row.email,
  createdAt: row.created_at,
});

const mapAppPassword = (row: AppPasswordRow): AppPassword => ({
  id: row.id,
  userId: row.user_id,
  label: row.label,
  passwordHash: row.password_hash,
  passwordVersion: row.password_version,
  lastUsedAt: row.last_used_at,
  createdAt: row.created_at,
});

const mapFeed = (row: FeedRow): Feed => ({
  id: row.id,
  url: row.url,
  title: row.title,
  siteUrl: row.site_url,
  faviconUrl: row.favicon_url,
  etag: row.etag,
  lastModified: row.last_modified,
  lastFetchedAt: row.last_fetched_at,
  fetchErrorCount: row.fetch_error_count,
  nextFetchAt: row.next_fetch_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const mapSubscription = (row: SubscriptionRow): Subscription => ({
  id: row.id,
  userId: row.user_id,
  feedId: row.feed_id,
  customTitle: row.custom_title,
  readCursorItemId: row.read_cursor_item_id,
});

const mapLabel = (row: LabelRow): Label => ({
  id: row.id,
  userId: row.user_id,
  name: row.name,
});

const mapEntry = (row: EntryRow): Entry => ({
  id: row.id,
  publicId: row.public_id,
  feedId: row.feed_id,
  guid: row.guid,
  title: row.title,
  url: row.url,
  author: row.author,
  content: row.content,
  summary: row.summary,
  publishedAt: row.published_at,
  crawlTimeMs: row.crawl_time_ms,
  createdAt: row.created_at,
});

const mapItemState = (row: ItemStateRow): ItemState => ({
  itemId: row.item_id,
  userId: row.user_id,
  isRead: row.is_read,
  isStarred: row.is_starred,
  starredAt: row.starred_at,
});

const mapRateLimit = (row: RateLimitRow): RateLimit => ({
  ip: row.ip,
  endpoint: row.endpoint,
  windowStart: row.window_start,
  attempts: row.attempts,
});

const mapEntryReference = (row: EntryReferenceRow): EntryReference => ({
  id: row.id,
  publicId: row.public_id,
  feedId: row.feed_id,
  publishedAt: row.published_at,
});

const resolvedReadSql = `
  CASE
    WHEN st.is_read IS NOT NULL THEN st.is_read
    WHEN s.read_cursor_item_id IS NOT NULL AND i.id <= s.read_cursor_item_id THEN 1
    ELSE 0
  END
`;

const unreadConditionSql = `
  (
    st.is_read = 0
    OR (st.is_read IS NULL AND i.id > COALESCE(s.read_cursor_item_id, 0))
  )
`;

export class D1EntryStore implements EntryStore {
  readonly #db: D1Database;

  public constructor(db: D1Database) {
    this.#db = db;
  }

  public async getUserById(id: number): Promise<User | null> {
    const row = await this.#first<UserRow>(
      "SELECT id, username, email, created_at FROM users WHERE id = ?",
      [id],
    );
    return row ? mapUser(row) : null;
  }

  public async getUserByUsername(username: string): Promise<User | null> {
    const row = await this.#first<UserRow>(
      "SELECT id, username, email, created_at FROM users WHERE username = ?",
      [username],
    );
    return row ? mapUser(row) : null;
  }

  public async listUsers(params: PaginationParams): Promise<User[]> {
    const rows = await this.#all<UserRow>(
      `
        SELECT id, username, email, created_at
        FROM users
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `,
      [params.limit, params.offset ?? 0],
    );
    return rows.map(mapUser);
  }

  public async createUser(input: UserCreateInput): Promise<User> {
    const createdAt = input.createdAt ?? nowSeconds();
    const result = await this.#run(
      `
        INSERT INTO users (username, email, created_at)
        VALUES (?, ?, ?)
      `,
      [input.username, input.email ?? null, createdAt],
    );

    return this.#requireRow(
      await this.getUserById(result.meta.last_row_id),
      "Failed to create user.",
    );
  }

  public async updateUser(
    id: number,
    input: UserUpdateInput,
  ): Promise<User | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(input, "username")) {
      fields.push("username = ?");
      values.push(input.username);
    }
    if (hasOwn(input, "email")) {
      fields.push("email = ?");
      values.push(input.email ?? null);
    }

    if (fields.length === 0) {
      return this.getUserById(id);
    }

    const result = await this.#run(
      `UPDATE users SET ${fields.join(", ")} WHERE id = ?`,
      [...values, id],
    );

    if (result.meta.changes === 0) {
      return null;
    }

    return this.#requireRow(await this.getUserById(id), "Failed to load user.");
  }

  public async deleteUser(id: number): Promise<boolean> {
    const result = await this.#run("DELETE FROM users WHERE id = ?", [id]);
    return result.meta.changes > 0;
  }

  public async getAppPasswordById(id: number): Promise<AppPassword | null> {
    const row = await this.#first<AppPasswordRow>(
      `
        SELECT id, user_id, label, password_hash, password_version, last_used_at, created_at
        FROM app_passwords
        WHERE id = ?
      `,
      [id],
    );
    return row ? mapAppPassword(row) : null;
  }

  public async listAppPasswordsByUserId(
    userId: number,
  ): Promise<AppPassword[]> {
    const rows = await this.#all<AppPasswordRow>(
      `
        SELECT id, user_id, label, password_hash, password_version, last_used_at, created_at
        FROM app_passwords
        WHERE user_id = ?
        ORDER BY id ASC
      `,
      [userId],
    );
    return rows.map(mapAppPassword);
  }

  public async createAppPassword(
    input: AppPasswordCreateInput,
  ): Promise<AppPassword> {
    const createdAt = input.createdAt ?? nowSeconds();
    const result = await this.#run(
      `
        INSERT INTO app_passwords (
          user_id,
          label,
          password_hash,
          password_version,
          last_used_at,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [
        input.userId,
        input.label,
        input.passwordHash,
        input.passwordVersion,
        input.lastUsedAt ?? null,
        createdAt,
      ],
    );

    return this.#requireRow(
      await this.getAppPasswordById(result.meta.last_row_id),
      "Failed to create app password.",
    );
  }

  public async updateAppPassword(
    id: number,
    input: AppPasswordUpdateInput,
  ): Promise<AppPassword | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(input, "label")) {
      fields.push("label = ?");
      values.push(input.label);
    }
    if (hasOwn(input, "passwordHash")) {
      fields.push("password_hash = ?");
      values.push(input.passwordHash);
    }
    if (hasOwn(input, "passwordVersion")) {
      fields.push("password_version = ?");
      values.push(input.passwordVersion);
    }
    if (hasOwn(input, "lastUsedAt")) {
      fields.push("last_used_at = ?");
      values.push(input.lastUsedAt ?? null);
    }

    if (fields.length === 0) {
      return this.getAppPasswordById(id);
    }

    const result = await this.#run(
      `UPDATE app_passwords SET ${fields.join(", ")} WHERE id = ?`,
      [...values, id],
    );

    if (result.meta.changes === 0) {
      return null;
    }

    return this.#requireRow(
      await this.getAppPasswordById(id),
      "Failed to load app password.",
    );
  }

  public async touchAppPassword(
    id: number,
    lastUsedAt: number,
  ): Promise<boolean> {
    const result = await this.#run(
      "UPDATE app_passwords SET last_used_at = ? WHERE id = ?",
      [lastUsedAt, id],
    );
    return result.meta.changes > 0;
  }

  public async deleteAppPassword(id: number): Promise<boolean> {
    const result = await this.#run("DELETE FROM app_passwords WHERE id = ?", [
      id,
    ]);
    return result.meta.changes > 0;
  }

  public async getFeedById(id: number): Promise<Feed | null> {
    const row = await this.#first<FeedRow>(
      `
        SELECT
          id,
          url,
          title,
          site_url,
          favicon_url,
          etag,
          last_modified,
          last_fetched_at,
          fetch_error_count,
          next_fetch_at,
          created_at,
          updated_at
        FROM feeds
        WHERE id = ?
      `,
      [id],
    );
    return row ? mapFeed(row) : null;
  }

  public async getFeedByUrl(url: string): Promise<Feed | null> {
    const row = await this.#first<FeedRow>(
      `
        SELECT
          id,
          url,
          title,
          site_url,
          favicon_url,
          etag,
          last_modified,
          last_fetched_at,
          fetch_error_count,
          next_fetch_at,
          created_at,
          updated_at
        FROM feeds
        WHERE url = ?
      `,
      [url],
    );
    return row ? mapFeed(row) : null;
  }

  public async listFeeds(params: FeedListParams): Promise<Feed[]> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    if (params.dueBefore !== undefined) {
      conditions.push("next_fetch_at IS NOT NULL", "next_fetch_at <= ?");
      values.push(params.dueBefore);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const rows = await this.#all<FeedRow>(
      `
        SELECT
          id,
          url,
          title,
          site_url,
          favicon_url,
          etag,
          last_modified,
          last_fetched_at,
          fetch_error_count,
          next_fetch_at,
          created_at,
          updated_at
        FROM feeds
        ${whereClause}
        ORDER BY id ASC
        LIMIT ? OFFSET ?
      `,
      [...values, params.limit, params.offset ?? 0],
    );

    return rows.map(mapFeed);
  }

  public async listDueFeeds(
    now: number,
    params: PaginationParams,
  ): Promise<Feed[]> {
    const rows = await this.#all<FeedRow>(
      `
        SELECT
          id,
          url,
          title,
          site_url,
          favicon_url,
          etag,
          last_modified,
          last_fetched_at,
          fetch_error_count,
          next_fetch_at,
          created_at,
          updated_at
        FROM feeds
        WHERE next_fetch_at IS NULL
           OR next_fetch_at <= ?
        ORDER BY next_fetch_at ASC, id ASC
        LIMIT ? OFFSET ?
      `,
      [now, params.limit, params.offset ?? 0],
    );

    return rows.map(mapFeed);
  }

  public async createFeed(input: FeedCreateInput): Promise<Feed> {
    const createdAt = input.createdAt ?? nowSeconds();
    const updatedAt = input.updatedAt ?? createdAt;
    const result = await this.#run(
      `
        INSERT INTO feeds (
          url,
          title,
          site_url,
          favicon_url,
          etag,
          last_modified,
          last_fetched_at,
          fetch_error_count,
          next_fetch_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        input.url,
        input.title ?? null,
        input.siteUrl ?? null,
        input.faviconUrl ?? null,
        input.etag ?? null,
        input.lastModified ?? null,
        input.lastFetchedAt ?? null,
        input.fetchErrorCount ?? 0,
        input.nextFetchAt ?? null,
        createdAt,
        updatedAt,
      ],
    );

    return this.#requireRow(
      await this.getFeedById(result.meta.last_row_id),
      "Failed to create feed.",
    );
  }

  public async upsertFeed(input: FeedCreateInput): Promise<Feed> {
    const createdAt = input.createdAt ?? nowSeconds();
    const updatedAt = input.updatedAt ?? createdAt;
    const updates: string[] = ["updated_at = excluded.updated_at"];

    if (hasOwn(input, "title")) {
      updates.push("title = excluded.title");
    }
    if (hasOwn(input, "siteUrl")) {
      updates.push("site_url = excluded.site_url");
    }
    if (hasOwn(input, "faviconUrl")) {
      updates.push("favicon_url = excluded.favicon_url");
    }
    if (hasOwn(input, "etag")) {
      updates.push("etag = excluded.etag");
    }
    if (hasOwn(input, "lastModified")) {
      updates.push("last_modified = excluded.last_modified");
    }
    if (hasOwn(input, "lastFetchedAt")) {
      updates.push("last_fetched_at = excluded.last_fetched_at");
    }
    if (hasOwn(input, "fetchErrorCount")) {
      updates.push("fetch_error_count = excluded.fetch_error_count");
    }
    if (hasOwn(input, "nextFetchAt")) {
      updates.push("next_fetch_at = excluded.next_fetch_at");
    }

    await this.#run(
      `
        INSERT INTO feeds (
          url,
          title,
          site_url,
          favicon_url,
          etag,
          last_modified,
          last_fetched_at,
          fetch_error_count,
          next_fetch_at,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(url) DO UPDATE SET
          ${updates.join(", ")}
      `,
      [
        input.url,
        input.title ?? null,
        input.siteUrl ?? null,
        input.faviconUrl ?? null,
        input.etag ?? null,
        input.lastModified ?? null,
        input.lastFetchedAt ?? null,
        input.fetchErrorCount ?? 0,
        input.nextFetchAt ?? null,
        createdAt,
        updatedAt,
      ],
    );

    return this.#requireRow(
      await this.getFeedByUrl(input.url),
      "Failed to upsert feed.",
    );
  }

  public async updateFeed(
    id: number,
    input: FeedUpdateInput,
  ): Promise<Feed | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(input, "url")) {
      fields.push("url = ?");
      values.push(input.url);
    }
    if (hasOwn(input, "title")) {
      fields.push("title = ?");
      values.push(input.title ?? null);
    }
    if (hasOwn(input, "siteUrl")) {
      fields.push("site_url = ?");
      values.push(input.siteUrl ?? null);
    }
    if (hasOwn(input, "faviconUrl")) {
      fields.push("favicon_url = ?");
      values.push(input.faviconUrl ?? null);
    }
    if (hasOwn(input, "etag")) {
      fields.push("etag = ?");
      values.push(input.etag ?? null);
    }
    if (hasOwn(input, "lastModified")) {
      fields.push("last_modified = ?");
      values.push(input.lastModified ?? null);
    }
    if (hasOwn(input, "lastFetchedAt")) {
      fields.push("last_fetched_at = ?");
      values.push(input.lastFetchedAt ?? null);
    }
    if (hasOwn(input, "fetchErrorCount")) {
      fields.push("fetch_error_count = ?");
      values.push(input.fetchErrorCount);
    }
    if (hasOwn(input, "nextFetchAt")) {
      fields.push("next_fetch_at = ?");
      values.push(input.nextFetchAt ?? null);
    }

    fields.push("updated_at = ?");
    values.push(input.updatedAt ?? nowSeconds());

    const result = await this.#run(
      `UPDATE feeds SET ${fields.join(", ")} WHERE id = ?`,
      [...values, id],
    );

    if (result.meta.changes === 0) {
      return null;
    }

    return this.#requireRow(await this.getFeedById(id), "Failed to load feed.");
  }

  public async deleteFeed(id: number): Promise<boolean> {
    const result = await this.#run("DELETE FROM feeds WHERE id = ?", [id]);
    return result.meta.changes > 0;
  }

  public async getSubscriptionById(id: number): Promise<Subscription | null> {
    const row = await this.#first<SubscriptionRow>(
      `
        SELECT id, user_id, feed_id, custom_title, read_cursor_item_id
        FROM subscriptions
        WHERE id = ?
      `,
      [id],
    );
    return row ? mapSubscription(row) : null;
  }

  public async getSubscriptionByUserAndFeed(
    userId: number,
    feedId: number,
  ): Promise<Subscription | null> {
    const row = await this.#first<SubscriptionRow>(
      `
        SELECT id, user_id, feed_id, custom_title, read_cursor_item_id
        FROM subscriptions
        WHERE user_id = ? AND feed_id = ?
      `,
      [userId, feedId],
    );
    return row ? mapSubscription(row) : null;
  }

  public async listSubscriptionsByUserId(
    userId: number,
  ): Promise<SubscriptionView[]> {
    const rows = await this.#all<
      SubscriptionRow &
        FeedRow & {
          subscription_id: number;
          subscription_user_id: number;
          subscription_feed_id: number;
          custom_title: string | null;
          read_cursor_item_id: number | null;
        }
    >(
      `
        SELECT
          s.id AS subscription_id,
          s.user_id AS subscription_user_id,
          s.feed_id AS subscription_feed_id,
          s.custom_title,
          s.read_cursor_item_id,
          f.id,
          f.url,
          f.title,
          f.site_url,
          f.favicon_url,
          f.etag,
          f.last_modified,
          f.last_fetched_at,
          f.fetch_error_count,
          f.next_fetch_at,
          f.created_at,
          f.updated_at
        FROM subscriptions s
        JOIN feeds f ON f.id = s.feed_id
        WHERE s.user_id = ?
        ORDER BY s.id ASC
      `,
      [userId],
    );

    if (rows.length === 0) {
      return [];
    }

    const subscriptions = rows.map((row) => ({
      id: row.subscription_id,
      userId: row.subscription_user_id,
      feedId: row.subscription_feed_id,
      customTitle: row.custom_title,
      readCursorItemId: row.read_cursor_item_id,
      feed: mapFeed(row),
      labels: [] as Label[],
    }));

    const labelMap = await this.#labelsBySubscriptionIds(
      subscriptions.map((subscription) => subscription.id),
    );
    for (const subscription of subscriptions) {
      subscription.labels = labelMap.get(subscription.id) ?? [];
    }

    return subscriptions;
  }

  public async createSubscription(
    input: SubscriptionCreateInput,
  ): Promise<Subscription> {
    const result = await this.#run(
      `
        INSERT INTO subscriptions (
          user_id,
          feed_id,
          custom_title,
          read_cursor_item_id
        )
        VALUES (?, ?, ?, ?)
      `,
      [
        input.userId,
        input.feedId,
        input.customTitle ?? null,
        input.readCursorItemId ?? null,
      ],
    );

    return this.#requireRow(
      await this.getSubscriptionById(result.meta.last_row_id),
      "Failed to create subscription.",
    );
  }

  public async updateSubscription(
    id: number,
    input: SubscriptionUpdateInput,
  ): Promise<Subscription | null> {
    const fields: string[] = [];
    const values: unknown[] = [];

    if (hasOwn(input, "customTitle")) {
      fields.push("custom_title = ?");
      values.push(input.customTitle ?? null);
    }
    if (hasOwn(input, "readCursorItemId")) {
      fields.push("read_cursor_item_id = ?");
      values.push(input.readCursorItemId ?? null);
    }

    if (fields.length === 0) {
      return this.getSubscriptionById(id);
    }

    const result = await this.#run(
      `UPDATE subscriptions SET ${fields.join(", ")} WHERE id = ?`,
      [...values, id],
    );

    if (result.meta.changes === 0) {
      return null;
    }

    return this.#requireRow(
      await this.getSubscriptionById(id),
      "Failed to load subscription.",
    );
  }

  public async deleteSubscription(id: number): Promise<boolean> {
    const result = await this.#run("DELETE FROM subscriptions WHERE id = ?", [
      id,
    ]);
    return result.meta.changes > 0;
  }

  public async setSubscriptionReadCursor(
    id: number,
    itemId: number | null,
  ): Promise<boolean> {
    const result = await this.#run(
      "UPDATE subscriptions SET read_cursor_item_id = ? WHERE id = ?",
      [itemId, id],
    );
    return result.meta.changes > 0;
  }

  public async listSubscriptionIdsByLabel(
    userId: number,
    labelId: number,
  ): Promise<number[]> {
    const rows = await this.#all<IdRow>(
      `
        SELECT sl.subscription_id AS id
        FROM subscription_labels sl
        JOIN subscriptions s ON s.id = sl.subscription_id
        JOIN labels l ON l.id = sl.label_id
        WHERE s.user_id = ?
          AND l.user_id = ?
          AND sl.label_id = ?
        ORDER BY sl.subscription_id ASC
      `,
      [userId, userId, labelId],
    );
    return rows.map((row) => row.id);
  }

  public async getLabelById(id: number): Promise<Label | null> {
    const row = await this.#first<LabelRow>(
      "SELECT id, user_id, name FROM labels WHERE id = ?",
      [id],
    );
    return row ? mapLabel(row) : null;
  }

  public async getLabelByName(
    userId: number,
    name: string,
  ): Promise<Label | null> {
    const row = await this.#first<LabelRow>(
      "SELECT id, user_id, name FROM labels WHERE user_id = ? AND name = ?",
      [userId, name],
    );
    return row ? mapLabel(row) : null;
  }

  public async listLabelsByUserId(userId: number): Promise<Label[]> {
    const rows = await this.#all<LabelRow>(
      `
        SELECT id, user_id, name
        FROM labels
        WHERE user_id = ?
        ORDER BY name ASC, id ASC
      `,
      [userId],
    );
    return rows.map(mapLabel);
  }

  public async createLabel(input: LabelCreateInput): Promise<Label> {
    const result = await this.#run(
      `
        INSERT INTO labels (user_id, name)
        VALUES (?, ?)
      `,
      [input.userId, input.name],
    );

    return this.#requireRow(
      await this.getLabelById(result.meta.last_row_id),
      "Failed to create label.",
    );
  }

  public async updateLabel(
    id: number,
    input: LabelUpdateInput,
  ): Promise<Label | null> {
    const result = await this.#run("UPDATE labels SET name = ? WHERE id = ?", [
      input.name,
      id,
    ]);

    if (result.meta.changes === 0) {
      return null;
    }

    return this.#requireRow(
      await this.getLabelById(id),
      "Failed to load label.",
    );
  }

  public async deleteLabel(id: number): Promise<boolean> {
    const result = await this.#run("DELETE FROM labels WHERE id = ?", [id]);
    return result.meta.changes > 0;
  }

  public async listSubscriptionLabels(
    subscriptionId: number,
  ): Promise<Label[]> {
    const rows = await this.#all<LabelRow>(
      `
        SELECT l.id, l.user_id, l.name
        FROM subscription_labels sl
        JOIN labels l ON l.id = sl.label_id
        WHERE sl.subscription_id = ?
        ORDER BY l.name ASC, l.id ASC
      `,
      [subscriptionId],
    );
    return rows.map(mapLabel);
  }

  public async addSubscriptionLabel(input: SubscriptionLabel): Promise<void> {
    await this.#run(
      `
        INSERT OR IGNORE INTO subscription_labels (subscription_id, label_id)
        VALUES (?, ?)
      `,
      [input.subscriptionId, input.labelId],
    );
  }

  public async removeSubscriptionLabel(
    subscriptionId: number,
    labelId: number,
  ): Promise<void> {
    await this.#run(
      `
        DELETE FROM subscription_labels
        WHERE subscription_id = ? AND label_id = ?
      `,
      [subscriptionId, labelId],
    );
  }

  public async replaceSubscriptionLabels(
    subscriptionId: number,
    labelIds: number[],
  ): Promise<void> {
    await this.#replaceLabels(
      "subscription_labels",
      "subscription_id",
      subscriptionId,
      "label_id",
      labelIds,
    );
  }

  public async deleteSubscriptionLabelsByLabelId(
    labelId: number,
  ): Promise<number> {
    const result = await this.#run(
      "DELETE FROM subscription_labels WHERE label_id = ?",
      [labelId],
    );
    return result.meta.changes;
  }

  public async hasSubscriptionLabelReferences(
    labelId: number,
  ): Promise<boolean> {
    const row = await this.#first<{ found: number }>(
      "SELECT 1 AS found FROM subscription_labels WHERE label_id = ? LIMIT 1",
      [labelId],
    );
    return row !== null;
  }

  public async getEntryById(id: number): Promise<Entry | null> {
    const row = await this.#first<EntryRow>(
      `
        SELECT
          id,
          public_id,
          feed_id,
          guid,
          title,
          url,
          author,
          content,
          summary,
          published_at,
          crawl_time_ms,
          created_at
        FROM items
        WHERE id = ?
      `,
      [id],
    );
    return row ? mapEntry(row) : null;
  }

  public async getEntryByPublicId(publicId: string): Promise<Entry | null> {
    const row = await this.#first<EntryRow>(
      `
        SELECT
          id,
          public_id,
          feed_id,
          guid,
          title,
          url,
          author,
          content,
          summary,
          published_at,
          crawl_time_ms,
          created_at
        FROM items
        WHERE public_id = ?
      `,
      [publicId],
    );
    return row ? mapEntry(row) : null;
  }

  public async listEntryIds(
    userId: number,
    filter: StreamFilter,
  ): Promise<PaginatedResult<EntryReference>> {
    const { sql, params } = this.#buildStreamQuery(
      userId,
      filter,
      `
        SELECT
          i.id,
          i.public_id,
          i.feed_id,
          i.published_at
      `,
    );
    const rows = await this.#all<EntryReferenceRow>(sql, params);
    const page = rows.slice(0, filter.count).map(mapEntryReference);
    const result: PaginatedResult<EntryReference> = {
      items: page,
    };

    if (rows.length > filter.count) {
      const lastEntry = page.at(-1);
      if (lastEntry) {
        result.continuation = {
          publishedAt: lastEntry.publishedAt,
          id: lastEntry.id,
        };
      }
    }

    return result;
  }

  public async listEntries(
    userId: number,
    filter: StreamFilter,
  ): Promise<PaginatedResult<EntryView>> {
    const { sql, params } = this.#buildStreamQuery(
      userId,
      filter,
      `
        SELECT
          i.id,
          i.public_id,
          i.feed_id,
          i.guid,
          i.title,
          i.url,
          i.author,
          i.content,
          i.summary,
          i.published_at,
          i.crawl_time_ms,
          i.created_at,
          ${resolvedReadSql} AS resolved_is_read,
          st.is_starred,
          st.starred_at
      `,
    );
    const rows = await this.#all<EntryListRow>(sql, params);
    const pageRows = rows.slice(0, filter.count);
    const labelsByItemId = await this.#labelsByItemIds(
      userId,
      pageRows.map((row) => row.id),
    );
    const result: PaginatedResult<EntryView> = {
      items: pageRows.map((row) => ({
        ...mapEntry(row),
        state: {
          isRead: row.resolved_is_read === 1,
          isStarred: (row.is_starred ?? 0) === 1,
          starredAt: row.starred_at,
        },
        labels: labelsByItemId.get(row.id) ?? [],
      })),
    };

    if (rows.length > filter.count) {
      const lastRow = pageRows.at(-1);
      if (lastRow) {
        result.continuation = {
          publishedAt: lastRow.published_at,
          id: lastRow.id,
        };
      }
    }

    return result;
  }

  public async getEntriesByPublicIds(
    userId: number,
    publicIds: string[],
  ): Promise<EntryView[]> {
    if (publicIds.length === 0) {
      return [];
    }

    const rows: EntryListRow[] = [];
    // 2 bound params for userId in the query, rest for the IN list
    const maxIdsPerQuery = D1_MAX_BOUND_PARAMS - 2;

    for (const group of chunk(publicIds, maxIdsPerQuery)) {
      const queryRows = await this.#all<EntryListRow>(
        `
          SELECT
            i.id,
            i.public_id,
            i.feed_id,
            i.guid,
            i.title,
            i.url,
            i.author,
            i.content,
            i.summary,
            i.published_at,
            i.crawl_time_ms,
            i.created_at,
            CASE
              WHEN st.is_read IS NOT NULL THEN st.is_read
              WHEN s.read_cursor_item_id IS NOT NULL AND i.id <= s.read_cursor_item_id THEN 1
              ELSE 0
            END AS resolved_is_read,
            st.is_starred,
            st.starred_at
          FROM items i
          LEFT JOIN subscriptions s
            ON s.feed_id = i.feed_id
           AND s.user_id = ?
          LEFT JOIN item_states st
            ON st.item_id = i.id
           AND st.user_id = ?
          WHERE i.public_id IN (${placeholders(group.length)})
            AND (s.id IS NOT NULL OR COALESCE(st.is_starred, 0) = 1)
        `,
        [userId, userId, ...group],
      );
      rows.push(...queryRows);
    }

    if (rows.length === 0) {
      return [];
    }

    const labelsByItemId = await this.#labelsByItemIds(
      userId,
      rows.map((row) => row.id),
    );
    const rowMap = new Map(
      rows.map((row) => [
        row.public_id,
        {
          ...mapEntry(row),
          state: {
            isRead: row.resolved_is_read === 1,
            isStarred: (row.is_starred ?? 0) === 1,
            starredAt: row.starred_at,
          },
          labels: labelsByItemId.get(row.id) ?? [],
        } satisfies EntryView,
      ]),
    );

    return publicIds
      .map((publicId) => rowMap.get(publicId) ?? null)
      .filter((entry): entry is EntryView => entry !== null);
  }

  public async getEntriesByNumericIds(
    userId: number,
    ids: number[],
  ): Promise<EntryView[]> {
    if (ids.length === 0) {
      return [];
    }

    const rows: EntryListRow[] = [];
    // 2 bound params for userId in the query, rest for the IN list
    const maxIdsPerQuery = D1_MAX_BOUND_PARAMS - 2;

    for (const group of chunk(ids, maxIdsPerQuery)) {
      const queryRows = await this.#all<EntryListRow>(
        `
          SELECT
            i.id,
            i.public_id,
            i.feed_id,
            i.guid,
            i.title,
            i.url,
            i.author,
            i.content,
            i.summary,
            i.published_at,
            i.crawl_time_ms,
            i.created_at,
            CASE
              WHEN st.is_read IS NOT NULL THEN st.is_read
              WHEN s.read_cursor_item_id IS NOT NULL AND i.id <= s.read_cursor_item_id THEN 1
              ELSE 0
            END AS resolved_is_read,
            st.is_starred,
            st.starred_at
          FROM items i
          LEFT JOIN subscriptions s
            ON s.feed_id = i.feed_id
           AND s.user_id = ?
          LEFT JOIN item_states st
            ON st.item_id = i.id
           AND st.user_id = ?
          WHERE i.id IN (${placeholders(group.length)})
            AND (s.id IS NOT NULL OR COALESCE(st.is_starred, 0) = 1)
        `,
        [userId, userId, ...group],
      );
      rows.push(...queryRows);
    }

    if (rows.length === 0) {
      return [];
    }

    const labelsByItemId = await this.#labelsByItemIds(
      userId,
      rows.map((row) => row.id),
    );
    const rowMap = new Map(
      rows.map((row) => [
        row.id,
        {
          ...mapEntry(row),
          state: {
            isRead: row.resolved_is_read === 1,
            isStarred: (row.is_starred ?? 0) === 1,
            starredAt: row.starred_at,
          },
          labels: labelsByItemId.get(row.id) ?? [],
        } satisfies EntryView,
      ]),
    );

    return ids
      .map((id) => rowMap.get(id) ?? null)
      .filter((entry): entry is EntryView => entry !== null);
  }

  public async insertEntries(
    entries: ReadonlyArray<EntryInsertInput>,
  ): Promise<IngestResult> {
    if (entries.length === 0) {
      return { inserted: 0, skipped: 0 };
    }

    let inserted = 0;

    for (const group of chunk(entries, INGEST_BATCH_SIZE)) {
      const statements = group.map((entry) =>
        this.#db
          .prepare(
            `
              INSERT INTO items (
                public_id,
                feed_id,
                guid,
                title,
                url,
                author,
                content,
                summary,
                published_at,
                crawl_time_ms,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(feed_id, guid) DO NOTHING
            `,
          )
          .bind(
            entry.publicId,
            entry.feedId,
            entry.guid,
            entry.title ?? null,
            entry.url ?? null,
            entry.author ?? null,
            entry.content ?? null,
            entry.summary ?? null,
            entry.publishedAt,
            entry.crawlTimeMs ?? null,
            entry.createdAt ?? nowSeconds(),
          ),
      );
      const results = await this.#db.batch(statements);
      inserted += results.reduce(
        (total, result) => total + (result.meta.changes > 0 ? 1 : 0),
        0,
      );
    }

    return {
      inserted,
      skipped: entries.length - inserted,
    };
  }

  public async deleteEntry(id: number): Promise<boolean> {
    const result = await this.#run("DELETE FROM items WHERE id = ?", [id]);
    return result.meta.changes > 0;
  }

  public async getMaxItemIdForFeed(
    feedId: number,
    newestPublishedAt?: number,
  ): Promise<number | null> {
    const row =
      newestPublishedAt === undefined
        ? await this.#first<{ id: number | null }>(
            "SELECT MAX(id) AS id FROM items WHERE feed_id = ?",
            [feedId],
          )
        : await this.#first<{ id: number | null }>(
            "SELECT MAX(id) AS id FROM items WHERE feed_id = ? AND published_at <= ?",
            [feedId, newestPublishedAt],
          );

    return row?.id ?? null;
  }

  public async listEntriesForFeed(
    feedId: number,
    params: PaginationParams,
  ): Promise<Entry[]> {
    const rows = await this.#all<EntryRow>(
      `
        SELECT
          id,
          public_id,
          feed_id,
          guid,
          title,
          url,
          author,
          content,
          summary,
          published_at,
          crawl_time_ms,
          created_at
        FROM items
        WHERE feed_id = ?
        ORDER BY published_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      [feedId, params.limit, params.offset ?? 0],
    );
    return rows.map(mapEntry);
  }

  public async cleanStaleOverrides(
    userId: number,
    feedId: number,
    maxItemId: number,
  ): Promise<void> {
    await this.#run(
      `
        UPDATE item_states
        SET is_read = NULL
        WHERE user_id = ?
          AND is_starred = 1
          AND is_read IS NOT NULL
          AND item_id IN (
            SELECT id
            FROM items
            WHERE feed_id = ?
              AND id <= ?
          )
      `,
      [userId, feedId, maxItemId],
    );

    await this.#run(
      `
        DELETE FROM item_states
        WHERE user_id = ?
          AND is_starred = 0
          AND item_id IN (
            SELECT id
            FROM items
            WHERE feed_id = ?
              AND id <= ?
          )
      `,
      [userId, feedId, maxItemId],
    );
  }

  public async protectPostCutoffItems(
    userId: number,
    feedId: number,
    oldCursor: number,
    newCursor: number,
    cutoffTimestamp: number,
  ): Promise<void> {
    await this.#run(
      `
        INSERT INTO item_states (
          item_id,
          user_id,
          is_read,
          is_starred,
          starred_at
        )
        SELECT
          i.id,
          ?,
          0,
          COALESCE(st.is_starred, 0),
          st.starred_at
        FROM items i
        LEFT JOIN item_states st
          ON st.item_id = i.id
         AND st.user_id = ?
        WHERE i.feed_id = ?
          AND i.id > ?
          AND i.id <= ?
          AND i.published_at > ?
        ON CONFLICT(item_id, user_id) DO UPDATE SET
          is_read = excluded.is_read,
          is_starred = excluded.is_starred,
          starred_at = excluded.starred_at
      `,
      [userId, userId, feedId, oldCursor, newCursor, cutoffTimestamp],
    );
  }

  public async getItemState(
    userId: number,
    itemId: number,
  ): Promise<ItemState | null> {
    const row = await this.#first<ItemStateRow>(
      `
        SELECT item_id, user_id, is_read, is_starred, starred_at
        FROM item_states
        WHERE user_id = ? AND item_id = ?
      `,
      [userId, itemId],
    );
    return row ? mapItemState(row) : null;
  }

  public async listItemStates(
    userId: number,
    itemIds: number[],
  ): Promise<ItemState[]> {
    if (itemIds.length === 0) {
      return [];
    }

    const rows: ItemStateRow[] = [];
    const maxIdsPerQuery = D1_MAX_BOUND_PARAMS - 1;

    for (const group of chunk(itemIds, maxIdsPerQuery)) {
      const queryRows = await this.#all<ItemStateRow>(
        `
          SELECT item_id, user_id, is_read, is_starred, starred_at
          FROM item_states
          WHERE user_id = ?
            AND item_id IN (${placeholders(group.length)})
          ORDER BY item_id ASC
        `,
        [userId, ...group],
      );
      rows.push(...queryRows);
    }

    return rows.map(mapItemState);
  }

  public async upsertItemState(input: ItemState): Promise<ItemState> {
    await this.#run(
      `
        INSERT INTO item_states (
          item_id,
          user_id,
          is_read,
          is_starred,
          starred_at
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(item_id, user_id) DO UPDATE SET
          is_read = excluded.is_read,
          is_starred = excluded.is_starred,
          starred_at = excluded.starred_at
      `,
      [
        input.itemId,
        input.userId,
        input.isRead,
        input.isStarred,
        input.starredAt,
      ],
    );

    return this.#requireRow(
      await this.getItemState(input.userId, input.itemId),
      "Failed to load item state.",
    );
  }

  public async deleteItemState(
    userId: number,
    itemId: number,
  ): Promise<boolean> {
    const result = await this.#run(
      "DELETE FROM item_states WHERE user_id = ? AND item_id = ?",
      [userId, itemId],
    );
    return result.meta.changes > 0;
  }

  public async listItemLabels(
    userId: number,
    itemId: number,
  ): Promise<Label[]> {
    const rows = await this.#all<LabelRow>(
      `
        SELECT l.id, l.user_id, l.name
        FROM item_labels il
        JOIN labels l ON l.id = il.label_id
        WHERE il.user_id = ? AND il.item_id = ?
        ORDER BY l.name ASC, l.id ASC
      `,
      [userId, itemId],
    );
    return rows.map(mapLabel);
  }

  public async addItemLabel(input: ItemLabel): Promise<void> {
    await this.#run(
      `
        INSERT OR IGNORE INTO item_labels (user_id, item_id, label_id)
        VALUES (?, ?, ?)
      `,
      [input.userId, input.itemId, input.labelId],
    );
  }

  public async removeItemLabel(
    userId: number,
    itemId: number,
    labelId: number,
  ): Promise<void> {
    await this.#run(
      `
        DELETE FROM item_labels
        WHERE user_id = ? AND item_id = ? AND label_id = ?
      `,
      [userId, itemId, labelId],
    );
  }

  public async replaceItemLabels(
    userId: number,
    itemId: number,
    labelIds: number[],
  ): Promise<void> {
    await this.#replaceItemLabelsInternal(userId, itemId, labelIds);
  }

  public async deleteItemLabelsByLabelId(
    userId: number,
    labelId: number,
  ): Promise<number> {
    const result = await this.#run(
      "DELETE FROM item_labels WHERE user_id = ? AND label_id = ?",
      [userId, labelId],
    );
    return result.meta.changes;
  }

  public async hasItemLabelReferences(
    userId: number,
    labelId: number,
  ): Promise<boolean> {
    const row = await this.#first<{ found: number }>(
      "SELECT 1 AS found FROM item_labels WHERE user_id = ? AND label_id = ? LIMIT 1",
      [userId, labelId],
    );
    return row !== null;
  }

  public async getUnreadCounts(userId: number): Promise<UnreadCount[]> {
    const subscriptionRows = await this.#all<UnreadAggregateRow>(
      `
        SELECT
          ('feed/' || f.url) AS stream_id,
          COUNT(*) AS unread_count,
          MAX(i.published_at) AS newest_published_at
        FROM subscriptions s
        JOIN feeds f ON f.id = s.feed_id
        JOIN items i ON i.feed_id = s.feed_id
        LEFT JOIN item_states st
          ON st.item_id = i.id
         AND st.user_id = s.user_id
        WHERE s.user_id = ?
          AND ${unreadConditionSql}
        GROUP BY s.id, f.url
        ORDER BY f.url ASC
      `,
      [userId],
    );
    const labelRows = await this.#all<UnreadAggregateRow>(
      `
        SELECT
          (? || l.name) AS stream_id,
          COUNT(*) AS unread_count,
          MAX(i.published_at) AS newest_published_at
        FROM labels l
        JOIN subscription_labels sl ON sl.label_id = l.id
        JOIN subscriptions s
          ON s.id = sl.subscription_id
         AND s.user_id = l.user_id
        JOIN items i ON i.feed_id = s.feed_id
        LEFT JOIN item_states st
          ON st.item_id = i.id
         AND st.user_id = s.user_id
        WHERE l.user_id = ?
          AND ${unreadConditionSql}
        GROUP BY l.id, l.name
        ORDER BY l.name ASC
      `,
      [LABEL_PREFIX, userId],
    );

    const counts: UnreadCount[] = [];
    const readingListCount = subscriptionRows.reduce(
      (total, row) => total + row.unread_count,
      0,
    );
    const newestReadingListItem = subscriptionRows.reduce<number>(
      (latest, row) => Math.max(latest, row.newest_published_at ?? 0),
      0,
    );

    if (readingListCount > 0) {
      counts.push({
        streamId: READ_STREAM_ID,
        count: readingListCount,
        newestItemTimestampUsec: `${newestReadingListItem * 1_000_000}`,
      });
    }

    for (const row of subscriptionRows) {
      counts.push({
        streamId: row.stream_id,
        count: row.unread_count,
        newestItemTimestampUsec: `${(row.newest_published_at ?? 0) * 1_000_000}`,
      });
    }

    for (const row of labelRows) {
      counts.push({
        streamId: row.stream_id,
        count: row.unread_count,
        newestItemTimestampUsec: `${(row.newest_published_at ?? 0) * 1_000_000}`,
      });
    }

    return counts;
  }

  public async recountUnreadCounts(
    userId?: number,
  ): Promise<SubscriptionUnreadCount[]> {
    const rows = await this.#all<SubscriptionUnreadRow>(
      `
        SELECT
          s.id AS subscription_id,
          COALESCE(
            SUM(
              CASE
                WHEN i.id IS NOT NULL AND ${unreadConditionSql}
                  THEN 1
                ELSE 0
              END
            ),
            0
          ) AS unread_count
        FROM subscriptions s
        LEFT JOIN items i ON i.feed_id = s.feed_id
        LEFT JOIN item_states st
          ON st.item_id = i.id
         AND st.user_id = s.user_id
        WHERE (? IS NULL OR s.user_id = ?)
        GROUP BY s.id
        ORDER BY s.id ASC
      `,
      [userId ?? null, userId ?? null],
    );

    return rows.map((row) => ({
      subscriptionId: row.subscription_id,
      unreadCount: row.unread_count,
    }));
  }

  public async purgeItemsOlderThan(
    cutoffTimestamp: number,
    batchSize = PURGE_BATCH_SIZE,
  ): Promise<PurgeResult> {
    const effectiveBatchSize = Math.max(
      1,
      Math.min(batchSize, PURGE_BATCH_SIZE),
    );
    const starredRow = await this.#first<CountRow>(
      `
        SELECT COUNT(DISTINCT i.id) AS count
        FROM items i
        JOIN item_states st ON st.item_id = i.id
        WHERE i.published_at < ?
          AND st.is_starred = 1
      `,
      [cutoffTimestamp],
    );
    const unreadOverrideRow = await this.#first<CountRow>(
      `
        SELECT COUNT(DISTINCT i.id) AS count
        FROM items i
        JOIN item_states st ON st.item_id = i.id
        WHERE i.published_at < ?
          AND st.is_read = 0
          AND NOT EXISTS (
            SELECT 1
            FROM item_states starred
            WHERE starred.item_id = i.id
              AND starred.is_starred = 1
          )
      `,
      [cutoffTimestamp],
    );

    let deleted = 0;

    for (;;) {
      const candidateRows = await this.#all<IdRow>(
        `
          SELECT i.id
          FROM items i
          WHERE i.published_at < ?
            AND i.id NOT IN (
              SELECT item_id
              FROM item_states
              WHERE is_starred = 1 OR is_read = 0
            )
            AND NOT EXISTS (
              SELECT 1
              FROM subscriptions s
              WHERE s.feed_id = i.feed_id
                AND i.id > COALESCE(s.read_cursor_item_id, 0)
            )
          LIMIT ?
        `,
        [cutoffTimestamp, effectiveBatchSize],
      );

      if (candidateRows.length === 0) {
        break;
      }

      const statements = candidateRows.flatMap((row) => [
        this.#db
          .prepare("DELETE FROM item_labels WHERE item_id = ?")
          .bind(row.id),
        this.#db
          .prepare("DELETE FROM item_states WHERE item_id = ?")
          .bind(row.id),
        this.#db.prepare("DELETE FROM items WHERE id = ?").bind(row.id),
      ]);
      await this.#db.batch(statements);
      deleted += candidateRows.length;
    }

    return {
      deleted,
      skippedStarred: starredRow?.count ?? 0,
      skippedUnreadOverride: unreadOverrideRow?.count ?? 0,
    };
  }

  public async getRateLimit(
    ip: string,
    endpoint: string,
  ): Promise<RateLimit | null> {
    const row = await this.#first<RateLimitRow>(
      `
        SELECT ip, endpoint, window_start, attempts
        FROM rate_limits
        WHERE ip = ? AND endpoint = ?
      `,
      [ip, endpoint],
    );
    return row ? mapRateLimit(row) : null;
  }

  public async incrementRateLimit(
    ip: string,
    endpoint: string,
    windowStart: number,
  ): Promise<RateLimit> {
    await this.#run(
      `
        INSERT INTO rate_limits (ip, endpoint, window_start, attempts)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(ip, endpoint) DO UPDATE SET
          window_start = CASE
            WHEN rate_limits.window_start = excluded.window_start
              THEN rate_limits.window_start
            ELSE excluded.window_start
          END,
          attempts = CASE
            WHEN rate_limits.window_start = excluded.window_start
              THEN rate_limits.attempts + 1
            ELSE 1
          END
      `,
      [ip, endpoint, windowStart],
    );

    return this.#requireRow(
      await this.getRateLimit(ip, endpoint),
      "Failed to load rate limit row.",
    );
  }

  public async resetRateLimit(ip: string, endpoint: string): Promise<void> {
    await this.#run("DELETE FROM rate_limits WHERE ip = ? AND endpoint = ?", [
      ip,
      endpoint,
    ]);
  }

  public async deleteExpiredRateLimits(
    cutoffTimestamp: number,
  ): Promise<number> {
    const result = await this.#run(
      "DELETE FROM rate_limits WHERE window_start < ?",
      [cutoffTimestamp],
    );
    return result.meta.changes;
  }

  async #first<TRow>(
    sql: string,
    params: readonly unknown[],
  ): Promise<TRow | null> {
    return (
      (await this.#db
        .prepare(sql)
        .bind(...params)
        .first<TRow>()) ?? null
    );
  }

  async #all<TRow>(sql: string, params: readonly unknown[]): Promise<TRow[]> {
    const result = await this.#db
      .prepare(sql)
      .bind(...params)
      .all<TRow>();
    return result.results;
  }

  async #run(
    sql: string,
    params: readonly unknown[],
  ): Promise<D1Result<Record<string, unknown>>> {
    return this.#db
      .prepare(sql)
      .bind(...params)
      .run();
  }

  #requireRow<T>(value: T | null, message: string): T {
    if (value === null) {
      throw new Error(message);
    }
    return value;
  }

  #buildStreamQuery(
    userId: number,
    filter: StreamFilter,
    selectClause: string,
  ): { sql: string; params: unknown[] } {
    const scope = this.#parseStreamScope(filter.streamId);
    const joins: string[] = [];
    const conditions: string[] = [];
    const params: unknown[] = [];

    switch (scope.kind) {
      case "feed":
        joins.push("JOIN feeds f ON f.id = i.feed_id");
        joins.push(
          "JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?",
        );
        params.push(userId);
        conditions.push("f.url = ?");
        params.push(scope.feedUrl);
        break;
      case "reading-list":
        joins.push(
          "JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?",
        );
        params.push(userId);
        break;
      case "label":
        joins.push(
          "JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?",
        );
        joins.push("JOIN subscription_labels sl ON sl.subscription_id = s.id");
        joins.push(
          "JOIN labels stream_label ON stream_label.id = sl.label_id AND stream_label.user_id = ?",
        );
        params.push(userId, userId);
        conditions.push("stream_label.name = ?");
        params.push(scope.labelName);
        break;
      case "read":
        joins.push(
          "JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?",
        );
        params.push(userId);
        break;
      case "starred":
        joins.push(
          "LEFT JOIN subscriptions s ON s.feed_id = i.feed_id AND s.user_id = ?",
        );
        params.push(userId);
        break;
    }

    joins.push(
      "LEFT JOIN item_states st ON st.item_id = i.id AND st.user_id = ?",
    );
    params.push(userId);

    if (scope.kind === "read") {
      conditions.push(`${resolvedReadSql} = 1`);
    }

    if (scope.kind === "starred") {
      conditions.push("COALESCE(st.is_starred, 0) = 1");
    }

    if (filter.oldestTimestamp !== undefined) {
      conditions.push("i.published_at > ?");
      params.push(filter.oldestTimestamp);
    }

    if (filter.newestTimestamp !== undefined) {
      conditions.push("i.published_at < ?");
      params.push(filter.newestTimestamp);
    }

    if (filter.continuation) {
      conditions.push(
        filter.sortOrder === "newest"
          ? "(i.published_at, i.id) < (?, ?)"
          : "(i.published_at, i.id) > (?, ?)",
      );
      params.push(filter.continuation.publishedAt, filter.continuation.id);
    }

    const includeTags =
      filter.includeTags ??
      (filter.includeTag === undefined ? [] : [filter.includeTag]);
    for (const tag of includeTags) {
      const includeTag = this.#buildTagCondition(userId, tag, false);
      conditions.push(includeTag.sql);
      params.push(...includeTag.params);
    }

    if (filter.excludeTag) {
      const excludeTag = this.#buildTagCondition(
        userId,
        filter.excludeTag,
        true,
      );
      conditions.push(excludeTag.sql);
      params.push(...excludeTag.params);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const orderDirection = filter.sortOrder === "newest" ? "DESC" : "ASC";

    return {
      sql: `
        ${selectClause}
        FROM items i
        ${joins.join("\n")}
        ${whereClause}
        ORDER BY i.published_at ${orderDirection}, i.id ${orderDirection}
        LIMIT ?
      `,
      params: [...params, filter.count + 1],
    };
  }

  #buildTagCondition(
    userId: number,
    tag: string,
    negate: boolean,
  ): { sql: string; params: unknown[] } {
    const scope = this.#parseTagScope(tag);
    let sql: string;
    const params: unknown[] = [];

    switch (scope.kind) {
      case "read":
        sql = `${resolvedReadSql} = 1`;
        break;
      case "starred":
        sql = "COALESCE(st.is_starred, 0) = 1";
        break;
      case "reading-list":
        sql = "s.id IS NOT NULL";
        break;
      case "label":
        sql = `
          EXISTS (
            SELECT 1
            FROM item_labels il
            JOIN labels item_label
              ON item_label.id = il.label_id
             AND item_label.user_id = ?
            WHERE il.user_id = ?
              AND il.item_id = i.id
              AND item_label.name = ?
          )
        `;
        params.push(userId, userId, scope.labelName);
        break;
    }

    return {
      sql: negate ? `NOT (${sql})` : `(${sql})`,
      params,
    };
  }

  #parseStreamScope(streamId: string): StreamScope {
    if (streamId === READ_STREAM_ID) {
      return { kind: "reading-list" };
    }
    if (streamId === READ_TAG_ID) {
      return { kind: "read" };
    }
    if (streamId === STARRED_STREAM_ID) {
      return { kind: "starred" };
    }
    if (streamId.startsWith(FEED_PREFIX)) {
      return { kind: "feed", feedUrl: streamId.slice(FEED_PREFIX.length) };
    }
    if (streamId.startsWith(LABEL_PREFIX)) {
      return { kind: "label", labelName: streamId.slice(LABEL_PREFIX.length) };
    }
    throw new Error(`Unsupported stream ID: ${streamId}`);
  }

  #parseTagScope(tag: string): TagScope {
    if (tag === READ_TAG_ID) {
      return { kind: "read" };
    }
    if (tag === STARRED_STREAM_ID) {
      return { kind: "starred" };
    }
    if (tag === READ_STREAM_ID) {
      return { kind: "reading-list" };
    }
    if (tag.startsWith(LABEL_PREFIX)) {
      return { kind: "label", labelName: tag.slice(LABEL_PREFIX.length) };
    }
    throw new Error(`Unsupported tag filter: ${tag}`);
  }

  async #labelsBySubscriptionIds(
    subscriptionIds: number[],
  ): Promise<Map<number, Label[]>> {
    const labelsBySubscriptionId = new Map<number, Label[]>();

    if (subscriptionIds.length === 0) {
      return labelsBySubscriptionId;
    }

    const maxIdsPerQuery = D1_MAX_BOUND_PARAMS;
    for (const group of chunk(subscriptionIds, maxIdsPerQuery)) {
      const rows = await this.#all<LabelAssignmentRow>(
        `
          SELECT
            sl.subscription_id,
            l.id,
            l.user_id,
            l.name
          FROM subscription_labels sl
          JOIN labels l ON l.id = sl.label_id
          WHERE sl.subscription_id IN (${placeholders(group.length)})
          ORDER BY sl.subscription_id ASC, l.name ASC, l.id ASC
        `,
        group,
      );
      for (const row of rows) {
        const subscriptionId = row.subscription_id;
        if (subscriptionId === undefined) {
          continue;
        }
        const labels = labelsBySubscriptionId.get(subscriptionId) ?? [];
        labels.push(mapLabel(row));
        labelsBySubscriptionId.set(subscriptionId, labels);
      }
    }

    return labelsBySubscriptionId;
  }

  async #labelsByItemIds(
    userId: number,
    itemIds: number[],
  ): Promise<Map<number, Label[]>> {
    const labelsByItemId = new Map<number, Label[]>();

    if (itemIds.length === 0) {
      return labelsByItemId;
    }

    const maxIdsPerQuery = D1_MAX_BOUND_PARAMS - 1;
    for (const group of chunk(itemIds, maxIdsPerQuery)) {
      const rows = await this.#all<LabelAssignmentRow>(
        `
          SELECT
            il.item_id,
            l.id,
            l.user_id,
            l.name
          FROM item_labels il
          JOIN labels l ON l.id = il.label_id
          WHERE il.user_id = ?
            AND il.item_id IN (${placeholders(group.length)})
          ORDER BY il.item_id ASC, l.name ASC, l.id ASC
        `,
        [userId, ...group],
      );
      for (const row of rows) {
        const itemId = row.item_id;
        if (itemId === undefined) {
          continue;
        }
        const labels = labelsByItemId.get(itemId) ?? [];
        labels.push(mapLabel(row));
        labelsByItemId.set(itemId, labels);
      }
    }

    return labelsByItemId;
  }

  async #replaceLabels(
    table: "subscription_labels",
    ownerColumn: "subscription_id",
    ownerId: number,
    labelColumn: "label_id",
    labelIds: number[],
  ): Promise<void> {
    await this.#run(`DELETE FROM ${table} WHERE ${ownerColumn} = ?`, [ownerId]);

    if (labelIds.length === 0) {
      return;
    }

    for (const group of chunk(labelIds, INGEST_BATCH_SIZE)) {
      const statements = group.map((labelId) =>
        this.#db
          .prepare(
            `
              INSERT OR IGNORE INTO ${table} (${ownerColumn}, ${labelColumn})
              VALUES (?, ?)
            `,
          )
          .bind(ownerId, labelId),
      );
      await this.#db.batch(statements);
    }
  }

  async #replaceItemLabelsInternal(
    userId: number,
    itemId: number,
    labelIds: number[],
  ): Promise<void> {
    await this.#run(
      "DELETE FROM item_labels WHERE user_id = ? AND item_id = ?",
      [userId, itemId],
    );

    if (labelIds.length === 0) {
      return;
    }

    for (const group of chunk(labelIds, INGEST_BATCH_SIZE)) {
      const statements = group.map((labelId) =>
        this.#db
          .prepare(
            `
              INSERT OR IGNORE INTO item_labels (user_id, item_id, label_id)
              VALUES (?, ?, ?)
            `,
          )
          .bind(userId, itemId, labelId),
      );
      await this.#db.batch(statements);
    }
  }
}
