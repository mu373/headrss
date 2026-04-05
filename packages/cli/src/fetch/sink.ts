import {
  type FeedMetaUpdate,
  INGEST_BATCH_SIZE,
  type IngestResult,
  type IngestSink,
  type ParsedItem,
} from "@headrss/core";
import type { HeadrssApiClient } from "../api-client.js";
import { chunk, sleep } from "../utils.js";

interface SinkLogger {
  warn(message: string, meta?: unknown): void;
}

interface SinkResponse {
  body: unknown;
  headers: Headers;
  status: number;
}

export class HttpIngestSink implements IngestSink {
  constructor(
    private readonly client: HeadrssApiClient,
    private readonly ingestApiKey: string,
    private readonly logger?: SinkLogger,
  ) {}

  async pushItems(feedId: number, items: ParsedItem[]): Promise<IngestResult> {
    let inserted = 0;
    let skipped = 0;

    for (const batch of chunk(items, INGEST_BATCH_SIZE)) {
      const result = await this.pushBatch(feedId, batch);
      inserted += result.inserted;
      skipped += result.skipped;
    }

    return { inserted, skipped };
  }

  async updateFeedMeta(feedId: number, meta: FeedMetaUpdate): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.request(
        "PUT",
        `/ingest/feeds/${feedId}`,
        meta,
      );

      if (response.status < 400) {
        return;
      }

      if (response.status === 429) {
        const retryMs =
          parseRetryAfter(response.headers) ?? backoffDelayMs(attempt);
        await sleep(retryMs);
        continue;
      }

      if (response.status >= 500) {
        await sleep(backoffDelayMs(attempt));
        continue;
      }

      throw new Error(
        `Feed update for ${feedId} was rejected with ${response.status}.`,
      );
    }

    throw new Error(`Failed to update feed ${feedId} after retries.`);
  }

  private async pushBatch(
    feedId: number,
    items: ParsedItem[],
  ): Promise<IngestResult> {
    let pending = [items];
    let inserted = 0;
    let skipped = 0;

    for (let attempt = 0; attempt < 3 && pending.length > 0; attempt += 1) {
      const nextPending: ParsedItem[][] = [];

      for (const batch of pending) {
        const response = await this.request(
          "POST",
          `/ingest/feeds/${feedId}/items`,
          batch.map((item) => ({
            author: item.author,
            content: item.content,
            guid: item.guid,
            publishedAt: item.publishedAt,
            summary: item.summary,
            title: item.title,
            url: item.url,
          })),
        );

        if (response.status === 200) {
          const result = response.body as {
            inserted?: number;
            skipped?: number;
          };
          inserted += result.inserted ?? 0;
          skipped += result.skipped ?? 0;
          continue;
        }

        if (response.status === 207) {
          const result = response.body as {
            failedBatches?: Array<{
              error: string;
              index: number;
              size: number;
            }>;
            inserted?: number;
            skipped?: number;
          };
          inserted += result.inserted ?? 0;
          skipped += result.skipped ?? 0;

          if (
            Array.isArray(result.failedBatches) &&
            result.failedBatches.length > 0
          ) {
            for (const failed of result.failedBatches) {
              const failedBatch = batch.slice(
                failed.index * INGEST_BATCH_SIZE,
                failed.index * INGEST_BATCH_SIZE + failed.size,
              );

              if (failedBatch.length > 0) {
                nextPending.push(failedBatch);
              }
            }
          }

          continue;
        }

        if (response.status === 429) {
          const retryMs =
            parseRetryAfter(response.headers) ?? backoffDelayMs(attempt);
          this.logger?.warn("Ingest rate limited, retrying batch.", {
            feedId,
            retryMs,
          });
          await sleep(retryMs);
          nextPending.push(batch);
          continue;
        }

        if (response.status >= 500) {
          await sleep(backoffDelayMs(attempt));
          nextPending.push(batch);
          continue;
        }

        throw new Error(
          `Ingest rejected feed ${feedId} batch with ${response.status}.`,
        );
      }

      pending = nextPending;

      if (pending.length > 0) {
        await sleep(backoffDelayMs(attempt));
      }
    }

    if (pending.length > 0) {
      throw new Error(
        `Failed to ingest ${pending.length} batch(es) for feed ${feedId}.`,
      );
    }

    return { inserted, skipped };
  }

  private async request(
    method: "POST" | "PUT",
    path: string,
    body: unknown,
  ): Promise<SinkResponse> {
    const response = await fetch(new URL(path, this.client.baseUrl), {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${this.ingestApiKey}`,
        "Content-Type": "application/json",
      },
      method,
    });
    const parsedBody = await parseBody(response);

    return {
      body: parsedBody,
      headers: response.headers,
      status: response.status,
    };
  }
}

function backoffDelayMs(attempt: number): number {
  return 1000 * 2 ** attempt;
}

function parseRetryAfter(headers: Headers): number | null {
  const header = headers.get("retry-after");

  if (header === null) {
    return null;
  }

  const numeric = Number(header);

  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric * 1000;
  }

  const dateValue = Date.parse(header);

  if (!Number.isFinite(dateValue)) {
    return null;
  }

  return Math.max(dateValue - Date.now(), 0);
}

async function parseBody(response: Response): Promise<unknown> {
  const text = await response.text();

  if (text.length === 0) {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  return contentType.includes("application/json")
    ? (JSON.parse(text) as unknown)
    : text;
}
