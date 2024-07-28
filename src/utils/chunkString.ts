export function chunkString(input: string, maxChunkSize: number): string[] {
  const length = input.length;
  const chunks: string[] = new Array(Math.ceil(length / maxChunkSize));
  let chunkIndex = 0;
  let startIndex = 0;
  let endIndex = 0;

  while (endIndex < length) {
    endIndex = Math.min(startIndex + maxChunkSize, length);
    chunks[chunkIndex++] = input.substring(startIndex, endIndex);
    startIndex = endIndex;
  }

  return chunks;
}
