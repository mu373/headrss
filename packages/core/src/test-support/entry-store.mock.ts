import {
  parseStreamId,
  READING_LIST_STREAM_ID,
  READ_STREAM_ID,
  STARRED_STREAM_ID,
  toFeedStreamId,
} from "../internal/stream-id.js";
import type {
  EntryInsertInput,
  EntryReference,
  EntryStateView,
  EntryView,
  FeedCreateInput,
  FeedListParams,
  FeedUpdateInput,
  PaginatedResult,
  SubscriptionCreateInput,
  SubscriptionUnreadCount,
  SubscriptionUpdateInput,
  SubscriptionView,
  UserCreateInput,
  UserUpdateInput,
} from "../ports/entry-store.js";
import type {
  AppPassword,
  ContinuationToken,
  Entry,
  Feed,
  IngestResult,
  ItemLabel,
  ItemState,
  Label,
  PaginationParams,
  RateLimit,
  StreamFilter,
  Subscription,
  SubscriptionLabel,
  UnreadCount,
  User,
} from "../types.js";

export class InMemoryEntryStore {
  private users = new Map<number, User>();
  private feeds = new Map<number, Feed>();
  private subscriptions = new Map<number, Subscription>();
  private labels = new Map<number, Label>();
  private entries = new Map<number, Entry>();
  private itemStates = new Map<string, ItemState>();
  private subscriptionLabels = new Set<string>();
  private itemLabels = new Set<string>();

  private nextUserId = 1;
  private nextFeedId = 1;
  private nextSubscriptionId = 1;
  private nextLabelId = 1;
  private nextEntryId = 1;

  readonly insertEntriesBatchSizes: number[] = [];
  readonly getEntriesByPublicIdsBatchSizes: number[] = [];

  seedUser(input: { username: string; email?: string | null; createdAt?: number } & Partial<User>): User {
    const user: User = {
      id: input.id ?? this.nextUserId++,
      username: input.username,
      email: input.email ?? null,
      createdAt: input.createdAt ?? 0,
    };

    this.users.set(user.id, user);
    this.nextUserId = Math.max(this.nextUserId, user.id + 1);

    return user;
  }

  seedFeed(input: { url: string } & Partial<Feed>): Feed {
    const feed: Feed = {
      id: input.id ?? this.nextFeedId++,
      url: input.url,
      title: input.title ?? null,
      siteUrl: input.siteUrl ?? null,
      faviconUrl: input.faviconUrl ?? null,
      etag: input.etag ?? null,
      lastModified: input.lastModified ?? null,
      lastFetchedAt: input.lastFetchedAt ?? null,
      fetchErrorCount: input.fetchErrorCount ?? 0,
      nextFetchAt: input.nextFetchAt ?? null,
      createdAt: input.createdAt ?? 0,
      updatedAt: input.updatedAt ?? 0,
    };

    this.feeds.set(feed.id, feed);
    this.nextFeedId = Math.max(this.nextFeedId, feed.id + 1);

    return feed;
  }

  seedSubscription(
    input: {
      userId: number;
      feedId: number;
      customTitle?: string | null;
      readCursorItemId?: number | null;
    } & Partial<Subscription>,
  ): Subscription {
    const subscription: Subscription = {
      id: input.id ?? this.nextSubscriptionId++,
      userId: input.userId,
      feedId: input.feedId,
      customTitle: input.customTitle ?? null,
      readCursorItemId: input.readCursorItemId ?? null,
    };

    this.subscriptions.set(subscription.id, subscription);
    this.nextSubscriptionId = Math.max(this.nextSubscriptionId, subscription.id + 1);

    return subscription;
  }

  seedLabel(input: { userId: number; name: string } & Partial<Label>): Label {
    const label: Label = {
      id: input.id ?? this.nextLabelId++,
      userId: input.userId,
      name: input.name,
    };

    this.labels.set(label.id, label);
    this.nextLabelId = Math.max(this.nextLabelId, label.id + 1);

    return label;
  }

  seedEntry(
    input: {
      feedId: number;
      guid?: string;
      publicId?: string;
      publishedAt: number;
      title?: string | null;
      url?: string | null;
      author?: string | null;
      content?: string | null;
      summary?: string | null;
      crawlTimeMs?: number | null;
      createdAt?: number;
    } & Partial<Entry>,
  ): Entry {
    const entry: Entry = {
      id: input.id ?? this.nextEntryId++,
      publicId: input.publicId ?? `entry-${input.id ?? this.nextEntryId - 1}`,
      feedId: input.feedId,
      guid: input.guid ?? `guid-${input.id ?? this.nextEntryId - 1}`,
      title: input.title ?? null,
      url: input.url ?? null,
      author: input.author ?? null,
      content: input.content ?? null,
      summary: input.summary ?? null,
      publishedAt: input.publishedAt,
      crawlTimeMs: input.crawlTimeMs ?? null,
      createdAt: input.createdAt ?? 0,
    };

    this.entries.set(entry.id, entry);
    this.nextEntryId = Math.max(this.nextEntryId, entry.id + 1);

    return entry;
  }

  seedItemState(input: {
    userId: number;
    itemId: number;
    isRead?: number | null;
    isStarred?: number;
    starredAt?: number | null;
  }): ItemState {
    const state: ItemState = {
      itemId: input.itemId,
      userId: input.userId,
      isRead: input.isRead ?? null,
      isStarred: input.isStarred ?? 0,
      starredAt: input.starredAt ?? null,
    };

    this.itemStates.set(this.itemStateKey(input.userId, input.itemId), state);
    return state;
  }

  seedSubscriptionLabel(subscriptionId: number, labelId: number): void {
    this.subscriptionLabels.add(this.subscriptionLabelKey(subscriptionId, labelId));
  }

  seedItemLabel(userId: number, itemId: number, labelId: number): void {
    this.itemLabels.add(this.itemLabelKey(userId, itemId, labelId));
  }

  async getUserById(id: number): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async getUserByUsername(username: string): Promise<User | null> {
    return [...this.users.values()].find((user) => user.username === username) ?? null;
  }

  async listUsers(params: PaginationParams): Promise<User[]> {
    return [...this.users.values()].slice(params.offset ?? 0, (params.offset ?? 0) + params.limit);
  }

  async createUser(input: UserCreateInput): Promise<User> {
    return this.seedUser(input);
  }

  async updateUser(id: number, input: UserUpdateInput): Promise<User | null> {
    const user = this.users.get(id);

    if (user === undefined) {
      return null;
    }

    const updated: User = {
      ...user,
      ...(input.username !== undefined ? { username: input.username } : {}),
      ...(input.email !== undefined ? { email: input.email } : {}),
    };

    this.users.set(id, updated);
    return updated;
  }

  async deleteUser(id: number): Promise<boolean> {
    return this.users.delete(id);
  }

  async getAppPasswordById(_id: number): Promise<AppPassword | null> {
    throw new Error("Not implemented in test mock.");
  }

  async listAppPasswordsByUserId(_userId: number): Promise<AppPassword[]> {
    throw new Error("Not implemented in test mock.");
  }

  async createAppPassword(): Promise<AppPassword> {
    throw new Error("Not implemented in test mock.");
  }

  async updateAppPassword(): Promise<AppPassword | null> {
    throw new Error("Not implemented in test mock.");
  }

  async touchAppPassword(): Promise<boolean> {
    throw new Error("Not implemented in test mock.");
  }

  async deleteAppPassword(): Promise<boolean> {
    throw new Error("Not implemented in test mock.");
  }

  async getFeedById(id: number): Promise<Feed | null> {
    return this.feeds.get(id) ?? null;
  }

  async getFeedByUrl(url: string): Promise<Feed | null> {
    return [...this.feeds.values()].find((feed) => feed.url === url) ?? null;
  }

  async listFeeds(params: FeedListParams): Promise<Feed[]> {
    const offset = params.offset ?? 0;
    return [...this.feeds.values()].slice(offset, offset + params.limit);
  }

  async listDueFeeds(now: number, params: PaginationParams): Promise<Feed[]> {
    const feeds = [...this.feeds.values()].filter(
      (feed) => feed.nextFetchAt === null || feed.nextFetchAt <= now,
    );
    const offset = params.offset ?? 0;
    return feeds.slice(offset, offset + params.limit);
  }

  async createFeed(input: FeedCreateInput): Promise<Feed> {
    return this.seedFeed(input);
  }

  async upsertFeed(input: FeedCreateInput): Promise<Feed> {
    const existing = await this.getFeedByUrl(input.url);

    if (existing !== null) {
      const updated: Feed = {
        ...existing,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.siteUrl !== undefined ? { siteUrl: input.siteUrl } : {}),
        ...(input.faviconUrl !== undefined ? { faviconUrl: input.faviconUrl } : {}),
        ...(input.etag !== undefined ? { etag: input.etag } : {}),
        ...(input.lastModified !== undefined ? { lastModified: input.lastModified } : {}),
        ...(input.lastFetchedAt !== undefined ? { lastFetchedAt: input.lastFetchedAt } : {}),
        ...(input.fetchErrorCount !== undefined
          ? { fetchErrorCount: input.fetchErrorCount }
          : {}),
        ...(input.nextFetchAt !== undefined ? { nextFetchAt: input.nextFetchAt } : {}),
        ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
      };

      this.feeds.set(updated.id, updated);
      return updated;
    }

    return this.seedFeed(input);
  }

  async updateFeed(id: number, input: FeedUpdateInput): Promise<Feed | null> {
    const feed = this.feeds.get(id);

    if (feed === undefined) {
      return null;
    }

    const updated: Feed = {
      ...feed,
      ...(input.url !== undefined ? { url: input.url } : {}),
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.siteUrl !== undefined ? { siteUrl: input.siteUrl } : {}),
      ...(input.faviconUrl !== undefined ? { faviconUrl: input.faviconUrl } : {}),
      ...(input.etag !== undefined ? { etag: input.etag } : {}),
      ...(input.lastModified !== undefined ? { lastModified: input.lastModified } : {}),
      ...(input.lastFetchedAt !== undefined ? { lastFetchedAt: input.lastFetchedAt } : {}),
      ...(input.fetchErrorCount !== undefined
        ? { fetchErrorCount: input.fetchErrorCount }
        : {}),
      ...(input.nextFetchAt !== undefined ? { nextFetchAt: input.nextFetchAt } : {}),
      ...(input.updatedAt !== undefined ? { updatedAt: input.updatedAt } : {}),
    };

    this.feeds.set(id, updated);
    return updated;
  }

  async deleteFeed(id: number): Promise<boolean> {
    return this.feeds.delete(id);
  }

  async getSubscriptionById(id: number): Promise<Subscription | null> {
    return this.subscriptions.get(id) ?? null;
  }

  async getSubscriptionByUserAndFeed(
    userId: number,
    feedId: number,
  ): Promise<Subscription | null> {
    return [...this.subscriptions.values()].find(
      (subscription) => subscription.userId === userId && subscription.feedId === feedId,
    ) ?? null;
  }

  async listSubscriptionsByUserId(userId: number): Promise<SubscriptionView[]> {
    return [...this.subscriptions.values()]
      .filter((subscription) => subscription.userId === userId)
      .map((subscription) => ({
        ...subscription,
        feed: this.requireFeed(subscription.feedId),
        labels: this.getSubscriptionLabels(subscription.id),
      }));
  }

  async createSubscription(input: SubscriptionCreateInput): Promise<Subscription> {
    return this.seedSubscription(input);
  }

  async updateSubscription(
    id: number,
    input: SubscriptionUpdateInput,
  ): Promise<Subscription | null> {
    const subscription = this.subscriptions.get(id);

    if (subscription === undefined) {
      return null;
    }

    const updated: Subscription = {
      ...subscription,
      ...(input.customTitle !== undefined ? { customTitle: input.customTitle } : {}),
      ...(input.readCursorItemId !== undefined
        ? { readCursorItemId: input.readCursorItemId }
        : {}),
    };

    this.subscriptions.set(id, updated);
    return updated;
  }

  async deleteSubscription(id: number): Promise<boolean> {
    const deleted = this.subscriptions.delete(id);

    if (deleted) {
      for (const key of [...this.subscriptionLabels]) {
        const [subscriptionId] = key.split(":").map(Number);

        if (subscriptionId === id) {
          this.subscriptionLabels.delete(key);
        }
      }
    }

    return deleted;
  }

  async setSubscriptionReadCursor(id: number, itemId: number | null): Promise<boolean> {
    const subscription = this.subscriptions.get(id);

    if (subscription === undefined) {
      return false;
    }

    this.subscriptions.set(id, {
      ...subscription,
      readCursorItemId: itemId,
    });

    return true;
  }

  async listSubscriptionIdsByLabel(userId: number, labelId: number): Promise<number[]> {
    const label = this.labels.get(labelId);

    if (label === undefined || label.userId !== userId) {
      return [];
    }

    return [...this.subscriptionLabels]
      .map((key) => this.parseSubscriptionLabelKey(key))
      .filter(({ labelId: currentLabelId }) => currentLabelId === labelId)
      .map(({ subscriptionId }) => subscriptionId)
      .filter((subscriptionId): subscriptionId is number =>
        this.subscriptions.get(subscriptionId)?.userId === userId,
      );
  }

  async getLabelById(id: number): Promise<Label | null> {
    return this.labels.get(id) ?? null;
  }

  async getLabelByName(userId: number, name: string): Promise<Label | null> {
    return [...this.labels.values()].find(
      (label) => label.userId === userId && label.name === name,
    ) ?? null;
  }

  async listLabelsByUserId(userId: number): Promise<Label[]> {
    return [...this.labels.values()].filter((label) => label.userId === userId);
  }

  async createLabel(input: { userId: number; name: string }): Promise<Label> {
    return this.seedLabel(input);
  }

  async updateLabel(id: number, input: { name: string }): Promise<Label | null> {
    const label = this.labels.get(id);

    if (label === undefined) {
      return null;
    }

    const updated: Label = {
      ...label,
      name: input.name,
    };

    this.labels.set(id, updated);
    return updated;
  }

  async deleteLabel(id: number): Promise<boolean> {
    const deleted = this.labels.delete(id);

    if (!deleted) {
      return false;
    }

    for (const key of [...this.subscriptionLabels]) {
      const [, labelId] = key.split(":").map(Number);

      if (labelId === id) {
        this.subscriptionLabels.delete(key);
      }
    }

    for (const key of [...this.itemLabels]) {
      const [, , labelId] = key.split(":").map(Number);

      if (labelId === id) {
        this.itemLabels.delete(key);
      }
    }

    return true;
  }

  async listSubscriptionLabels(subscriptionId: number): Promise<Label[]> {
    return this.getSubscriptionLabels(subscriptionId);
  }

  async addSubscriptionLabel(input: SubscriptionLabel): Promise<void> {
    this.subscriptionLabels.add(this.subscriptionLabelKey(input.subscriptionId, input.labelId));
  }

  async removeSubscriptionLabel(subscriptionId: number, labelId: number): Promise<void> {
    this.subscriptionLabels.delete(this.subscriptionLabelKey(subscriptionId, labelId));
  }

  async replaceSubscriptionLabels(
    subscriptionId: number,
    labelIds: number[],
  ): Promise<void> {
    for (const key of [...this.subscriptionLabels]) {
      const [currentSubscriptionId] = key.split(":").map(Number);

      if (currentSubscriptionId === subscriptionId) {
        this.subscriptionLabels.delete(key);
      }
    }

    for (const labelId of labelIds) {
      this.subscriptionLabels.add(this.subscriptionLabelKey(subscriptionId, labelId));
    }
  }

  async deleteSubscriptionLabelsByLabelId(labelId: number): Promise<number> {
    let deleted = 0;

    for (const key of [...this.subscriptionLabels]) {
      const [, currentLabelId] = key.split(":").map(Number);

      if (currentLabelId === labelId) {
        this.subscriptionLabels.delete(key);
        deleted += 1;
      }
    }

    return deleted;
  }

  async hasSubscriptionLabelReferences(labelId: number): Promise<boolean> {
    return [...this.subscriptionLabels].some((key) => {
      const [, currentLabelId] = key.split(":").map(Number);
      return currentLabelId === labelId;
    });
  }

  async getEntryById(id: number): Promise<Entry | null> {
    return this.entries.get(id) ?? null;
  }

  async getEntryByPublicId(publicId: string): Promise<Entry | null> {
    return [...this.entries.values()].find((entry) => entry.publicId === publicId) ?? null;
  }

  async listEntryIds(
    userId: number,
    filter: StreamFilter,
  ): Promise<PaginatedResult<EntryReference>> {
    const result = this.queryEntryViews(userId, filter);
    return {
      items: result.items.map((entry) => ({
        id: entry.id,
        publicId: entry.publicId,
        feedId: entry.feedId,
        publishedAt: entry.publishedAt,
      })),
      ...(result.continuation === undefined ? {} : { continuation: result.continuation }),
    };
  }

  async listEntries(
    userId: number,
    filter: StreamFilter,
  ): Promise<PaginatedResult<EntryView>> {
    return this.queryEntryViews(userId, filter);
  }

  async getEntriesByPublicIds(userId: number, publicIds: string[]): Promise<EntryView[]> {
    this.getEntriesByPublicIdsBatchSizes.push(publicIds.length);

    return publicIds
      .map((publicId) => [...this.entries.values()].find((entry) => entry.publicId === publicId))
      .filter((entry): entry is Entry => entry !== undefined)
      .map((entry) => this.toEntryView(userId, entry))
      .filter((entry): entry is EntryView => entry !== null);
  }

  async insertEntries(entries: ReadonlyArray<EntryInsertInput>): Promise<IngestResult> {
    this.insertEntriesBatchSizes.push(entries.length);

    let inserted = 0;
    let skipped = 0;

    for (const input of entries) {
      const duplicate = [...this.entries.values()].find(
        (entry) => entry.feedId === input.feedId && entry.guid === input.guid,
      );

      if (duplicate !== undefined) {
        skipped += 1;
        continue;
      }

      this.seedEntry({
        feedId: input.feedId,
        publicId: input.publicId,
        guid: input.guid,
        publishedAt: input.publishedAt,
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.url !== undefined ? { url: input.url } : {}),
        ...(input.author !== undefined ? { author: input.author } : {}),
        ...(input.content !== undefined ? { content: input.content } : {}),
        ...(input.summary !== undefined ? { summary: input.summary } : {}),
        ...(input.crawlTimeMs !== undefined ? { crawlTimeMs: input.crawlTimeMs } : {}),
        ...(input.createdAt !== undefined ? { createdAt: input.createdAt } : {}),
      });
      inserted += 1;
    }

    return { inserted, skipped };
  }

  async deleteEntry(id: number): Promise<boolean> {
    return this.entries.delete(id);
  }

  async getMaxItemIdForFeed(
    feedId: number,
    newestPublishedAt?: number,
  ): Promise<number | null> {
    const entries = [...this.entries.values()]
      .filter((entry) =>
        entry.feedId === feedId &&
        (newestPublishedAt === undefined || entry.publishedAt <= newestPublishedAt),
      )
      .sort((left, right) => right.id - left.id);

    return entries[0]?.id ?? null;
  }

  async listEntriesForFeed(feedId: number, params: PaginationParams): Promise<Entry[]> {
    const offset = params.offset ?? 0;
    return [...this.entries.values()]
      .filter((entry) => entry.feedId === feedId)
      .sort((left, right) => left.id - right.id)
      .slice(offset, offset + params.limit);
  }

  async cleanStaleOverrides(
    userId: number,
    feedId: number,
    maxItemId: number,
  ): Promise<void> {
    for (const entry of this.entries.values()) {
      if (entry.feedId !== feedId || entry.id > maxItemId) {
        continue;
      }

      const key = this.itemStateKey(userId, entry.id);
      const state = this.itemStates.get(key);

      if (state === undefined) {
        continue;
      }

      if (state.isStarred === 1) {
        if (state.isRead !== null) {
          this.itemStates.set(key, {
            ...state,
            isRead: null,
          });
        }
        continue;
      }

      this.itemStates.delete(key);
    }
  }

  async protectPostCutoffItems(
    userId: number,
    feedId: number,
    oldCursor: number,
    newCursor: number,
    cutoffTimestamp: number,
  ): Promise<void> {
    for (const entry of this.entries.values()) {
      if (
        entry.feedId !== feedId ||
        entry.id <= oldCursor ||
        entry.id > newCursor ||
        entry.publishedAt <= cutoffTimestamp
      ) {
        continue;
      }

      const state = this.itemStates.get(this.itemStateKey(userId, entry.id));
      this.itemStates.set(this.itemStateKey(userId, entry.id), {
        itemId: entry.id,
        userId,
        isRead: 0,
        isStarred: state?.isStarred ?? 0,
        starredAt: state?.starredAt ?? null,
      });
    }
  }

  async getItemState(userId: number, itemId: number): Promise<ItemState | null> {
    return this.itemStates.get(this.itemStateKey(userId, itemId)) ?? null;
  }

  async listItemStates(userId: number, itemIds: number[]): Promise<ItemState[]> {
    return itemIds
      .map((itemId) => this.itemStates.get(this.itemStateKey(userId, itemId)))
      .filter((state): state is ItemState => state !== undefined);
  }

  async upsertItemState(input: ItemState): Promise<ItemState> {
    this.itemStates.set(this.itemStateKey(input.userId, input.itemId), { ...input });
    return { ...input };
  }

  async deleteItemState(userId: number, itemId: number): Promise<boolean> {
    return this.itemStates.delete(this.itemStateKey(userId, itemId));
  }

  async listItemLabels(userId: number, itemId: number): Promise<Label[]> {
    return this.getItemLabels(userId, itemId);
  }

  async addItemLabel(input: ItemLabel): Promise<void> {
    this.itemLabels.add(this.itemLabelKey(input.userId, input.itemId, input.labelId));
  }

  async removeItemLabel(userId: number, itemId: number, labelId: number): Promise<void> {
    this.itemLabels.delete(this.itemLabelKey(userId, itemId, labelId));
  }

  async replaceItemLabels(userId: number, itemId: number, labelIds: number[]): Promise<void> {
    for (const key of [...this.itemLabels]) {
      const [currentUserId, currentItemId] = key.split(":").map(Number);

      if (currentUserId === userId && currentItemId === itemId) {
        this.itemLabels.delete(key);
      }
    }

    for (const labelId of labelIds) {
      this.itemLabels.add(this.itemLabelKey(userId, itemId, labelId));
    }
  }

  async deleteItemLabelsByLabelId(userId: number, labelId: number): Promise<number> {
    let deleted = 0;

    for (const key of [...this.itemLabels]) {
      const [currentUserId, , currentLabelId] = key.split(":").map(Number);

      if (currentUserId === userId && currentLabelId === labelId) {
        this.itemLabels.delete(key);
        deleted += 1;
      }
    }

    return deleted;
  }

  async hasItemLabelReferences(userId: number, labelId: number): Promise<boolean> {
    return [...this.itemLabels].some((key) => {
      const [currentUserId, , currentLabelId] = key.split(":").map(Number);
      return currentUserId === userId && currentLabelId === labelId;
    });
  }

  async getUnreadCounts(userId: number): Promise<UnreadCount[]> {
    const subscriptions = await this.listSubscriptionsByUserId(userId);

    return subscriptions.map((subscription) => {
      const unreadEntries = [...this.entries.values()].filter((entry) =>
        entry.feedId === subscription.feedId && !this.isEntryRead(userId, entry, subscription),
      );
      const newestUnread = unreadEntries.reduce(
        (maxValue, entry) => Math.max(maxValue, entry.publishedAt),
        0,
      );

      return {
        streamId: toFeedStreamId(subscription.feed.url),
        count: unreadEntries.length,
        newestItemTimestampUsec: String(newestUnread * 1_000_000),
      };
    });
  }

  async recountUnreadCounts(): Promise<SubscriptionUnreadCount[]> {
    throw new Error("Not implemented in test mock.");
  }

  async purgeItemsOlderThan(): Promise<{
    deleted: number;
    skippedStarred: number;
    skippedUnreadOverride: number;
  }> {
    throw new Error("Not implemented in test mock.");
  }

  async getRateLimit(_ip: string, _endpoint: string): Promise<RateLimit | null> {
    throw new Error("Not implemented in test mock.");
  }

  async incrementRateLimit(): Promise<RateLimit> {
    throw new Error("Not implemented in test mock.");
  }

  async resetRateLimit(): Promise<void> {
    throw new Error("Not implemented in test mock.");
  }

  async deleteExpiredRateLimits(): Promise<number> {
    throw new Error("Not implemented in test mock.");
  }

  private queryEntryViews(
    userId: number,
    filter: StreamFilter,
  ): PaginatedResult<EntryView> {
    const matchingEntries = [...this.entries.values()]
      .map((entry) => this.toEntryView(userId, entry))
      .filter((entry): entry is EntryView => entry !== null)
      .filter((entry) => this.matchesStreamFilter(userId, entry, filter))
      .filter((entry) =>
        filter.oldestTimestamp === undefined || entry.publishedAt > filter.oldestTimestamp,
      )
      .filter((entry) =>
        filter.newestTimestamp === undefined || entry.publishedAt < filter.newestTimestamp,
      )
      .sort((left, right) => compareEntries(left, right, filter.sortOrder))
      .filter((entry) => this.matchesContinuation(entry, filter.continuation, filter.sortOrder));

    const items = matchingEntries.slice(0, filter.count);
    const lastItem = items.at(-1);
    const continuation =
      matchingEntries.length > filter.count && lastItem !== undefined
        ? {
            publishedAt: lastItem.publishedAt,
            id: lastItem.id,
          }
        : undefined;

    return continuation === undefined ? { items } : { items, continuation };
  }

  private matchesStreamFilter(userId: number, entry: EntryView, filter: StreamFilter): boolean {
    if (!this.matchesStreamId(userId, entry, filter.streamId)) {
      return false;
    }

    const includeTags = filter.includeTags ??
      (filter.includeTag === undefined ? [] : [filter.includeTag]);
    for (const includeTag of includeTags) {
      if (!this.matchesTag(userId, entry, includeTag)) {
        return false;
      }
    }

    if (filter.excludeTag !== undefined && this.matchesTag(userId, entry, filter.excludeTag)) {
      return false;
    }

    return true;
  }

  private matchesStreamId(userId: number, entry: EntryView, streamId: string): boolean {
    const parsed = parseStreamId(streamId);
    const subscription = this.getSubscriptionForEntry(userId, entry);

    if (subscription === null) {
      return false;
    }

    switch (parsed.kind) {
      case "feed":
        return this.requireFeed(entry.feedId).url === parsed.feedUrl;
      case "label":
        return this.getSubscriptionLabels(subscription.id).some(
          (label) => label.name === parsed.labelName,
        );
      case "reading-list":
        return true;
      case "starred":
        return entry.state.isStarred;
      case "read":
        return entry.state.isRead;
    }
  }

  private matchesTag(userId: number, entry: EntryView, tag: string): boolean {
    if (tag === READ_STREAM_ID) {
      return entry.state.isRead;
    }

    if (tag === STARRED_STREAM_ID) {
      return entry.state.isStarred;
    }

    if (tag === READING_LIST_STREAM_ID) {
      return this.getSubscriptionForEntry(userId, entry) !== null;
    }

    const parsed = parseStreamId(tag);

    if (parsed.kind === "label") {
      return entry.labels.some((label) => label.name === parsed.labelName);
    }

    if (parsed.kind === "feed") {
      return this.requireFeed(entry.feedId).url === parsed.feedUrl;
    }

    return false;
  }

  private matchesContinuation(
    entry: EntryView,
    continuation: ContinuationToken | undefined,
    sortOrder: "newest" | "oldest",
  ): boolean {
    if (continuation === undefined) {
      return true;
    }

    if (sortOrder === "newest") {
      return (
        entry.publishedAt < continuation.publishedAt ||
        (entry.publishedAt === continuation.publishedAt && entry.id < continuation.id)
      );
    }

    return (
      entry.publishedAt > continuation.publishedAt ||
      (entry.publishedAt === continuation.publishedAt && entry.id > continuation.id)
    );
  }

  private toEntryView(userId: number, entry: Entry): EntryView | null {
    const subscription = this.getSubscriptionByUserAndFeedSync(userId, entry.feedId);

    if (subscription === null) {
      return null;
    }

    return {
      ...entry,
      state: this.getEntryStateView(userId, entry, subscription),
      labels: this.getItemLabels(userId, entry.id),
    };
  }

  private getEntryStateView(
    userId: number,
    entry: Entry,
    subscription: Subscription,
  ): EntryStateView {
    const state = this.itemStates.get(this.itemStateKey(userId, entry.id)) ?? null;
    const defaultRead = entry.id <= (subscription.readCursorItemId ?? 0);

    return {
      isRead: state?.isRead === 1 ? true : state?.isRead === 0 ? false : defaultRead,
      isStarred: state?.isStarred === 1,
      starredAt: state?.starredAt ?? null,
    };
  }

  private isEntryRead(userId: number, entry: Entry, subscription: Subscription): boolean {
    return this.getEntryStateView(userId, entry, subscription).isRead;
  }

  private getSubscriptionForEntry(userId: number, entry: Entry | EntryView): Subscription | null {
    return this.getSubscriptionByUserAndFeedSync(userId, entry.feedId);
  }

  private getSubscriptionByUserAndFeedSync(
    userId: number,
    feedId: number,
  ): Subscription | null {
    return [...this.subscriptions.values()].find(
      (subscription) => subscription.userId === userId && subscription.feedId === feedId,
    ) ?? null;
  }

  private getSubscriptionLabels(subscriptionId: number): Label[] {
    return [...this.subscriptionLabels]
      .map((key) => this.parseSubscriptionLabelKey(key))
      .filter(({ subscriptionId: currentSubscriptionId }) => currentSubscriptionId === subscriptionId)
      .map(({ labelId }) => this.labels.get(labelId))
      .filter((label): label is Label => label !== undefined);
  }

  private getItemLabels(userId: number, itemId: number): Label[] {
    return [...this.itemLabels]
      .map((key) => this.parseItemLabelKey(key))
      .filter(
        ({ userId: currentUserId, itemId: currentItemId }) =>
          currentUserId === userId && currentItemId === itemId,
      )
      .map(({ labelId }) => this.labels.get(labelId))
      .filter((label): label is Label => label !== undefined);
  }

  private requireFeed(feedId: number): Feed {
    const feed = this.feeds.get(feedId);

    if (feed === undefined) {
      throw new Error(`Feed ${feedId} was not seeded.`);
    }

    return feed;
  }

  private subscriptionLabelKey(subscriptionId: number, labelId: number): string {
    return `${subscriptionId}:${labelId}`;
  }

  private itemStateKey(userId: number, itemId: number): string {
    return `${userId}:${itemId}`;
  }

  private itemLabelKey(userId: number, itemId: number, labelId: number): string {
    return `${userId}:${itemId}:${labelId}`;
  }

  private parseSubscriptionLabelKey(key: string): {
    subscriptionId: number;
    labelId: number;
  } {
    const [subscriptionId, labelId] = key.split(":").map(Number);

    if (subscriptionId === undefined || labelId === undefined) {
      throw new Error(`Invalid subscription label key: ${key}`);
    }

    return { subscriptionId, labelId };
  }

  private parseItemLabelKey(key: string): {
    userId: number;
    itemId: number;
    labelId: number;
  } {
    const [userId, itemId, labelId] = key.split(":").map(Number);

    if (userId === undefined || itemId === undefined || labelId === undefined) {
      throw new Error(`Invalid item label key: ${key}`);
    }

    return { userId, itemId, labelId };
  }
}

function compareEntries(
  left: Entry,
  right: Entry,
  sortOrder: "newest" | "oldest",
): number {
  if (sortOrder === "newest") {
    return right.publishedAt - left.publishedAt || right.id - left.id;
  }

  return left.publishedAt - right.publishedAt || left.id - right.id;
}
