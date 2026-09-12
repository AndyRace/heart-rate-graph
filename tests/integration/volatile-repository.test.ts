import { describe, expect, it } from "vitest";
import {
  emptyValidationCounts,
  type CandidateSourceGeneration,
  type ReadingChunk,
  type ReadySourceGeneration,
} from "../../src/domain/readings";
import { encodeReadingChunk } from "../../src/worker/chunk-codec";
import { createGenerationManifest } from "../../src/worker/chunk-manifest";
import { VolatileChunkRepository } from "../../src/worker/volatile-repository";

function preparedGeneration(generationId: string, instantNs: bigint) {
  const encoded = encodeReadingChunk([
    { instantNs, bpm: 72, sourceId: 0, sourceOrder: 0 },
    { instantNs: instantNs + 1n, bpm: 73, sourceId: 0, sourceOrder: 1 },
  ]);
  const chunk: ReadingChunk = {
    generationId,
    chunkId: 0,
    rowCount: 2,
    byteLength: encoded.payload.byteLength,
    minimumInstantNs: instantNs,
    maximumInstantNs: instantNs + 1n,
    firstSourceOrder: 0,
    lastSourceOrder: 1,
    checksum: encoded.checksum,
    payload: encoded.payload,
  };
  const validationCounts = { ...emptyValidationCounts(), accepted: 2 };
  const candidate: CandidateSourceGeneration = {
    generationId,
    sourceDigest: "ab".repeat(32),
    fileName: `${generationId}.json`,
    fileSize: 100,
    lastModified: 10,
    formatVersion: 1,
    retention: "session",
    status: "finalizing",
    startedAt: 1,
    completedAt: null,
    acceptedCount: 2,
    duplicateCount: 0,
    validationCounts,
    minimumInstantNs: instantNs,
    maximumInstantNs: instantNs + 1n,
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
    acceptedCount: 2,
    validationCounts,
    sourceTable: ["watch"],
  });
  return { candidate, ready, chunk, manifest };
}

describe("volatile chunk repository", () => {
  it("reports session retention and never accepts a durable generation", async () => {
    const repository = new VolatileChunkRepository();
    const prepared = preparedGeneration("candidate", 10n);
    expect(repository.retention).toBe("session");
    await expect(
      repository.createGeneration({ ...prepared.candidate, retention: "persistent" }),
    ).rejects.toThrow(/session/i);
    expect(await repository.getGeneration("candidate")).toBeUndefined();
  });

  it("keeps unpublished candidate chunks and staging runs out of the active view", async () => {
    const repository = new VolatileChunkRepository();
    const prepared = preparedGeneration("candidate", 10n);
    await repository.createGeneration(prepared.candidate);
    await repository.putStagingRun({
      generationId: "candidate",
      runId: 0,
      rowCount: 1,
      minimumInstantNs: 10n,
      maximumInstantNs: 10n,
      payload: new Uint8Array([1, 2, 3]).buffer,
    });
    await repository.putChunk(prepared.chunk);

    expect(await repository.getActiveManifest()).toBeUndefined();
    expect(await repository.listStagingRuns("candidate")).toHaveLength(1);
  });

  it("publishes atomically and preserves the prior active generation on failure", async () => {
    const repository = new VolatileChunkRepository();
    const first = preparedGeneration("first", 10n);
    await repository.createGeneration(first.candidate);
    await repository.putChunk(first.chunk);
    await repository.publishGeneration(first.ready, first.manifest);
    expect(await repository.getActiveManifest()).toMatchObject({
      generation: { generationId: "first", retention: "session", status: "ready" },
    });

    const replacement = preparedGeneration("replacement", 20n);
    await repository.createGeneration(replacement.candidate);
    await expect(
      repository.publishGeneration(replacement.ready, replacement.manifest),
    ).rejects.toThrow(/missing/i);
    expect((await repository.getActiveManifest())?.generation.generationId).toBe("first");
  });

  it("does not mutate state for an already cancelled operation", async () => {
    const repository = new VolatileChunkRepository();
    const controller = new AbortController();
    controller.abort();
    await expect(
      repository.createGeneration(
        preparedGeneration("cancelled", 10n).candidate,
        controller.signal,
      ),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(await repository.getGeneration("cancelled")).toBeUndefined();
  });

  it("clears all data on clear and becomes unavailable after close", async () => {
    const repository = new VolatileChunkRepository();
    const prepared = preparedGeneration("active", 10n);
    await repository.createGeneration(prepared.candidate);
    await repository.putChunk(prepared.chunk);
    await repository.publishGeneration(prepared.ready, prepared.manifest);
    await repository.clear();
    expect(await repository.getActiveManifest()).toBeUndefined();
    expect(await repository.getGeneration("active")).toBeUndefined();

    await repository.createGeneration(prepared.candidate);
    await repository.close();
    await expect(repository.getGeneration("active")).rejects.toThrow(/closed/i);
  });
});
