import { describe, expect, it } from "vitest";
import { emptyValidationCounts, type ChunkDescriptor } from "../../src/domain/readings";
import {
  createGenerationManifest,
  manifestChecksum,
  selectChunkDescriptors,
  validateGenerationManifest,
} from "../../src/worker/chunk-manifest";

const descriptor = (
  chunkId: number,
  minimumInstantNs: bigint,
  maximumInstantNs: bigint,
  firstSourceOrder = chunkId * 10,
  rowCount = 2,
): ChunkDescriptor => ({
  chunkId,
  rowCount,
  byteLength: 32 + rowCount * 32,
  minimumInstantNs,
  maximumInstantNs,
  firstSourceOrder,
  lastSourceOrder: firstSourceOrder + rowCount - 1,
  checksum: chunkId.toString(16).padStart(64, "0"),
});

describe("generation manifest", () => {
  it("constructs an immutable manifest sorted by minimum instant then source order", () => {
    const manifest = createGenerationManifest({
      generationId: "generation",
      formatVersion: 1,
      chunks: [descriptor(2, 20n, 29n), descriptor(1, 10n, 19n, 5), descriptor(0, 10n, 10n, 1)],
      acceptedCount: 6,
      validationCounts: { ...emptyValidationCounts(), accepted: 6 },
      sourceTable: ["watch", "phone"],
    });

    expect(manifest.chunks.map((chunk) => chunk.chunkId)).toEqual([0, 1, 2]);
    expect(manifest.checksum).toBe(manifestChecksum(manifest));
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.chunks)).toBe(true);
  });

  it("selects closed-interval intersections at exact boundaries", () => {
    const manifest = createGenerationManifest({
      generationId: "generation",
      formatVersion: 1,
      chunks: [descriptor(0, 0n, 9n), descriptor(1, 10n, 19n), descriptor(2, 20n, 29n)],
      acceptedCount: 6,
      validationCounts: { ...emptyValidationCounts(), accepted: 6 },
      sourceTable: ["watch"],
    });

    expect(
      selectChunkDescriptors(manifest, { startInstantNs: 9n, endInstantNs: 10n }).map(
        (chunk) => chunk.chunkId,
      ),
    ).toEqual([0, 1]);
    expect(
      selectChunkDescriptors(manifest, { startInstantNs: 19n, endInstantNs: 20n }).map(
        (chunk) => chunk.chunkId,
      ),
    ).toEqual([1, 2]);
    expect(selectChunkDescriptors(manifest, { startInstantNs: 30n, endInstantNs: 40n })).toEqual(
      [],
    );
  });

  it("supports empty generations", () => {
    const manifest = createGenerationManifest({
      generationId: "empty",
      formatVersion: 1,
      chunks: [],
      acceptedCount: 0,
      validationCounts: emptyValidationCounts(),
      sourceTable: [],
    });
    expect(() => validateGenerationManifest(manifest)).not.toThrow();
    expect(selectChunkDescriptors(manifest, { startInstantNs: 0n, endInstantNs: 0n })).toEqual([]);
  });

  it("invalidates unsupported formats, bad ordering, count disagreement, and checksum changes", () => {
    const valid = createGenerationManifest({
      generationId: "generation",
      formatVersion: 1,
      chunks: [descriptor(0, 0n, 9n)],
      acceptedCount: 2,
      validationCounts: { ...emptyValidationCounts(), accepted: 2 },
      sourceTable: ["watch"],
    });
    const unsupported = { ...valid, formatVersion: 2 };
    expect(() =>
      validateGenerationManifest({ ...unsupported, checksum: manifestChecksum(unsupported) }),
    ).toThrow(/format/i);
    const unordered = { ...valid, chunks: [descriptor(1, 10n, 19n), descriptor(0, 0n, 9n)] };
    expect(() =>
      validateGenerationManifest({ ...unordered, checksum: manifestChecksum(unordered) }),
    ).toThrow(/order/i);
    const wrongCount = { ...valid, acceptedCount: 3 };
    expect(() =>
      validateGenerationManifest({ ...wrongCount, checksum: manifestChecksum(wrongCount) }),
    ).toThrow(/count/i);
    expect(() => validateGenerationManifest({ ...valid, checksum: "ff".repeat(32) })).toThrow(
      /checksum/i,
    );
  });
});
