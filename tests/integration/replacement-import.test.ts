import { describe, expect, it, vi } from "vitest";
import {
  emptyValidationCounts,
  type CandidateSourceGeneration,
  type RangeCorrelation,
  type ReadingChunk,
  type ReadySourceGeneration,
} from "../../src/domain/readings";
import { encodeReadingChunk } from "../../src/worker/chunk-codec";
import { createGenerationManifest } from "../../src/worker/chunk-manifest";
import { IndexedDbChunkRepository } from "../../src/worker/indexeddb-repository";
import { VolatileChunkRepository } from "../../src/worker/volatile-repository";
import type { WorkerCommand, WorkerEvent } from "../../src/shared/worker-messages";
import { WorkerClient } from "../../src/worker/worker-client";

class FakeWorker {
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null;
  onerror: OnErrorEventHandler = null;
  postMessage = vi.fn<(message: WorkerCommand) => void>();
  terminate = vi.fn();
  emit(data: WorkerEvent) {
    this.onmessage?.({ data } as MessageEvent<WorkerEvent>);
  }
}

function readyGeneration(
  generationId: string,
  sourceDigest: string,
  retention: "persistent" | "session" = "persistent",
): ReadySourceGeneration {
  return {
    generationId,
    sourceDigest,
    fileName: `${generationId}.json`,
    fileSize: 1,
    lastModified: 1,
    formatVersion: 1,
    retention,
    status: "ready",
    startedAt: 1,
    completedAt: 2,
    acceptedCount: 1,
    duplicateCount: 0,
    validationCounts: { ...emptyValidationCounts(), accepted: 1 },
    minimumInstantNs: 10n,
    maximumInstantNs: 10n,
    chunkCount: 1,
  };
}

function loadCommand(
  correlation: RangeCorrelation,
): Extract<WorkerCommand, { type: "range.load" }> {
  return {
    type: "range.load",
    correlation,
    range: { startInstantNs: 0n, endInstantNs: 10n },
    displayBudget: 100,
    page: { offset: 0, limit: 25 },
  };
}

function rangeStarted(correlation: RangeCorrelation): WorkerEvent {
  return {
    type: "range.started",
    correlation,
    requestedRange: { startInstantNs: 0n, endInstantNs: 10n },
    selectedChunkCount: 1,
  };
}

function preparedGeneration(
  generationId: string,
  instantNs: bigint,
  sourceDigest: string,
  retention: "persistent" | "session",
) {
  const encoded = encodeReadingChunk([
    {
      instantNs,
      endInstantNs: instantNs,
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
    sourceDigest,
    fileName: `${generationId}.json`,
    fileSize: 100,
    lastModified: 10,
    formatVersion: 1,
    retention,
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
    sourceDigest,
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

describe("replacement imports", () => {
  it("keeps the active worker on failure and atomically disposes it after success", () => {
    const workers: FakeWorker[] = [];
    const client = new WorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker as unknown as Worker;
    });
    const events: WorkerEvent[] = [];
    client.subscribe((event) => events.push(event));
    const firstRequest = client.startImport(new File(["{}"], "first.json"), "one");
    workers[0]!.emit({
      type: "import.ready",
      requestId: firstRequest,
      sessionId: "one",
      datasetId: "first",
      counts: emptyValidationCounts(),
      fullRange: { startMs: 1, endMs: 2, revision: 0, origin: "reset" },
      sourceNames: [],
    });
    const failedRequest = client.startImport(new File(["{"], "bad.json"), "two");
    workers[1]!.emit({
      type: "import.failed",
      requestId: failedRequest,
      sessionId: "two",
      code: "invalid-json",
      message: "bad",
    });
    expect(workers[0]!.terminate).not.toHaveBeenCalled();
    const thirdRequest = client.startImport(new File(["{}"], "third.json"), "three");
    workers[2]!.emit({
      type: "import.ready",
      requestId: thirdRequest,
      sessionId: "three",
      datasetId: "third",
      counts: emptyValidationCounts(),
      fullRange: { startMs: 3, endMs: 4, revision: 0, origin: "reset" },
      sourceNames: [],
    });
    expect(workers[0]!.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: "dataset.dispose", datasetId: "first" }),
    );
    expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(events.at(-1)).toMatchObject({ type: "import.ready", datasetId: "third" });
  });

  it("keeps the active generation authoritative when replacement indexing fails or is cancelled", () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker as unknown as Worker);
    const events: WorkerEvent[] = [];
    client.subscribe((event) => events.push(event));

    const openRequestId = client.openActive();
    worker.emit({
      type: "index.ready",
      requestId: openRequestId,
      datasetId: "active-dataset",
      generationId: "active-generation",
      generation: readyGeneration("active-generation", "ab".repeat(32)),
      historyExtent: null,
      retention: "persistent",
    });

    const activeCorrelation: RangeCorrelation = {
      datasetId: "active-dataset",
      generationId: "active-generation",
      viewId: "primary",
      requestId: "active-range",
      rangeRevision: 1,
    };
    client.loadRange(loadCommand(activeCorrelation));
    events.length = 0;

    const failed = client.startIndex(new File(["{}"], "replacement-a.json"), "persistent");
    worker.emit({
      type: "index.failed",
      ...failed,
      error: {
        code: "unexpected",
        message: "Replacement failed.",
        recoverable: true,
        actions: ["retry", "clear-data"],
      },
      previousActiveGeneration: readyGeneration("active-generation", "ab".repeat(32)),
    });
    worker.emit(rangeStarted(activeCorrelation));

    const cancelled = client.startIndex(new File(["{}"], "replacement-b.json"), "persistent");
    worker.emit({
      type: "index.cancelled",
      ...cancelled,
      cleanupPending: false,
    });
    worker.emit(rangeStarted(activeCorrelation));

    expect(events.map((event) => event.type)).toEqual([
      "index.failed",
      "range.started",
      "index.cancelled",
      "range.started",
    ]);
  });

  it("rejects stale generation range events after a successful replacement switch", () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker as unknown as Worker);
    const events: WorkerEvent[] = [];
    client.subscribe((event) => events.push(event));

    const openRequestId = client.openActive();
    worker.emit({
      type: "index.ready",
      requestId: openRequestId,
      datasetId: "active-dataset",
      generationId: "active-generation",
      generation: readyGeneration("active-generation", "ab".repeat(32)),
      historyExtent: null,
      retention: "persistent",
    });

    const replacement = client.startIndex(new File(["{}"], "replacement.json"), "persistent");
    worker.emit({
      type: "index.ready",
      ...replacement,
      generation: readyGeneration(replacement.generationId, "cd".repeat(32)),
      historyExtent: null,
      retention: "persistent",
    });
    events.length = 0;

    const nextCorrelation: RangeCorrelation = {
      datasetId: replacement.datasetId,
      generationId: replacement.generationId,
      viewId: "primary",
      requestId: "replacement-range",
      rangeRevision: 2,
    };
    client.loadRange(loadCommand(nextCorrelation));
    worker.emit(
      rangeStarted({
        ...nextCorrelation,
        datasetId: "active-dataset",
        generationId: "active-generation",
      }),
    );
    worker.emit(rangeStarted(nextCorrelation));

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "range.started", correlation: nextCorrelation });
  });

  it("acknowledges clear success and surfaces blocked clear failures", () => {
    const worker = new FakeWorker();
    const client = new WorkerClient(() => worker as unknown as Worker);
    const events: WorkerEvent[] = [];
    client.subscribe((event) => events.push(event));

    const openRequestId = client.openActive();
    worker.emit({
      type: "index.ready",
      requestId: openRequestId,
      datasetId: "active-dataset",
      generationId: "active-generation",
      generation: readyGeneration("active-generation", "ab".repeat(32)),
      historyExtent: null,
      retention: "persistent",
    });
    events.length = 0;

    const clearRequest = client.clear();
    worker.emit({ type: "index.cleared", requestId: clearRequest });
    const blockedClearRequest = client.clear();
    worker.emit({
      type: "index.clear-failed",
      requestId: blockedClearRequest,
      error: {
        code: "clear-blocked",
        message: "Retained data could not be deleted because another tab is still using it.",
        recoverable: true,
        actions: ["retry"],
      },
    });

    expect(events.map((event) => event.type)).toEqual(["index.cleared", "index.clear-failed"]);
    expect(events[1]).toMatchObject({
      type: "index.clear-failed",
      error: { code: "clear-blocked" },
    });
  });
});

describe("retained generation storage", () => {
  it("evicts stale ready generations and abandoned startup garbage when reopened", async () => {
    const repository = await IndexedDbChunkRepository.open();
    const first = preparedGeneration("first", 10n, "ab".repeat(32), "persistent");
    const replacement = preparedGeneration("replacement", 20n, "cd".repeat(32), "persistent");
    const abandoned = preparedGeneration("abandoned", 30n, "ef".repeat(32), "persistent");

    await repository.createGeneration(first.candidate);
    await repository.putChunk(first.chunk);
    await repository.publishGeneration(first.ready, first.manifest);

    await repository.createGeneration(replacement.candidate);
    await repository.putChunk(replacement.chunk);
    await repository.publishGeneration(replacement.ready, replacement.manifest);

    await repository.createGeneration({
      ...abandoned.candidate,
      sourceDigest: null,
      status: "failed",
    });
    await repository.close();

    const reopened = await IndexedDbChunkRepository.open();
    expect((await reopened.getActiveManifest())?.generation.generationId).toBe("replacement");
    expect(await reopened.getGeneration("first")).toBeUndefined();
    expect(await reopened.getGeneration("abandoned")).toBeUndefined();
    await reopened.close();
  });

  it("removes persistent data on clear and session data when the volatile repository closes", async () => {
    const persistent = await IndexedDbChunkRepository.open();
    const durable = preparedGeneration("durable", 40n, "aa".repeat(32), "persistent");
    await persistent.createGeneration(durable.candidate);
    await persistent.putChunk(durable.chunk);
    await persistent.publishGeneration(durable.ready, durable.manifest);
    await persistent.clear();

    const reopened = await IndexedDbChunkRepository.open();
    expect(await reopened.getActiveManifest()).toBeUndefined();
    await reopened.close();

    const volatile = new VolatileChunkRepository();
    const sessionOnly = preparedGeneration("session", 50n, "bb".repeat(32), "session");
    await volatile.createGeneration(sessionOnly.candidate);
    await volatile.putChunk(sessionOnly.chunk);
    await volatile.publishGeneration(sessionOnly.ready, sessionOnly.manifest);
    await volatile.close();

    await expect(volatile.getActiveManifest()).rejects.toThrow(/closed/i);
  });
});
