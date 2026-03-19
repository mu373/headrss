export function chunkArray<T>(
  values: ReadonlyArray<T>,
  chunkSize: number,
): T[][] {
  if (chunkSize <= 0) {
    throw new Error("Chunk size must be greater than zero.");
  }

  const chunks: T[][] = [];

  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }

  return chunks;
}
