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

export interface PaginatedResult<TItem> {
  items: TItem[];
  continuation?: ContinuationToken;
}

export interface EntryStateView {
  isRead: boolean;
  isStarred: boolean;
  starredAt: number | null;
}

export interface EntryReference {
  id: number;
  publicId: string;
  feedId: number;
  publishedAt: number;
}

export interface EntryView extends Entry {
  state: EntryStateView;
  labels: Label[];
}

export interface SubscriptionView extends Subscription {
  feed: Feed;
  labels: Label[];
}

export interface UserCreateInput {
  username: string;
  email?: string | null;
  createdAt?: number;
}

export interface UserUpdateInput {
  username?: string;
  email?: string | null;
}

export interface AppPasswordCreateInput {
  userId: number;
  label: string;
  passwordHash: string;
  passwordVersion: number;
  lastUsedAt?: number | null;
  createdAt?: number;
}

export interface AppPasswordUpdateInput {
  label?: string;
  passwordHash?: string;
  passwordVersion?: number;
  lastUsedAt?: number | null;
}

export interface FeedCreateInput {
  url: string;
  title?: string | null;
  siteUrl?: string | null;
  faviconUrl?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt?: number | null;
  fetchErrorCount?: number;
  nextFetchAt?: number | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface FeedUpdateInput {
  url?: string;
  title?: string | null;
  siteUrl?: string | null;
  faviconUrl?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  lastFetchedAt?: number | null;
  fetchErrorCount?: number;
  nextFetchAt?: number | null;
  updatedAt?: number;
}

export interface FeedListParams extends PaginationParams {
  dueBefore?: number;
}

export interface SubscriptionCreateInput {
  userId: number;
  feedId: number;
  customTitle?: string | null;
  readCursorItemId?: number | null;
}

export interface SubscriptionUpdateInput {
  customTitle?: string | null;
  readCursorItemId?: number | null;
}

export interface LabelCreateInput {
  userId: number;
  name: string;
}

export interface LabelUpdateInput {
  name: string;
}

export interface EntryInsertInput {
  publicId: string;
  feedId: number;
  guid: string;
  title?: string | null;
  url?: string | null;
  author?: string | null;
  content?: string | null;
  summary?: string | null;
  publishedAt: number;
  crawlTimeMs?: number | null;
  createdAt?: number;
}

export interface SubscriptionUnreadCount {
  subscriptionId: number;
  unreadCount: number;
}

export interface PurgeResult {
  deleted: number;
  skippedStarred: number;
  skippedUnreadOverride: number;
}

export interface EntryStore {
  getUserById(id: number): Promise<User | null>;
  getUserByUsername(username: string): Promise<User | null>;
  listUsers(params: PaginationParams): Promise<User[]>;
  createUser(input: UserCreateInput): Promise<User>;
  updateUser(id: number, input: UserUpdateInput): Promise<User | null>;
  deleteUser(id: number): Promise<boolean>;

  getAppPasswordById(id: number): Promise<AppPassword | null>;
  listAppPasswordsByUserId(userId: number): Promise<AppPassword[]>;
  createAppPassword(input: AppPasswordCreateInput): Promise<AppPassword>;
  updateAppPassword(
    id: number,
    input: AppPasswordUpdateInput,
  ): Promise<AppPassword | null>;
  touchAppPassword(id: number, lastUsedAt: number): Promise<boolean>;
  deleteAppPassword(id: number): Promise<boolean>;

  getFeedById(id: number): Promise<Feed | null>;
  getFeedByUrl(url: string): Promise<Feed | null>;
  listFeeds(params: FeedListParams): Promise<Feed[]>;
  listDueFeeds(now: number, params: PaginationParams): Promise<Feed[]>;
  createFeed(input: FeedCreateInput): Promise<Feed>;
  upsertFeed(input: FeedCreateInput): Promise<Feed>;
  updateFeed(id: number, input: FeedUpdateInput): Promise<Feed | null>;
  deleteFeed(id: number): Promise<boolean>;

  getSubscriptionById(id: number): Promise<Subscription | null>;
  getSubscriptionByUserAndFeed(
    userId: number,
    feedId: number,
  ): Promise<Subscription | null>;
  listSubscriptionsByUserId(userId: number): Promise<SubscriptionView[]>;
  createSubscription(input: SubscriptionCreateInput): Promise<Subscription>;
  updateSubscription(
    id: number,
    input: SubscriptionUpdateInput,
  ): Promise<Subscription | null>;
  deleteSubscription(id: number): Promise<boolean>;
  setSubscriptionReadCursor(
    id: number,
    itemId: number | null,
  ): Promise<boolean>;
  listSubscriptionIdsByLabel(
    userId: number,
    labelId: number,
  ): Promise<number[]>;

  getLabelById(id: number): Promise<Label | null>;
  getLabelByName(userId: number, name: string): Promise<Label | null>;
  listLabelsByUserId(userId: number): Promise<Label[]>;
  createLabel(input: LabelCreateInput): Promise<Label>;
  updateLabel(id: number, input: LabelUpdateInput): Promise<Label | null>;
  deleteLabel(id: number): Promise<boolean>;

  listSubscriptionLabels(subscriptionId: number): Promise<Label[]>;
  addSubscriptionLabel(input: SubscriptionLabel): Promise<void>;
  removeSubscriptionLabel(
    subscriptionId: number,
    labelId: number,
  ): Promise<void>;
  replaceSubscriptionLabels(
    subscriptionId: number,
    labelIds: number[],
  ): Promise<void>;
  deleteSubscriptionLabelsByLabelId(labelId: number): Promise<number>;
  hasSubscriptionLabelReferences(labelId: number): Promise<boolean>;

  getEntryById(id: number): Promise<Entry | null>;
  getEntryByPublicId(publicId: string): Promise<Entry | null>;
  listEntryIds(
    userId: number,
    filter: StreamFilter,
  ): Promise<PaginatedResult<EntryReference>>;
  listEntries(
    userId: number,
    filter: StreamFilter,
  ): Promise<PaginatedResult<EntryView>>;
  getEntriesByPublicIds(
    userId: number,
    publicIds: string[],
  ): Promise<EntryView[]>;
  insertEntries(
    entries: ReadonlyArray<EntryInsertInput>,
  ): Promise<IngestResult>;
  deleteEntry(id: number): Promise<boolean>;
  getMaxItemIdForFeed(
    feedId: number,
    newestPublishedAt?: number,
  ): Promise<number | null>;
  listEntriesForFeed(
    feedId: number,
    params: PaginationParams,
  ): Promise<Entry[]>;
  cleanStaleOverrides(
    userId: number,
    feedId: number,
    maxItemId: number,
  ): Promise<void>;
  protectPostCutoffItems(
    userId: number,
    feedId: number,
    oldCursor: number,
    newCursor: number,
    cutoffTimestamp: number,
  ): Promise<void>;

  getItemState(userId: number, itemId: number): Promise<ItemState | null>;
  listItemStates(userId: number, itemIds: number[]): Promise<ItemState[]>;
  upsertItemState(input: ItemState): Promise<ItemState>;
  deleteItemState(userId: number, itemId: number): Promise<boolean>;

  listItemLabels(userId: number, itemId: number): Promise<Label[]>;
  addItemLabel(input: ItemLabel): Promise<void>;
  removeItemLabel(
    userId: number,
    itemId: number,
    labelId: number,
  ): Promise<void>;
  replaceItemLabels(
    userId: number,
    itemId: number,
    labelIds: number[],
  ): Promise<void>;
  deleteItemLabelsByLabelId(userId: number, labelId: number): Promise<number>;
  hasItemLabelReferences(userId: number, labelId: number): Promise<boolean>;

  getUnreadCounts(userId: number): Promise<UnreadCount[]>;
  recountUnreadCounts(userId?: number): Promise<SubscriptionUnreadCount[]>;
  purgeItemsOlderThan(
    cutoffTimestamp: number,
    batchSize?: number,
  ): Promise<PurgeResult>;

  getRateLimit(ip: string, endpoint: string): Promise<RateLimit | null>;
  incrementRateLimit(
    ip: string,
    endpoint: string,
    windowStart: number,
  ): Promise<RateLimit>;
  resetRateLimit(ip: string, endpoint: string): Promise<void>;
  deleteExpiredRateLimits(cutoffTimestamp: number): Promise<number>;
}
