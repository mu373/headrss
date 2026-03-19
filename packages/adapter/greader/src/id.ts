export { parseStreamId } from "./stream-id.js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export function publicIdToGReaderId(publicId: string): string {
  return [...textEncoder.encode(publicId)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function gReaderIdToPublicId(grId: string): string {
  if (grId.length === 0 || grId.length % 2 !== 0) {
    throw new Error("Invalid Google Reader item ID.");
  }

  const bytes = new Uint8Array(grId.length / 2);

  for (let index = 0; index < grId.length; index += 2) {
    const value = Number.parseInt(grId.slice(index, index + 2), 16);

    if (Number.isNaN(value)) {
      throw new Error("Invalid Google Reader item ID.");
    }

    bytes[index / 2] = value;
  }

  return textDecoder.decode(bytes);
}
