export const READING_LIST_STREAM_ID = "user/-/state/com.google/reading-list";
export const STARRED_STREAM_ID = "user/-/state/com.google/starred";
export const READ_STREAM_ID = "user/-/state/com.google/read";
const LABEL_PREFIX = "user/-/label/";
const FEED_PREFIX = "feed/";

export type ParsedStreamId =
  | { kind: "feed"; feedUrl: string }
  | { kind: "label"; labelName: string }
  | { kind: "reading-list" }
  | { kind: "starred" }
  | { kind: "read" };

export function parseStreamId(streamId: string): ParsedStreamId {
  if (streamId === READING_LIST_STREAM_ID) {
    return { kind: "reading-list" };
  }

  if (streamId === STARRED_STREAM_ID) {
    return { kind: "starred" };
  }

  if (streamId === READ_STREAM_ID) {
    return { kind: "read" };
  }

  if (streamId.startsWith(FEED_PREFIX)) {
    return { kind: "feed", feedUrl: streamId.slice(FEED_PREFIX.length) };
  }

  if (streamId.startsWith(LABEL_PREFIX)) {
    return { kind: "label", labelName: streamId.slice(LABEL_PREFIX.length) };
  }

  throw new Error(`Unsupported stream ID: ${streamId}`);
}

export function toFeedStreamId(feedUrl: string): string {
  return `${FEED_PREFIX}${feedUrl}`;
}

export function toLabelStreamId(labelName: string): string {
  return `${LABEL_PREFIX}${labelName}`;
}

export function isReadTag(tag: string): boolean {
  return tag === READ_STREAM_ID;
}

export function isStarredTag(tag: string): boolean {
  return tag === STARRED_STREAM_ID;
}
