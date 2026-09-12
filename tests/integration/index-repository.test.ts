import { describe, expect, it } from "vitest";
import {
  emptyValidationCounts,
  type CandidateSourceGeneration,
  type ReadingChunk,
  type ReadySourceGeneration,
} from "../../src/domain/readings";
import { encodeReadingChunk } from "../../src/worker/chunk-codec";
import { createGenerationManifest } from "../../src/worker/chunk-manifest";
import {
  DATABASE_NAME,
  DATABASE_VERSION,
  IndexedDbChunkRepository,
} from "../../src/worker/indexeddb-repository";
import { queryActiveRange } from "../../src/worker/queries";

function preparedGeneration(generationId: string, instantNs: bigint) {
  const encoded = encodeReadingChunk([
    {
      instantNs,
      endInstantNs: instantNs + 5n,
      bpm: 72,
      sourceId: 0,
      sourceOrder: 0,
    },
  ]);
  const chunk: ReadingChunk = {
    generationId,
    chunkId: 0,
    rowCount: 1,
    byteLength: encoded.payload.byteLength,
    minimumInstantNs: instantNs,
    maximumInstantNs: instantNs,
    firstSourceOrder: 0,
    lastSourceOrder: 0,
    checksum: encoded.checksum,
    payload: encoded.payload,
  };
  const validationCounts = { ...emptyValidationCounts(), accepted: 1 };
  const candidate: CandidateSourceGeneration = {
    generationId,
    sourceDigest: "ab".repeat(32),
    fileName: `${generationId}.json`,
    fileSize: 100,
    lastModified: 10,
    formatVersion: 1,
    retention: "persistent",
    status: "finalizing",
    startedAt: 1,
    completedAt: null,
    acceptedCount: 1,
    duplicateCount: 0,
    validationCounts,
    minimumInstantNs: instantNs,
    maximumInstantNs: instantNs,
    chunkCount: 1,
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
    chunks: [chunk],
    acceptedCount: 1,
    validationCounts,
    sourceTable: ["watch"],
  });
  return { candidate, ready, chunk, manifest };
}

describe("IndexedDB chunk repository", () => {
  it("opens the version 2 typed schema with the specified stores and indexes", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const database = repository.database;

    expect(database.name).toBe(DATABASE_NAME);
    expect(database.version).toBe(DATABASE_VERSION);
    expect([...database.objectStoreNames]).toEqual([
      "chunks",
      "control",
      "generations",
      "manifests",
      "stagingRuns",
    ]);
    const transaction = database.transaction(["generations", "chunks", "stagingRuns"]);
    expect([...transaction.objectStore("generations").indexNames]).toEqual([
      "by-source-digest",
      "by-status",
    ]);
    expect([...transaction.objectStore("chunks").indexNames]).toEqual(["by-generation"]);
    expect([...transaction.objectStore("stagingRuns").indexNames]).toEqual(["by-generation"]);
    await transaction.done;
    await repository.close();
  });

  it("publishes atomically, retains the previous active generation on failure, and cleans in bounds", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const first = preparedGeneration("first", 10n);
    await repository.createGeneration(first.candidate);
    await repository.putChunk(first.chunk);
    await repository.publishGeneration(first.ready, first.manifest);

    const replacement = preparedGeneration("replacement", 20n);
    await repository.createGeneration(replacement.candidate);
    await expect(
      repository.publishGeneration(replacement.ready, replacement.manifest),
    ).rejects.toThrow(/missing chunk/i);
    expect((await repository.getActiveManifest())?.generation.generationId).toBe("first");

    const abandoned = preparedGeneration("abandoned", 30n);
    await repository.createGeneration({ ...abandoned.candidate, status: "failed" });
    expect(await repository.cleanupAbandonedGenerations(1)).toBe(1);
    expect(await repository.getGeneration("abandoned")).toBeUndefined();
    expect((await repository.getActiveManifest())?.generation.generationId).toBe("first");
    await repository.close();
  });

  it("returns a persisted reading inside an inclusive active range", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const instantNs = BigInt(Date.UTC(2026, 8, 12, 0, 1)) * 1_000_000n;
    const prepared = preparedGeneration("today", instantNs);
    await repository.createGeneration(prepared.candidate);
    await repository.putChunk(prepared.chunk);
    await repository.publishGeneration(prepared.ready, prepared.manifest);

    const snapshot = await queryActiveRange(
      repository,
      {
        datasetId: "today",
        generationId: "today",
        viewId: "test",
        requestId: "request",
        rangeRevision: 0,
      },
      {
        startInstantNs: BigInt(Date.UTC(2026, 8, 12)) * 1_000_000n,
        endInstantNs: BigInt(Date.UTC(2026, 8, 13)) * 1_000_000n - 1n,
      },
      100,
      { offset: 0, limit: 50 },
    );

    expect(snapshot.status).toBe("complete");
    expect(snapshot.summary?.count).toBe(1);
    expect(snapshot.readingPage.rows[0]?.bpm).toBe(72);
    await repository.close();
  });

  it("never applies a publication interrupted before its transaction begins", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const prepared = preparedGeneration("interrupted", 40n);
    await repository.createGeneration(prepared.candidate);
    await repository.putChunk(prepared.chunk);
    const controller = new AbortController();
    controller.abort();

    await expect(
      repository.publishGeneration(prepared.ready, prepared.manifest, controller.signal),
    ).rejects.toThrow();
    expect(await repository.getActiveManifest()).toBeUndefined();
    expect((await repository.getGeneration("interrupted"))?.status).toBe("finalizing");
    await repository.close();
  });

  it("rejects an unsupported manifest format version at publication", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const prepared = preparedGeneration("unsupported-format", 50n);
    await repository.createGeneration(prepared.candidate);
    await repository.putChunk(prepared.chunk);
    const unsupported = {
      ...prepared.manifest,
      formatVersion: prepared.manifest.formatVersion + 1,
    };

    await expect(
      repository.publishGeneration(prepared.ready, unsupported as typeof prepared.manifest),
    ).rejects.toThrow(/unsupported/i);
    expect(await repository.getActiveManifest()).toBeUndefined();
    await repository.close();
  });

  it("detects a corrupted chunk payload when its range is requested", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const prepared = preparedGeneration("corrupt-chunk", 60n);
    await repository.createGeneration(prepared.candidate);
    await repository.putChunk(prepared.chunk);
    await repository.publishGeneration(prepared.ready, prepared.manifest);

    const corruptedPayload = new Uint8Array(prepared.chunk.payload.slice(0));
    corruptedPayload[corruptedPayload.length - 1] ^= 0xff;
    await repository.database.put("chunks", {
      ...prepared.chunk,
      payload: corruptedPayload.buffer,
    });

    await expect(
      queryActiveRange(
        repository,
        {
          datasetId: prepared.ready.generationId,
          generationId: prepared.ready.generationId,
          viewId: "test",
          requestId: "corrupt-request",
          rangeRevision: 0,
        },
        { startInstantNs: 60n, endInstantNs: 60n },
        100,
        { offset: 0, limit: 50 },
      ),
    ).rejects.toThrow(/corrupt|checksum/i);
    await repository.close();
  });

  it("closes an outdated connection so a schema upgrade from another tab is never blocked", async () => {
    const repository = await IndexedDbChunkRepository.open();

    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION + 1);
      request.onupgradeneeded = () => undefined;
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("schema upgrade was blocked"));
    });

    upgraded.close();
    await repository.close();
  });
});
