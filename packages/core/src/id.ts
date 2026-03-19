import { createHash } from "node:crypto";

const BASE62_ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const PUBLIC_ID_LENGTH = 22;

function encodeBase62(bytes: Uint8Array): string {
  let value = 0n;

  for (const byte of bytes) {
    value = (value << 8n) + BigInt(byte);
  }

  let encoded = "";

  if (value === 0n) {
    encoded = "0";
  }

  while (value > 0n) {
    const remainder = Number(value % 62n);
    encoded = `${BASE62_ALPHABET[remainder]}${encoded}`;
    value /= 62n;
  }

  if (encoded.length > PUBLIC_ID_LENGTH) {
    throw new Error("Public ID overflow.");
  }

  return encoded.padStart(PUBLIC_ID_LENGTH, "0");
}

export function generatePublicId(feedUrl: string, guid: string): string {
  const digest = createHash("sha256")
    .update(feedUrl)
    .update(":")
    .update(guid)
    .digest()
    .subarray(0, 16);

  return encodeBase62(digest);
}
