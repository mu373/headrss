export const READING_LIST_STREAM_ID = "user/-/state/com.google/reading-list";
export const STARRED_STREAM_ID = "user/-/state/com.google/starred";
export const READ_STREAM_ID = "user/-/state/com.google/read";
const LABEL_PREFIX = "user/-/label/";
const FEED_PREFIX = "feed/";

export function toFeedStreamId(feedUrl: string): string {
  return `${FEED_PREFIX}${feedUrl}`;
}

export function toLabelStreamId(labelName: string): string {
  return `${LABEL_PREFIX}${labelName}`;
}
