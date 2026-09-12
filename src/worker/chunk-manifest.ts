import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import {
  INDEX_FORMAT_VERSION,
  MAX_CHUNK_ROWS,
  assertInclusiveRange,
  assertNonNegativeInteger,
  type ChunkDescriptor,
  type GenerationManifest,
  type InclusiveInstantRange,
  type ValidationCounts,
} from "../domain/readings";

export type GenerationManifestInput = Omit<GenerationManifest, "checksum">;

export function createGenerationManifest(input: GenerationManifestInput): GenerationManifest {
  const chunks = [...input.chunks]
    .map((chunk) => Object.freeze({ ...chunk }))
    .sort(compareDescriptors);
  const manifest: GenerationManifest = {
    ...input,
    chunks: Object.freeze(chunks),
    sourceTable: Object.freeze([...input.sourceTable]),
    validationCounts: Object.freeze({ ...input.validationCounts }),
    checksum: "",
  };
  const complete = Object.freeze({ ...manifest, checksum: manifestChecksum(manifest) });
  validateGenerationManifest(complete);
  return complete;
}

export function manifestChecksum(manifest: GenerationManifestInput | GenerationManifest): string {
  const canonical = JSON.stringify({
    generationId: manifest.generationId,
    formatVersion: manifest.formatVersion,
    chunks: manifest.chunks.map((chunk) => ({
      chunkId: chunk.chunkId,
      rowCount: chunk.rowCount,
      byteLength: chunk.byteLength,
      minimumInstantNs: chunk.minimumInstantNs.toString(),
      maximumInstantNs: chunk.maximumInstantNs.toString(),
      firstSourceOrder: chunk.firstSourceOrder,
      lastSourceOrder: chunk.lastSourceOrder,
      checksum: chunk.checksum,
    })),
    acceptedCount: manifest.acceptedCount,
    validationCounts: canonicalValidationCounts(manifest.validationCounts),
    sourceTable: manifest.sourceTable,
  });
  return bytesToHex(sha256(new TextEncoder().encode(canonical)));
}

export function validateGenerationManifest(manifest: GenerationManifest): void {
  if (manifest.formatVersion !== INDEX_FORMAT_VERSION)
    throw new Error("Manifest format is unsupported");
  if (!manifest.generationId) throw new Error("Manifest generation ID is required");
  assertNonNegativeInteger(manifest.acceptedCount, "acceptedCount");
  validateCounts(manifest.validationCounts);
  if (manifest.validationCounts.accepted !== manifest.acceptedCount) {
    throw new Error("Manifest accepted count disagrees with validation counts");
  }
  if (new Set(manifest.sourceTable).size !== manifest.sourceTable.length) {
    throw new Error("Manifest source table contains duplicate identifiers");
  }

  for (let index = 1; index < manifest.chunks.length; index += 1) {
    if (compareDescriptors(manifest.chunks[index - 1]!, manifest.chunks[index]!) > 0) {
      throw new Error("Manifest descriptors are out of order");
    }
  }

  let aggregateRows = 0;
  manifest.chunks.forEach((chunk, index) => {
    validateDescriptor(chunk);
    const previous = manifest.chunks[index - 1];
    if (chunk.chunkId !== index) throw new Error("Manifest chunk IDs must be sequential");
    if (
      previous &&
      (previous.maximumInstantNs > chunk.minimumInstantNs ||
        (previous.maximumInstantNs === chunk.minimumInstantNs &&
          previous.lastSourceOrder > chunk.firstSourceOrder))
    ) {
      throw new Error("Manifest descriptor ranges are not globally ordered");
    }
    aggregateRows += chunk.rowCount;
  });
  if (aggregateRows !== manifest.acceptedCount) {
    throw new Error("Manifest chunk row counts disagree with accepted count");
  }
  if (manifestChecksum(manifest) !== manifest.checksum.toLowerCase()) {
    throw new Error("Manifest checksum mismatch");
  }
}

export function selectChunkDescriptors(
  manifest: GenerationManifest,
  range: InclusiveInstantRange,
): readonly ChunkDescriptor[] {
  validateGenerationManifest(manifest);
  assertInclusiveRange(range);
  let low = 0;
  let high = manifest.chunks.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (manifest.chunks[middle]!.maximumInstantNs < range.startInstantNs) low = middle + 1;
    else high = middle;
  }
  let end = low;
  while (
    end < manifest.chunks.length &&
    manifest.chunks[end]!.minimumInstantNs <= range.endInstantNs
  ) {
    end += 1;
  }
  return manifest.chunks.slice(low, end);
}

function compareDescriptors(left: ChunkDescriptor, right: ChunkDescriptor): number {
  if (left.minimumInstantNs < right.minimumInstantNs) return -1;
  if (left.minimumInstantNs > right.minimumInstantNs) return 1;
  return left.firstSourceOrder - right.firstSourceOrder;
}

function validateDescriptor(chunk: ChunkDescriptor): void {
  assertNonNegativeInteger(chunk.chunkId, "chunkId");
  if (!Number.isInteger(chunk.rowCount) || chunk.rowCount < 1 || chunk.rowCount > MAX_CHUNK_ROWS) {
    throw new RangeError(`Descriptor row count must be between 1 and ${MAX_CHUNK_ROWS}`);
  }
  if (chunk.byteLength !== 32 + chunk.rowCount * 32) {
    throw new Error("Descriptor byte length is invalid for format version 1");
  }
  if (chunk.minimumInstantNs > chunk.maximumInstantNs)
    throw new Error("Descriptor range is invalid");
  assertNonNegativeInteger(chunk.firstSourceOrder, "firstSourceOrder");
  assertNonNegativeInteger(chunk.lastSourceOrder, "lastSourceOrder");
  if (!/^[0-9a-f]{64}$/.test(chunk.checksum)) throw new Error("Descriptor checksum is invalid");
}

function validateCounts(counts: ValidationCounts): void {
  for (const [name, value] of Object.entries(counts)) assertNonNegativeInteger(value, name);
}

function canonicalValidationCounts(counts: ValidationCounts): ValidationCounts {
  return {
    accepted: counts.accepted,
    duplicate: counts.duplicate,
    missing: counts.missing,
    malformed: counts.malformed,
    outOfRange: counts.outOfRange,
  };
}
