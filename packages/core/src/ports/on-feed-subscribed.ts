export interface FeedSubscribedEvent {
  feedId: number;
  feedUrl: string;
}

export type OnFeedSubscribed = (event: FeedSubscribedEvent) => Promise<void>;
