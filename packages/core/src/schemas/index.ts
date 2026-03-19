import { z } from "zod";

import {
  DEFAULT_PAGE_SIZE,
  MAX_CONTENT_SIZE,
  MAX_PAGE_SIZE,
  MAX_SUMMARY_SIZE,
} from "../constants.js";
import type {
  AppPassword,
  Entry,
  Feed,
  FeedCredential,
  IngestResult,
  ItemLabel,
  ItemState,
  Label,
  RateLimit,
  Subscription,
  SubscriptionLabel,
  UnreadCount,
  User,
} from "../types.js";

const utf8ByteLength = (value: string): number =>
  new TextEncoder().encode(value).length;
const maxUtf8Bytes =
  (limit: number) =>
  (value: string): boolean =>
    utf8ByteLength(value) <= limit;

const idSchema = z.number().int().nonnegative();
const unixTimestampSchema = z.number().int().nonnegative();
const nullableUnixTimestampSchema = unixTimestampSchema.nullable();
const publicIdPattern = /^[0-9A-Za-z]{22}$/;

export const publicIdSchema = z
  .string()
  .regex(publicIdPattern, "Expected a 22-character base62 public ID.");
export const streamIdSchema = z.string().min(1);
export const continuationTokenSchema = z.object({
  publishedAt: unixTimestampSchema,
  id: idSchema,
});
export const paginationParamsSchema = z.object({
  limit: z.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
  offset: z.number().int().min(0).optional(),
  continuation: z.string().min(1).optional(),
});
export const streamFilterSchema = z.object({
  streamId: streamIdSchema,
  count: z.number().int().min(1).max(MAX_PAGE_SIZE),
  oldestTimestamp: unixTimestampSchema.optional(),
  newestTimestamp: unixTimestampSchema.optional(),
  continuation: continuationTokenSchema.optional(),
  excludeTag: z.string().min(1).optional(),
  includeTag: z.string().min(1).optional(),
  includeTags: z.array(z.string().min(1)).optional(),
  sortOrder: z.enum(["newest", "oldest"]),
});

export const userSchema: z.ZodType<User> = z.object({
  id: idSchema,
  username: z.string().min(1),
  email: z.string().email().nullable(),
  createdAt: unixTimestampSchema,
});

export const appPasswordSchema: z.ZodType<AppPassword> = z.object({
  id: idSchema,
  userId: idSchema,
  label: z.string().min(1),
  passwordHash: z.string().min(1),
  passwordVersion: z.number().int().nonnegative(),
  lastUsedAt: nullableUnixTimestampSchema,
  createdAt: unixTimestampSchema,
});

export const feedSchema: z.ZodType<Feed> = z.object({
  id: idSchema,
  url: z.string().url(),
  title: z.string().min(1).nullable(),
  siteUrl: z.string().url().nullable(),
  faviconUrl: z.string().url().nullable(),
  etag: z.string().min(1).nullable(),
  lastModified: z.string().min(1).nullable(),
  lastFetchedAt: nullableUnixTimestampSchema,
  fetchErrorCount: z.number().int(),
  nextFetchAt: nullableUnixTimestampSchema,
  createdAt: unixTimestampSchema,
  updatedAt: unixTimestampSchema,
});

export const subscriptionSchema: z.ZodType<Subscription> = z.object({
  id: idSchema,
  userId: idSchema,
  feedId: idSchema,
  customTitle: z.string().min(1).nullable(),
  readCursorItemId: idSchema.nullable(),
});

export const labelSchema: z.ZodType<Label> = z.object({
  id: idSchema,
  userId: idSchema,
  name: z.string().min(1),
});

export const subscriptionLabelSchema: z.ZodType<SubscriptionLabel> = z.object({
  subscriptionId: idSchema,
  labelId: idSchema,
});

export const entrySchema: z.ZodType<Entry> = z.object({
  id: idSchema,
  publicId: publicIdSchema,
  feedId: idSchema,
  guid: z.string().min(1),
  title: z.string().min(1).nullable(),
  url: z.string().url().nullable(),
  author: z.string().min(1).nullable(),
  content: z
    .string()
    .refine(
      maxUtf8Bytes(MAX_CONTENT_SIZE),
      `Content must be <= ${MAX_CONTENT_SIZE} bytes.`,
    )
    .nullable(),
  summary: z
    .string()
    .refine(
      maxUtf8Bytes(MAX_SUMMARY_SIZE),
      `Summary must be <= ${MAX_SUMMARY_SIZE} bytes.`,
    )
    .nullable(),
  publishedAt: unixTimestampSchema,
  crawlTimeMs: z.number().int().nonnegative().nullable(),
  createdAt: unixTimestampSchema,
});

export const itemStateSchema: z.ZodType<ItemState> = z.object({
  itemId: idSchema,
  userId: idSchema,
  isRead: z.union([z.literal(0), z.literal(1)]).nullable(),
  isStarred: z.union([z.literal(0), z.literal(1)]),
  starredAt: nullableUnixTimestampSchema,
});

export const itemLabelSchema: z.ZodType<ItemLabel> = z.object({
  userId: idSchema,
  itemId: idSchema,
  labelId: idSchema,
});

export const arrayBufferSchema = z.custom<ArrayBuffer>(
  (value): value is ArrayBuffer => value instanceof ArrayBuffer,
  "Expected ArrayBuffer.",
);

export const feedCredentialSchema: z.ZodType<FeedCredential> = z.object({
  id: idSchema,
  feedId: idSchema,
  authType: z.string().min(1),
  credentialsEncrypted: arrayBufferSchema,
  createdAt: unixTimestampSchema,
});

export const rateLimitSchema: z.ZodType<RateLimit> = z.object({
  ip: z.string().min(1),
  endpoint: z.string().min(1),
  windowStart: unixTimestampSchema,
  attempts: z.number().int().nonnegative(),
});

export const unreadCountSchema: z.ZodType<UnreadCount> = z.object({
  streamId: streamIdSchema,
  count: z.number().int().nonnegative(),
  newestItemTimestampUsec: z.string().regex(/^\d+$/),
});

export const ingestResultSchema: z.ZodType<IngestResult> = z.object({
  inserted: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});

export const errorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const errorResponseSchema = z.object({
  error: errorSchema,
});
