import type { FeedCredential } from "../types.js";

export interface FeedCredentialInput {
  authType: string;
  credentialsEncrypted: ArrayBuffer;
}

export interface FeedCredentialStore {
  get(feedId: number): Promise<FeedCredential | null>;
  set(feedId: number, credential: FeedCredentialInput): Promise<FeedCredential>;
  delete(feedId: number): Promise<boolean>;
}
