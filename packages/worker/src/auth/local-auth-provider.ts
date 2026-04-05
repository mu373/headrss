import type {
  AppPassword,
  AuthProvider,
  AuthValidationResult,
  EntryStore,
} from "@headrss/core";

const encoder = new TextEncoder();

const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

const fromBase64Url = (value: string): Uint8Array | null => {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));

  try {
    const binary = atob(`${normalized}${padding}`);
    const bytes = new Uint8Array(binary.length);

    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }

    return bytes;
  } catch {
    return null;
  }
};

const timingSafeEqual = (left: Uint8Array, right: Uint8Array): boolean => {
  if (left.byteLength !== right.byteLength) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return diff === 0;
};

const hashLegacyPassword = async (
  plaintext: string,
  salt: string,
): Promise<Uint8Array> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(`${salt}:${plaintext}`),
  );
  return new Uint8Array(digest);
};

const derivePbkdf2Digest = async (
  plaintext: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> => {
  const normalizedSalt = new Uint8Array(salt.byteLength);
  normalizedSalt.set(salt);
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(plaintext),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: normalizedSalt.buffer,
      iterations,
    },
    key,
    256,
  );
  return new Uint8Array(derivedBits);
};

const parsePasswordHash = (
  passwordHash: string,
):
  | { algorithm: "sha256"; salt: string; digest: Uint8Array }
  | {
      algorithm: "pbkdf2";
      iterations: number;
      salt: Uint8Array;
      digest: Uint8Array;
    }
  | null => {
  const parts = passwordHash.split("$");
  const [algorithm] = parts;

  if (algorithm === "sha256") {
    const [, salt, digest, extra] = parts;
    if (salt === undefined || digest === undefined || extra !== undefined) {
      return null;
    }

    const decodedDigest = fromBase64Url(digest);
    if (decodedDigest === null) {
      return null;
    }

    return {
      algorithm,
      salt,
      digest: decodedDigest,
    };
  }

  if (algorithm === "pbkdf2") {
    const [, iterationsText, saltText, digestText, extra] = parts;
    if (
      iterationsText === undefined ||
      saltText === undefined ||
      digestText === undefined ||
      extra !== undefined
    ) {
      return null;
    }

    const iterations = Number(iterationsText);
    const salt = fromBase64Url(saltText);
    const digest = fromBase64Url(digestText);
    if (
      !Number.isInteger(iterations) ||
      iterations <= 0 ||
      salt === null ||
      digest === null
    ) {
      return null;
    }

    return {
      algorithm,
      iterations,
      salt,
      digest,
    };
  }

  return null;
};

const matchesPassword = async (
  password: string,
  appPassword: AppPassword,
): Promise<boolean> => {
  const parsed = parsePasswordHash(appPassword.passwordHash);

  if (parsed === null) {
    return false;
  }

  if (parsed.algorithm === "sha256") {
    const actualDigest = await hashLegacyPassword(password, parsed.salt);
    return timingSafeEqual(actualDigest, parsed.digest);
  }

  const actualDigest = await derivePbkdf2Digest(
    password,
    parsed.salt,
    parsed.iterations,
  );
  return timingSafeEqual(actualDigest, parsed.digest);
};

export class LocalAuthProvider implements AuthProvider {
  readonly #store: EntryStore;

  public constructor(store: EntryStore) {
    this.#store = store;
  }

  public async validateCredentials(
    username: string,
    password: string,
  ): Promise<AuthValidationResult | null> {
    const user = await this.#store.getUserByUsername(username);

    if (user === null) {
      return null;
    }

    const appPasswords = await this.#store.listAppPasswordsByUserId(user.id);

    for (const appPassword of appPasswords) {
      if (!(await matchesPassword(password, appPassword))) {
        continue;
      }

      await this.#store.touchAppPassword(appPassword.id, nowInSeconds());

      return {
        userId: user.id,
        appPasswordId: appPassword.id,
        passwordVersion: appPassword.passwordVersion,
      };
    }

    return null;
  }

  public async validatePasswordVersion(
    userId: number,
    appPasswordId: number,
    passwordVersion: number,
  ): Promise<boolean> {
    const appPassword = await this.#store.getAppPasswordById(appPasswordId);

    return (
      appPassword?.userId === userId &&
      appPassword.passwordVersion === passwordVersion
    );
  }
}
