import { describe, expect, it, vi } from "vitest";
import {
  emptyValidationCounts,
  type CandidateSourceGeneration,
  type ExactReading,
  type RangeCorrelation,
  type RangeSnapshot,
  type ReadingChunk,
  type ReadySourceGeneration,
} from "../../src/domain/readings";
import { encodeReadingChunk } from "../../src/worker/chunk-codec";
import { ChunkLru } from "../../src/worker/chunk-lru";
import { createGenerationManifest } from "../../src/worker/chunk-manifest";
import { queryActiveRange, warmChunkRange } from "../../src/worker/queries";
import { VolatileChunkRepository } from "../../src/worker/volatile-repository";

const generationId = "range-generation";
const correlation: RangeCorrelation = {
  datasetId: "range-dataset",
  generationId,
  viewId: "primary",
  requestId: "range-request",
  rangeRevision: 7,
};

async function preparedRepository() {
  const repository = new VolatileChunkRepository();
  const rowGroups: readonly (readonly ExactReading[])[] = [
    [
      { instantNs: 0n, bpm: 60, sourceId: 0, sourceOrder: 0 },
      { instantNs: 9n, bpm: 69, sourceId: 0, sourceOrder: 1 },
    ],
    [
      { instantNs: 10n, bpm: 70, sourceId: 0, sourceOrder: 2 },
      { instantNs: 20n, bpm: 80, sourceId: 0, sourceOrder: 3 },
    ],
    [
      { instantNs: 30n, bpm: 90, sourceId: 0, sourceOrder: 4 },
      { instantNs: 40n, bpm: 100, sourceId: 0, sourceOrder: 5 },
    ],
  ];
  const chunks: ReadingChunk[] = rowGroups.map((rows, chunkId) => {
    const encoded = encodeReadingChunk(rows);
    return {
      generationId,
      chunkId,
      rowCount: rows.length,
      byteLength: encoded.payload.byteLength,
      minimumInstantNs: rows[0]!.instantNs,
      maximumInstantNs: rows.at(-1)!.instantNs,
      firstSourceOrder: rows[0]!.sourceOrder,
      lastSourceOrder: rows.at(-1)!.sourceOrder,
      checksum: encoded.checksum,
      payload: encoded.payload,
    };
  });
  const validationCounts = { ...emptyValidationCounts(), accepted: 6 };
  const candidate: CandidateSourceGeneration = {
    generationId,
    sourceDigest: "ab".repeat(32),
    fileName: "range.json",
    fileSize: 1,
    lastModified: 1,
    formatVersion: 1,
    retention: "session",
    status: "finalizing",
    startedAt: 1,
    completedAt: null,
    acceptedCount: 6,
    duplicateCount: 0,
    validationCounts,
    minimumInstantNs: 0n,
    maximumInstantNs: 40n,
    chunkCount: chunks.length,
  };
  const ready: ReadySourceGeneration = {
    ...candidate,
    sourceDigest: candidate.sourceDigest!,
    status: "ready",
    completedAt: 2,
  };
  const manifest = createGenerationManifest({
    generationId,
    formatVersion: 1,
    chunks,
    acceptedCount: 6,
    validationCounts,
    sourceTable: ["watch"],
  });
  await repository.createGeneration(candidate);
  for (const chunk of chunks) await repository.putChunk(chunk);
  await repository.publishGeneration(ready, manifest);
  return repository;
}

describe("on-demand chunk-backed ranges", () => {
  it("reads only intersecting chunks and emits clipped, ordered partial snapshots", async () => {
    const repository = await preparedRepository();
    const originalReadChunk = repository.readChunk.bind(repository);
    const readChunk = vi.spyOn(repository, "readChunk");
    readChunk.mockImplementation(async (...arguments_) => {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return originalReadChunk(...arguments_);
    });
    const partials: RangeSnapshot[] = [];

    const result = await queryActiveRange(
      repository,
      correlation,
      { startInstantNs: 10n, endInstantNs: 30n },
      4,
      { offset: 0, limit: 25 },
      undefined,
      (snapshot) => partials.push(snapshot),
    );

    expect(readChunk.mock.calls.map(([, chunkId]) => chunkId)).toEqual([1, 2]);
    expect(partials).toHaveLength(1);
    expect(partials[0]).toMatchObject({
      status: "partial",
      summary: null,
      coveredIntervals: [{ startInstantNs: 10n, endInstantNs: 20n }],
      progress: { loadedChunkCount: 1, totalChunkCount: 2 },
    });
    expect(partials[0]!.readingCount).toBe(2);
    expect(partials[0]!.readingPage.rows.map((reading) => reading.instantMs)).toEqual([0, 0]);
    expect(result.status).toBe("complete");
    expect(result.coveredIntervals).toEqual([{ startInstantNs: 10n, endInstantNs: 30n }]);
    expect(result.readingCount).toBe(3);
    expect(result.summary).toMatchObject({ count: 3, minimumBpm: 70, maximumBpm: 90, meanBpm: 80 });
    expect(result.readingPage).toMatchObject({ totalRows: 3, page: 1, pageSize: 25 });
    expect(result.displaySeries.mode).toBe("exact");
  });

  it("returns complete empty coverage with no summary", async () => {
    const repository = await preparedRepository();
    const result = await queryActiveRange(
      repository,
      correlation,
      { startInstantNs: 21n, endInstantNs: 29n },
      100,
      { offset: 0, limit: 50 },
    );

    expect(result).toMatchObject({
      status: "empty",
      summary: null,
      readingCount: 0,
      coveredIntervals: [{ startInstantNs: 21n, endInstantNs: 29n }],
    });
  });

  it("keeps the established display aggregation budget separate from exact results", async () => {
    const repository = await preparedRepository();
    const result = await queryActiveRange(
      repository,
      correlation,
      { startInstantNs: 0n, endInstantNs: 40n },
      4,
      { offset: 0, limit: 25 },
    );

    expect(result.readingCount).toBe(6);
    expect(result.summary?.count).toBe(6);
    expect(result.displaySeries.mode).toBe("aggregated");
    expect(result.displaySeries.timestamps.length).toBeLessThanOrEqual(4);
  });
});

describe("decoded chunk cache integration", () => {
  it("decodes a chunk once and reuses it from the cache on a later request", async () => {
    const repository = await preparedRepository();
    const readChunk = vi.spyOn(repository, "readChunk");
    const cache = new ChunkLru();

    await queryActiveRange(
      repository,
      correlation,
      { startInstantNs: 10n, endInstantNs: 20n },
      100,
      { offset: 0, limit: 50 },
      undefined,
      undefined,
      undefined,
      cache,
    );
    expect(readChunk).toHaveBeenCalledTimes(1);
    expect(cache.stats.misses).toBe(1);

    const second = await queryActiveRange(
      repository,
      correlation,
      { startInstantNs: 10n, endInstantNs: 20n },
      100,
      { offset: 0, limit: 50 },
      undefined,
      undefined,
      undefined,
      cache,
    );

    expect(readChunk).toHaveBeenCalledTimes(1);
    expect(cache.stats.hits).toBe(1);
    expect(second.readingCount).toBe(2);
  });

  it("never caches a chunk that fails checksum validation", async () => {
    const repository = await preparedRepository();
    const chunk = await repository.readChunk(generationId, 1);
    const corrupted = new Uint8Array(chunk!.payload.slice(0));
    corrupted[corrupted.length - 1] ^= 0xff;
    vi.spyOn(repository, "readChunk").mockResolvedValueOnce({
      ...chunk!,
      payload: corrupted.buffer,
    });
    const cache = new ChunkLru();

    await expect(
      queryActiveRange(
        repository,
        correlation,
        { startInstantNs: 10n, endInstantNs: 20n },
        100,
        { offset: 0, limit: 50 },
        undefined,
        undefined,
        undefined,
        cache,
      ),
    ).rejects.toThrow(/checksum/i);
    expect(cache.get(generationId, 1)).toBeUndefined();
  });
});

describe("background chunk warming (read-ahead)", () => {
  it("warms uncached chunks and reuses already-cached chunks without duplicate reads", async () => {
    const repository = await preparedRepository();
    const readChunk = vi.spyOn(repository, "readChunk");
    const active = await repository.getActiveManifest();
    const cache = new ChunkLru();

    const first = await warmChunkRange(
      repository,
      generationId,
      active!.manifest,
      { startInstantNs: 0n, endInstantNs: 40n },
      cache,
    );

    expect(first.warmedChunkCount).toBe(3);
    expect(readChunk).toHaveBeenCalledTimes(3);

    const second = await warmChunkRange(
      repository,
      generationId,
      active!.manifest,
      { startInstantNs: 0n, endInstantNs: 40n },
      cache,
    );

    expect(second.warmedChunkCount).toBe(0);
    expect(readChunk).toHaveBeenCalledTimes(3);
  });

  it("stops without throwing once foreground work arrives", async () => {
    const repository = await preparedRepository();
    const readChunk = vi.spyOn(repository, "readChunk");
    const active = await repository.getActiveManifest();
    const cache = new ChunkLru();
    let foregroundArrived = false;

    const result = await warmChunkRange(
      repository,
      generationId,
      active!.manifest,
      { startInstantNs: 0n, endInstantNs: 40n },
      cache,
      undefined,
      () => foregroundArrived,
    );
    expect(result.warmedChunkCount).toBe(3);

    cache.clear();
    readChunk.mockClear();
    foregroundArrived = true;
    const preempted = await warmChunkRange(
      repository,
      generationId,
      active!.manifest,
      { startInstantNs: 0n, endInstantNs: 40n },
      cache,
      undefined,
      () => foregroundArrived,
    );

    expect(preempted.warmedChunkCount).toBe(0);
    expect(readChunk).not.toHaveBeenCalled();
  });

  it("skips further warming once pinned foreground use already fills the cache budget", async () => {
    const repository = await preparedRepository();
    const active = await repository.getActiveManifest();
    const cache = new ChunkLru(1);
    cache.put(
      generationId,
      99,
      {
        instantNs: new BigInt64Array(0),
        endInstantNs: new BigInt64Array(0),
        bpm: new Float64Array(0),
        sourceIds: new Uint32Array(0),
        sourceOrders: new Uint32Array(0),
      },
      1,
      { pinned: true },
    );

    const result = await warmChunkRange(
      repository,
      generationId,
      active!.manifest,
      { startInstantNs: 0n, endInstantNs: 40n },
      cache,
    );

    expect(result.warmedChunkCount).toBe(0);
  });

  it("isolates a single corrupted background chunk without failing the rest of the warm-up", async () => {
    const repository = await preparedRepository();
    const original = await repository.readChunk(generationId, 1);
    const corrupted = new Uint8Array(original!.payload.slice(0));
    corrupted[corrupted.length - 1] ^= 0xff;
    vi.spyOn(repository, "readChunk").mockImplementation(async (generation, chunkId, signal) => {
      const chunk = await VolatileChunkRepository.prototype.readChunk.call(
        repository,
        generation,
        chunkId,
        signal,
      );
      return chunkId === 1 ? { ...chunk!, payload: corrupted.buffer } : chunk;
    });
    const active = await repository.getActiveManifest();
    const cache = new ChunkLru();

    const result = await warmChunkRange(
      repository,
      generationId,
      active!.manifest,
      { startInstantNs: 0n, endInstantNs: 40n },
      cache,
    );

    expect(result.warmedChunkCount).toBe(2);
    expect(cache.get(generationId, 0)).toBeDefined();
    expect(cache.get(generationId, 1)).toBeUndefined();
    expect(cache.get(generationId, 2)).toBeDefined();
  });
});
