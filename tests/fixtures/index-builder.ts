export interface SyntheticChunkRow {
  readonly instantNs: bigint;
  readonly bpm: number;
  readonly sourceId: number;
  readonly sourceOrder: number;
}

export interface SyntheticChunk {
  readonly generationId: string;
  readonly chunkId: number;
  readonly rows: readonly SyntheticChunkRow[];
}

export interface SyntheticGeneration {
  readonly generationId: string;
  readonly sourceDigest: string;
  readonly retention: "persistent" | "session";
  readonly chunks: readonly SyntheticChunk[];
}

export function syntheticRows(count: number, startNs = 1_700_000_000_000_000_000n) {
  return Array.from({ length: count }, (_, sourceOrder): SyntheticChunkRow => ({
    instantNs: startNs + BigInt(sourceOrder) * 60_000_000_000n,
    bpm: 60 + (sourceOrder % 80),
    sourceId: sourceOrder % 3,
    sourceOrder,
  }));
}

export function syntheticGeneration(
  rowCount = 4,
  chunkSize = 2,
  retention: "persistent" | "session" = "persistent",
): SyntheticGeneration {
  const generationId = "synthetic-generation";
  const rows = syntheticRows(rowCount);
  return {
    generationId,
    sourceDigest: "00".repeat(32),
    retention,
    chunks: Array.from({ length: Math.ceil(rows.length / chunkSize) }, (_, chunkId) => ({
      generationId,
      chunkId,
      rows: rows.slice(chunkId * chunkSize, (chunkId + 1) * chunkSize),
    })),
  };
}

export function corruptBytes(bytes: Uint8Array, offset = bytes.length - 1): Uint8Array {
  const corrupted = bytes.slice();
  if (corrupted.length > 0) corrupted[Math.max(0, Math.min(offset, corrupted.length - 1))] ^= 0xff;
  return corrupted;
}

export const quotaExceededError = (): DOMException =>
  new DOMException("Synthetic quota exhausted", "QuotaExceededError");
