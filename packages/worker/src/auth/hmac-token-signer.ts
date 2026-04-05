interface SignedPayload extends Record<string, unknown> {
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const nowInSeconds = (): number => Math.floor(Date.now() / 1000);

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
};

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const view = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  return view as ArrayBuffer;
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

export class HmacTokenSigner<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly #keyPromise: Promise<CryptoKey>;

  public constructor(secret: string) {
    this.#keyPromise = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      {
        name: "HMAC",
        hash: "SHA-256",
      },
      false,
      ["sign", "verify"],
    );
  }

  public async sign(payload: TPayload, ttl: number): Promise<string> {
    const body: SignedPayload = {
      ...payload,
      exp: nowInSeconds() + ttl,
    };
    const encodedPayload = encoder.encode(JSON.stringify(body));
    const signature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await this.#keyPromise,
        toArrayBuffer(encodedPayload),
      ),
    );

    return `${toBase64Url(encodedPayload)}.${toBase64Url(signature)}`;
  }

  public async verify(token: string): Promise<TPayload | null> {
    const [payloadPart, signaturePart, extra] = token.split(".");

    if (
      payloadPart === undefined ||
      signaturePart === undefined ||
      extra !== undefined
    ) {
      return null;
    }

    const encodedPayload = fromBase64Url(payloadPart);
    const actualSignature = fromBase64Url(signaturePart);

    if (encodedPayload === null || actualSignature === null) {
      return null;
    }

    const expectedSignature = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        await this.#keyPromise,
        toArrayBuffer(encodedPayload),
      ),
    );

    if (!timingSafeEqual(actualSignature, expectedSignature)) {
      return null;
    }

    let decoded: unknown;

    try {
      decoded = JSON.parse(decoder.decode(encodedPayload)) as unknown;
    } catch {
      return null;
    }

    const expiresAt = isRecord(decoded) ? decoded.exp : undefined;

    if (
      !isRecord(decoded) ||
      typeof expiresAt !== "number" ||
      !Number.isInteger(expiresAt) ||
      expiresAt <= nowInSeconds()
    ) {
      return null;
    }

    const { exp: _exp, ...payload } = decoded;
    return payload as TPayload;
  }
}
