/// <reference lib="webworker" />

import {
  INDEX_FORMAT_VERSION,
  MAX_STAGING_RUN_ROWS,
  emptyValidationCounts,
  type CandidateSourceGeneration,
  type NormalizedReading,
  type RangeCorrelation,
  type ReadySourceGeneration,
  type Retention,
  type ValidationCounts,
  type WorkerError,
} from "../domain/readings";
import { normalizeRawRecord } from "../domain/validation";
import type { OnDemandWorkerCommand, WorkerCommand, WorkerEvent } from "../shared/worker-messages";
import { buildCompactDataset, type CompactDataset } from "./compact-store";
import { parseGoogleFitStream } from "./parser-adapter";
import { parseGoogleFitSource } from "./parser-adapter";
import {
  queryActiveRange,
  queryNearest,
  queryRange,
  queryReadingPage,
  warmChunkRange,
} from "./queries";
import { createGenerationManifest } from "./chunk-manifest";
import type { ChunkRepository } from "./chunk-repository";
import { ChunkLru } from "./chunk-lru";
import { createStagingRuns, mergeStagingRuns, type SortableReading } from "./external-sort";
import { IndexedDbChunkRepository } from "./indexeddb-repository";
import { VolatileChunkRepository } from "./volatile-repository";

const datasets = new Map<string, CompactDataset>();
const imports = new Map<string, AbortController>();
const indexOperations = new Map<string, AbortController>();
let persistentRepository: IndexedDbChunkRepository | undefined;
let volatileRepository: VolatileChunkRepository | undefined;
let activeRepository: ChunkRepository | undefined;
let activeGeneration:
  { readonly repository: ChunkRepository; readonly generationId: string } | undefined;
const chunkCache = new ChunkLru();
let foregroundRange:
  | {
      readonly controller: AbortController;
      readonly correlation: Extract<WorkerCommand, { type: "range.load" }>["correlation"];
      reason: "superseded" | "unmounted" | "user";
    }
  | undefined;
let backgroundPrefetch:
  { readonly controller: AbortController; readonly correlation: RangeCorrelation } | undefined;

const post = (event: WorkerEvent, transfer: Transferable[] = []): void => {
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(event, transfer);
};

export async function importFile(
  file: File,
  acceptedRecordLimit: number,
  signal: AbortSignal,
  onProgress?: (processedRecords: number, counts: ValidationCounts) => void,
): Promise<{ readonly dataset: CompactDataset; readonly counts: ValidationCounts }> {
  const counts = { ...emptyValidationCounts() };
  const readings: NormalizedReading[] = [];
  let processedRecords = 0;
  let lastProgress = 0;
  await parseGoogleFitStream(
    file.stream(),
    (rawRecord) => {
      const result = normalizeRawRecord(rawRecord);
      processedRecords += 1;
      if (result.category === "accepted") {
        readings.push({ ...result.reading, sourceOrder: processedRecords - 1 });
        if (readings.length > acceptedRecordLimit) throw new Error("record-limit");
      } else counts[result.category] += 1;
      if (processedRecords % 8192 === 0) {
        const now = performance.now();
        if (now - lastProgress >= 250) {
          onProgress?.(processedRecords, { ...counts, accepted: readings.length });
          lastProgress = now;
        }
      }
    },
    signal,
  );
  if (signal.aborted) throw new DOMException("Import cancelled", "AbortError");
  onProgress?.(processedRecords, { ...counts, accepted: readings.length });
  const built = buildCompactDataset(readings);
  counts.duplicate += built.duplicateCount;
  counts.accepted = built.dataset.timestamps.length;
  if (counts.accepted === 0) throw new Error("no-valid-readings");
  const dataset = { ...built.dataset, counts: Object.freeze({ ...counts }) };
  datasets.set(dataset.datasetId, dataset);
  return { dataset, counts: dataset.counts! };
}

async function handleImport(
  command: Extract<WorkerCommand, { type: "import.start" }>,
): Promise<void> {
  const controller = new AbortController();
  imports.set(command.sessionId, controller);
  try {
    const { dataset, counts } = await importFile(
      command.file,
      command.acceptedRecordLimit,
      controller.signal,
      (processedRecords, provisionalCounts) =>
        post({
          type: "import.progress",
          requestId: command.requestId,
          sessionId: command.sessionId,
          bytesRead: Math.min(
            command.file.size,
            command.file.size * (processedRecords / Math.max(1, processedRecords + 1)),
          ),
          totalBytes: command.file.size,
          processedRecords,
          provisionalCounts,
        }),
    );
    post({
      type: "import.ready",
      requestId: command.requestId,
      sessionId: command.sessionId,
      datasetId: dataset.datasetId,
      counts,
      fullRange: {
        startMs: dataset.timestamps[0]!,
        endMs: dataset.timestamps[dataset.timestamps.length - 1]!,
        revision: 0,
        origin: "reset",
      },
      sourceNames: dataset.sourceDictionary,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      post({
        type: "import.cancelled",
        requestId: command.requestId,
        sessionId: command.sessionId,
      });
    } else {
      const message = error instanceof Error ? error.message : "worker-failed";
      const code = message.includes("record-limit")
        ? "record-limit"
        : message.includes("unsupported-schema")
          ? "unsupported-schema"
          : message.includes("no-valid-readings")
            ? "no-valid-readings"
            : message.includes("invalid-json")
              ? "invalid-json"
              : "worker-failed";
      post({
        type: "import.failed",
        requestId: command.requestId,
        sessionId: command.sessionId,
        code,
        message: safeImportMessage(code),
      });
    }
  } finally {
    imports.delete(command.sessionId);
  }
}

async function repositoryFor(retention: Retention): Promise<ChunkRepository> {
  if (retention === "session") {
    volatileRepository ??= new VolatileChunkRepository();
    return volatileRepository;
  }
  persistentRepository ??= await IndexedDbChunkRepository.open();
  return persistentRepository;
}

async function handleIndexStart(
  command: Extract<WorkerCommand, { type: "index.start" }>,
): Promise<void> {
  const controller = new AbortController();
  indexOperations.get(command.generationId)?.abort();
  indexOperations.set(command.generationId, controller);
  const previousActiveGeneration = activeGeneration;
  let repository: ChunkRepository | undefined;
  try {
    repository = await repositoryFor(command.retention);
    const startedAt = Date.now();
    const initial: CandidateSourceGeneration = {
      generationId: command.generationId,
      sourceDigest: null,
      fileName: command.file.name,
      fileSize: command.file.size,
      lastModified: command.file.lastModified,
      formatVersion: INDEX_FORMAT_VERSION,
      retention: command.retention,
      status: "indexing",
      startedAt,
      completedAt: null,
      acceptedCount: 0,
      duplicateCount: 0,
      validationCounts: emptyValidationCounts(),
      minimumInstantNs: null,
      maximumInstantNs: null,
      chunkCount: 0,
    };
    await repository.createGeneration(initial, controller.signal);

    const counts = { ...emptyValidationCounts() };
    const pendingRows: SortableReading[] = [];
    const runWrites: Promise<void>[] = [];
    let processedRecords = 0;
    let runId = 0;
    const flushRun = () => {
      if (pendingRows.length === 0) return;
      const [run] = createStagingRuns(
        command.generationId,
        pendingRows.splice(0),
        MAX_STAGING_RUN_ROWS,
      );
      const persisted = { ...run!, runId: runId++ };
      runWrites.push(repository!.putStagingRun(persisted, controller.signal));
    };
    const parsed = await parseGoogleFitSource(
      command.file,
      (rawRecord) => {
        controller.signal.throwIfAborted();
        const result = normalizeRawRecord(rawRecord);
        processedRecords += 1;
        if (result.category === "accepted") {
          pendingRows.push({
            instantNs: result.reading.instantNs!,
            endInstantNs: result.reading.endInstantNs!,
            bpm: result.reading.bpm,
            source: result.reading.sourceId,
            sourceOrder: processedRecords - 1,
          });
          if (pendingRows.length === MAX_STAGING_RUN_ROWS) flushRun();
        } else counts[result.category] += 1;
        if (processedRecords % 8192 === 0) {
          post({
            type: "index.progress",
            datasetId: command.datasetId,
            generationId: command.generationId,
            requestId: command.requestId,
            phase: "reading",
            processedBytes: 0,
            totalBytes: command.file.size,
            processedRecords,
          });
        }
      },
      controller.signal,
    );
    flushRun();
    await Promise.all(runWrites);
    controller.signal.throwIfAborted();
    if (runId === 0) throw new Error("no-valid-readings");
    post({
      type: "index.progress",
      datasetId: command.datasetId,
      generationId: command.generationId,
      requestId: command.requestId,
      phase: "sorting",
      processedBytes: parsed.bytesRead,
      totalBytes: command.file.size,
      processedRecords,
    });

    const runs = await repository.listStagingRuns(command.generationId, controller.signal);
    post({
      type: "index.progress",
      datasetId: command.datasetId,
      generationId: command.generationId,
      requestId: command.requestId,
      phase: "merging",
      processedBytes: parsed.bytesRead,
      totalBytes: command.file.size,
      processedRecords,
    });
    const merged = mergeStagingRuns(command.generationId, runs);
    counts.duplicate += merged.duplicateCount;
    counts.accepted = merged.acceptedCount;
    for (const chunk of merged.chunks) {
      controller.signal.throwIfAborted();
      await repository.putChunk(chunk, controller.signal);
    }
    const finalizing: CandidateSourceGeneration = {
      ...initial,
      sourceDigest: parsed.sourceDigest,
      status: "finalizing",
      acceptedCount: merged.acceptedCount,
      duplicateCount: merged.duplicateCount,
      validationCounts: Object.freeze({ ...counts }),
      minimumInstantNs: merged.chunks[0]?.minimumInstantNs ?? null,
      maximumInstantNs: merged.chunks.at(-1)?.maximumInstantNs ?? null,
      chunkCount: merged.chunks.length,
    };
    await repository.updateGeneration(finalizing, controller.signal);
    const manifest = createGenerationManifest({
      generationId: command.generationId,
      formatVersion: INDEX_FORMAT_VERSION,
      chunks: merged.chunks,
      acceptedCount: merged.acceptedCount,
      validationCounts: finalizing.validationCounts,
      sourceTable: merged.sourceTable,
    });
    const ready: ReadySourceGeneration = {
      ...finalizing,
      sourceDigest: parsed.sourceDigest,
      status: "ready",
      completedAt: Date.now(),
    };
    post({
      type: "index.progress",
      datasetId: command.datasetId,
      generationId: command.generationId,
      requestId: command.requestId,
      phase: "publishing",
      processedBytes: parsed.bytesRead,
      totalBytes: command.file.size,
      processedRecords,
    });
    await repository.publishGeneration(ready, manifest, controller.signal);
    activeRepository = repository;
    activeGeneration = { repository, generationId: command.generationId };
    post({
      type: "index.ready",
      datasetId: command.datasetId,
      generationId: command.generationId,
      requestId: command.requestId,
      generation: ready,
      historyExtent:
        ready.minimumInstantNs === null
          ? null
          : {
              startInstantNs: ready.minimumInstantNs,
              endInstantNs: ready.maximumInstantNs!,
            },
      retention: command.retention,
    });
    post({
      type: "index.progress",
      datasetId: command.datasetId,
      generationId: command.generationId,
      requestId: command.requestId,
      phase: "cleaning",
      processedBytes: parsed.bytesRead,
      totalBytes: command.file.size,
      processedRecords,
    });
    if (
      previousActiveGeneration &&
      previousActiveGeneration.generationId !== command.generationId
    ) {
      try {
        await previousActiveGeneration.repository.discardGeneration(
          previousActiveGeneration.generationId,
        );
      } catch {
        // Best-effort retirement; a stale ready generation is picked up by later cleanup passes.
      }
      chunkCache.invalidateGeneration(previousActiveGeneration.generationId);
    }
    await repository.cleanupAbandonedGenerations(4, controller.signal);
  } catch (error) {
    const cancelled =
      controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError");
    if (repository) {
      try {
        await repository.discardGeneration(command.generationId);
      } catch {
        // Publication may have completed before cancellation was observed.
      }
    }
    if (cancelled) {
      post({
        type: "index.cancelled",
        datasetId: command.datasetId,
        generationId: command.generationId,
        requestId: command.requestId,
        cleanupPending: false,
      });
    } else {
      const previous = await activeRepository?.getActiveManifest().catch(() => undefined);
      post({
        type: "index.failed",
        datasetId: command.datasetId,
        generationId: command.generationId,
        requestId: command.requestId,
        error: indexError(error),
        previousActiveGeneration: previous?.generation,
      });
    }
  } finally {
    indexOperations.delete(command.generationId);
  }
}

async function handleOpenActive(command: Extract<WorkerCommand, { type: "index.open-active" }>) {
  try {
    const repository = await repositoryFor("persistent");
    const active = await repository.getActiveManifest();
    if (!active) {
      post({ type: "index.unavailable", requestId: command.requestId });
      return;
    }
    activeRepository = repository;
    activeGeneration = { repository, generationId: active.generation.generationId };
    post({
      type: "index.ready",
      datasetId: active.generation.generationId,
      generationId: active.generation.generationId,
      requestId: command.requestId,
      generation: active.generation,
      historyExtent:
        active.generation.minimumInstantNs === null
          ? null
          : {
              startInstantNs: active.generation.minimumInstantNs,
              endInstantNs: active.generation.maximumInstantNs!,
            },
      retention: "persistent",
    });
    void repository.cleanupAbandonedGenerations(4).catch(() => undefined);
  } catch (error) {
    post({ type: "index.unavailable", requestId: command.requestId, error: indexError(error) });
  }
}

async function handleRangeLoad(command: Extract<WorkerCommand, { type: "range.load" }>) {
  if (!activeRepository) {
    post({
      type: "range.failed",
      correlation: command.correlation,
      error: indexError(new Error("No active index is available")),
    });
    return;
  }
  const controller = new AbortController();
  const operation = { controller, correlation: command.correlation, reason: "superseded" as const };
  foregroundRange = operation;
  try {
    const snapshot = await queryActiveRange(
      activeRepository,
      command.correlation,
      command.range,
      command.displayBudget,
      command.page,
      controller.signal,
      (partial) => {
        post({
          type: "range.progress",
          correlation: command.correlation,
          requestedRange: command.range,
          coveredIntervals: partial.coveredIntervals,
          progress: partial.progress,
        });
        postRangeSnapshot(command.correlation, partial);
      },
      (selectedChunkCount) =>
        post({
          type: "range.started",
          correlation: command.correlation,
          requestedRange: command.range,
          selectedChunkCount,
        }),
      chunkCache,
    );
    postRangeSnapshot(command.correlation, snapshot);
  } catch (error) {
    if (controller.signal.aborted) {
      post({ type: "range.cancelled", correlation: command.correlation, reason: operation.reason });
    } else {
      post({ type: "range.failed", correlation: command.correlation, error: indexError(error) });
    }
  } finally {
    if (foregroundRange === operation) foregroundRange = undefined;
  }
}

async function handleRangePrefetch(
  command: Extract<WorkerCommand, { type: "range.prefetch" }>,
): Promise<void> {
  backgroundPrefetch?.controller.abort();
  if (foregroundRange || !activeRepository) return;
  const controller = new AbortController();
  const operation = { controller, correlation: command.correlation };
  backgroundPrefetch = operation;
  let warmedChunkCount = 0;
  let warmedBytes = 0;
  try {
    const active = await activeRepository.getActiveManifest(controller.signal);
    if (active && active.generation.generationId === command.correlation.generationId) {
      const result = await warmChunkRange(
        activeRepository,
        command.correlation.generationId,
        active.manifest,
        command.range,
        chunkCache,
        controller.signal,
        () => Boolean(foregroundRange),
      );
      warmedChunkCount = result.warmedChunkCount;
      warmedBytes = result.warmedBytes;
    }
  } catch {
    // Background read-ahead failures are isolated; the foreground range is unaffected.
  } finally {
    if (backgroundPrefetch === operation) backgroundPrefetch = undefined;
    post({
      type: "range.prefetched",
      correlation: command.correlation,
      direction: command.direction,
      warmedChunkCount,
      warmedBytes,
    });
  }
}

function postRangeSnapshot(
  correlation: Extract<WorkerCommand, { type: "range.load" }>["correlation"],
  snapshot: Awaited<ReturnType<typeof queryActiveRange>>,
): void {
  post({ type: "range.snapshot", correlation, snapshot }, [
    snapshot.displaySeries.timestamps.buffer,
    snapshot.displaySeries.bpmValues.buffer,
    snapshot.displaySeries.sourceIndexes.buffer,
    snapshot.displaySeries.gapBefore.buffer,
  ]);
}

function cancelForeground(
  reason: "superseded" | "unmounted" | "user",
  correlation?: Extract<WorkerCommand, { type: "range.load" }>["correlation"],
): void {
  if (!foregroundRange) return;
  if (correlation && !sameCorrelation(foregroundRange.correlation, correlation)) return;
  foregroundRange.reason = reason;
  foregroundRange.controller.abort();
}

function sameCorrelation(
  left: Extract<WorkerCommand, { type: "range.load" }>["correlation"],
  right: Extract<WorkerCommand, { type: "range.load" }>["correlation"],
): boolean {
  return (
    left.datasetId === right.datasetId &&
    left.generationId === right.generationId &&
    left.viewId === right.viewId &&
    left.requestId === right.requestId &&
    left.rangeRevision === right.rangeRevision
  );
}

function indexError(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "QuotaExceededError") {
    return {
      code: "quota-exceeded" as const,
      message: "Local storage is full. You can retry or use the index for this session.",
      recoverable: true,
      actions: ["retry", "use-session-storage"] as const,
    };
  }
  if (message === "no-valid-readings") {
    return {
      code: "source-invalid" as const,
      message: "No valid heart-rate readings were found.",
      recoverable: true,
      actions: ["select-source"] as const,
    };
  }
  return {
    code: "unexpected" as const,
    message: "The local heart-rate index could not be completed.",
    recoverable: true,
    actions: ["retry", "use-session-storage", "clear-data"] as const,
  };
}

function safeImportMessage(code: string): string {
  const messages: Record<string, string> = {
    "record-limit": "The file contains more than 1,000,000 supported readings.",
    "unsupported-schema": "The file does not contain a supported Data Points array.",
    "no-valid-readings": "No valid heart-rate readings were found.",
    "invalid-json": "The selected file is not valid JSON.",
  };
  return messages[code] ?? "The file could not be imported.";
}

async function handleClear(
  command: Extract<WorkerCommand, { type: "index.clear" }>,
): Promise<void> {
  foregroundRange?.controller.abort();
  backgroundPrefetch?.controller.abort();
  const previousActiveGeneration = activeGeneration;
  const previousPersistentRepository = persistentRepository;
  try {
    await persistentRepository?.clear();
    await volatileRepository?.clear();
    await volatileRepository?.close();
    chunkCache.clear();
    activeRepository = undefined;
    activeGeneration = undefined;
    persistentRepository = undefined;
    volatileRepository = undefined;
    post({ type: "index.cleared", requestId: command.requestId });
  } catch (error) {
    if (previousPersistentRepository) {
      persistentRepository = await IndexedDbChunkRepository.open().catch(() => undefined);
      const active = await persistentRepository?.getActiveManifest().catch(() => undefined);
      if (persistentRepository && active) {
        activeRepository = persistentRepository;
        activeGeneration = {
          repository: persistentRepository,
          generationId: active.generation.generationId,
        };
      } else if (previousActiveGeneration?.repository.retention === "session") {
        activeRepository = previousActiveGeneration.repository;
        activeGeneration = previousActiveGeneration;
      }
    }
    post({ type: "index.clear-failed", requestId: command.requestId, error: clearError(error) });
  }
}

function clearError(error: unknown): WorkerError {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "ClearBlockedError") {
    return {
      code: "clear-blocked" as const,
      message: "Retained data could not be deleted because another tab is still using it.",
      recoverable: true,
      actions: ["retry"] as const,
    };
  }
  return {
    code: "unexpected" as const,
    message: "Retained data could not be deleted.",
    recoverable: true,
    actions: ["retry"] as const,
  };
}

export function handleWorkerCommand(command: WorkerCommand): void {
  if (command.type === "index.start") {
    void handleIndexStart(command);
    return;
  }
  if (command.type === "index.cancel") {
    indexOperations.get(command.generationId)?.abort();
    return;
  }
  if (command.type === "index.open-active") {
    void handleOpenActive(command);
    return;
  }
  if (command.type === "index.clear") {
    void handleClear(command);
    return;
  }
  if (command.type === "range.load") {
    cancelForeground("superseded");
    backgroundPrefetch?.controller.abort();
    void handleRangeLoad(command);
    return;
  }
  if (command.type === "range.cancel") {
    cancelForeground(command.reason, command.correlation);
    if (
      backgroundPrefetch &&
      sameCorrelation(backgroundPrefetch.correlation, command.correlation)
    ) {
      backgroundPrefetch.controller.abort();
    }
    return;
  }
  if (command.type === "range.prefetch") {
    void handleRangePrefetch(command);
    return;
  }
  if (isOnDemandWorkerCommand(command)) return;
  if (command.type === "import.start") {
    void handleImport(command);
    return;
  }
  if (command.type === "import.cancel") {
    imports.get(command.sessionId)?.abort();
    return;
  }
  const dataset = datasets.get(command.datasetId);
  if (command.type === "dataset.dispose") {
    datasets.delete(command.datasetId);
    return;
  }
  if (!dataset) {
    post({
      type: "request.failed",
      requestId: command.requestId,
      datasetId: command.datasetId,
      code: "dataset-not-found",
      message: "The dataset is no longer available.",
    });
    return;
  }
  if (command.type === "range.query") {
    const result = queryRange(dataset, command.startMs, command.endMs, command.chartWidthCssPx);
    const event: WorkerEvent = {
      type: "range.result",
      requestId: command.requestId,
      datasetId: command.datasetId,
      revision: command.revision,
      ...result,
    };
    post(event, [
      result.series.timestamps.buffer,
      result.series.bpmValues.buffer,
      result.series.sourceIndexes.buffer,
      result.series.gapBefore.buffer,
    ]);
  } else if (command.type === "reading.page") {
    post({
      type: "reading.page.result",
      requestId: command.requestId,
      datasetId: command.datasetId,
      revision: command.revision,
      result: queryReadingPage(
        dataset,
        command.revision,
        command.startMs,
        command.endMs,
        command.page,
        command.pageSize,
      ),
    });
  } else {
    post({
      type: "reading.nearest.result",
      requestId: command.requestId,
      datasetId: command.datasetId,
      revision: command.revision,
      reading: queryNearest(dataset, command.instantMs, command.direction),
    });
  }
}

function isOnDemandWorkerCommand(command: WorkerCommand): command is OnDemandWorkerCommand {
  return (
    command.type.startsWith("index.") ||
    command.type === "range.load" ||
    command.type === "range.cancel" ||
    command.type === "range.prefetch"
  );
}

if (typeof self !== "undefined" && "postMessage" in self) {
  (self as unknown as DedicatedWorkerGlobalScope).onmessage = (
    event: MessageEvent<WorkerCommand>,
  ) => handleWorkerCommand(event.data);
}
