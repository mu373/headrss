export { parseStreamId } from "./stream-id.js";

const ITEM_ID_PREFIX = "tag:google.com,2005:reader/item/";

export function numericIdToGReaderId(id: number): string {
  return `${ITEM_ID_PREFIX}${id.toString(16).padStart(16, "0")}`;
}

export function numericIdToGReaderShortId(id: number): string {
  return String(id);
}

export function gReaderIdToNumericId(grId: string): number {
  // Long form: tag:google.com,2005:reader/item/<16-char hex>
  if (grId.startsWith(ITEM_ID_PREFIX)) {
    const hex = grId.slice(ITEM_ID_PREFIX.length);
    const value = Number.parseInt(hex, 16);
    if (!Number.isNaN(value)) {
      return value;
    }
    throw new Error("Invalid Google Reader item ID.");
  }

  // Short form: signed decimal number
  const dec = Number.parseInt(grId, 10);
  if (!Number.isNaN(dec) && String(dec) === grId) {
    return dec;
  }

  throw new Error("Invalid Google Reader item ID.");
}
