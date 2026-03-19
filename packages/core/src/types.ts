export interface User {
  id: number;
  username: string;
  email: string | null;
  createdAt: number;
}

export interface AppPassword {
  id: number;
  userId: number;
  label: string;
  passwordHash: string;
  passwordVersion: number;
  lastUsedAt: number | null;
  createdAt: number;
}

export interface Feed {
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

export interface Subscription {
  id: number;
  userId: number;
  feedId: number;
  customTitle: string | null;
  readCursorItemId: number | null;
}

export interface Label {
  id: number;
  userId: number;
  name: string;
}

export interface SubscriptionLabel {
  subscriptionId: number;
  labelId: number;
}

export interface Entry {
  id: number;
  publicId: string;
  feedId: number;
  guid: string;
  title: string | null;
  url: string | null;
  author: string | null;
  content: string | null;
  summary: string | null;
  publishedAt: number;
  crawlTimeMs: number | null;
  createdAt: number;
}

export interface ItemState {
  itemId: number;
  userId: number;
  isRead: number | null;
  isStarred: number;
  starredAt: number | null;
}

export interface ItemLabel {
  userId: number;
  itemId: number;
  labelId: number;
}

export interface FeedCredential {
  id: number;
  feedId: number;
  authType: string;
  credentialsEncrypted: ArrayBuffer;
  createdAt: number;
}

export interface RateLimit {
  ip: string;
  endpoint: string;
  windowStart: number;
  attempts: number;
}

export interface PaginationParams {
  limit: number;
  offset?: number;
  continuation?: string;
}

export interface ContinuationToken {
  publishedAt: number;
  id: number;
}

export interface StreamFilter {
  streamId: string;
  count: number;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  continuation?: ContinuationToken;
  excludeTag?: string;
  includeTag?: string;
  includeTags?: string[];
  sortOrder: "newest" | "oldest";
}

export interface UnreadCount {
  streamId: string;
  count: number;
  newestItemTimestampUsec: string;
}

export interface IngestResult {
  inserted: number;
  skipped: number;
}
