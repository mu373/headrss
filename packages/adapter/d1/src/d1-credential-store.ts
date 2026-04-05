import type {
  FeedCredential,
  FeedCredentialInput,
  FeedCredentialStore,
} from "@headrss/core";

interface FeedCredentialRow {
  id: number;
  feed_id: number;
  auth_type: string;
  credentials_encrypted: ArrayBuffer | Uint8Array;
  created_at: number;
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

const toUint8Array = (value: ArrayBuffer | Uint8Array): Uint8Array => {
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return new Uint8Array(value);
};

const concatBuffers = (first: Uint8Array, second: Uint8Array): Uint8Array => {
  const merged = new Uint8Array(first.byteLength + second.byteLength);
  merged.set(first, 0);
  merged.set(second, first.byteLength);
  return merged;
};

export class D1CredentialStore implements FeedCredentialStore {
  readonly #db: D1Database;
  readonly #keyPromise: Promise<CryptoKey>;
  readonly #encoder = new TextEncoder();

  public constructor(db: D1Database, credentialKey: string) {
    this.#db = db;
    this.#keyPromise = this.#deriveKey(credentialKey);
  }

  public async get(feedId: number): Promise<FeedCredential | null> {
    const row = await this.#db
      .prepare(
        `
          SELECT
            id,
            feed_id,
            auth_type,
            credentials_encrypted,
            created_at
          FROM feed_credentials
          WHERE feed_id = ?
        `,
      )
      .bind(feedId)
      .first<FeedCredentialRow>();

    if (row === null) {
      return null;
    }

    return {
      id: row.id,
      feedId: row.feed_id,
      authType: row.auth_type,
      credentialsEncrypted: await this.#decrypt(
        toUint8Array(row.credentials_encrypted),
      ),
      createdAt: row.created_at,
    };
  }

  public async set(
    feedId: number,
    credential: FeedCredentialInput,
  ): Promise<FeedCredential> {
    const createdAt = nowSeconds();
    const encrypted = await this.#encrypt(credential.credentialsEncrypted);

    await this.#db
      .prepare(
        `
          INSERT INTO feed_credentials (
            feed_id,
            auth_type,
            credentials_encrypted,
            created_at
          )
          VALUES (?, ?, ?, ?)
          ON CONFLICT(feed_id) DO UPDATE SET
            auth_type = excluded.auth_type,
            credentials_encrypted = excluded.credentials_encrypted,
            created_at = excluded.created_at
        `,
      )
      .bind(feedId, credential.authType, encrypted, createdAt)
      .run();

    const saved = await this.get(feedId);
    if (saved === null) {
      throw new Error("Failed to load feed credential.");
    }
    return saved;
  }

  public async delete(feedId: number): Promise<boolean> {
    const result = await this.#db
      .prepare("DELETE FROM feed_credentials WHERE feed_id = ?")
      .bind(feedId)
      .run();
    return result.meta.changes > 0;
  }

  async #deriveKey(secret: string): Promise<CryptoKey> {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      this.#encoder.encode(secret),
    );
    return crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]);
  }

  async #encrypt(plaintext: ArrayBuffer): Promise<Uint8Array> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await this.#keyPromise;
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      plaintext,
    );
    return concatBuffers(iv, new Uint8Array(ciphertext));
  }

  async #decrypt(payload: Uint8Array): Promise<ArrayBuffer> {
    const bytes = payload;
    if (bytes.byteLength < 13) {
      throw new Error("Stored credential payload is invalid.");
    }
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const key = await this.#keyPromise;

    return crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ciphertext);
  }
}
