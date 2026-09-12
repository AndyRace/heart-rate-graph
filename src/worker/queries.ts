import { calculateVisibleSummary } from "../domain/summary";
import type {
  DisplaySeries,
  GenerationManifest,
  InclusiveInstantRange,
  RangeCorrelation,
  RangeSnapshot,
  ReadingPage,
  ReadingRow,
  VisibleSummary,
} from "../domain/readings";
import type { CompactDataset } from "./compact-store";
import { decodeReadingChunk } from "./chunk-codec";
import { selectChunkDescriptors } from "./chunk-manifest";
import type { ChunkRepository } from "./chunk-repository";
import { chunkColumnsByteWeight, type ChunkLru } from "./chunk-lru";

export const lowerBound = (values: ArrayLike<number>, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
};

export const upperBound = (values: ArrayLike<number>, target: number): number => {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
};

function representativeIndexes(
  dataset: CompactDataset,
  start: number,
  end: number,
  limit: number,
): number[] {
  const count = end - start;
  if (count <= limit) return Array.from({ length: count }, (_, index) => start + index);
  const bucketCount = Math.max(1, Math.floor(limit / 4));
  const bucketSize = Math.ceil(count / bucketCount);
  const indexes: number[] = [];
  for (let bucketStart = start; bucketStart < end; bucketStart += bucketSize) {
    const bucketEnd = Math.min(end, bucketStart + bucketSize);
    let minimum = bucketStart;
    let maximum = bucketStart;
    for (let index = bucketStart + 1; index < bucketEnd; index += 1) {
      if (dataset.bpmValues[index]! < dataset.bpmValues[minimum]!) minimum = index;
      if (dataset.bpmValues[index]! > dataset.bpmValues[maximum]!) maximum = index;
    }
    indexes.push(...new Set([bucketStart, minimum, maximum, bucketEnd - 1]));
  }
  return indexes.sort((left, right) => left - right);
}

export function queryRange(
  dataset: CompactDataset,
  startMs: number,
  endMs: number,
  chartWidthCssPx: number,
): { readonly series: DisplaySeries; readonly summary: VisibleSummary } {
  const start = lowerBound(dataset.timestamps, startMs);
  const end = upperBound(dataset.timestamps, endMs);
  const limit = Math.max(4, Math.floor(chartWidthCssPx) * 4);
  const indexes = representativeIndexes(dataset, start, end, limit);
  const mode = end - start <= limit ? "exact" : "aggregated";
  const gapBefore = Uint8Array.from(indexes, (sourceIndex, index) => {
    if (index === 0) return 0;
    const priorSourceIndex = indexes[index - 1]!;
    for (let exactIndex = priorSourceIndex + 1; exactIndex <= sourceIndex; exactIndex += 1) {
      if (dataset.timestamps[exactIndex]! - dataset.timestamps[exactIndex - 1]! > 1_800_000)
        return 1;
    }
    return 0;
  });
  return {
    series: {
      timestamps: Float64Array.from(indexes, (index) => dataset.timestamps[index]!),
      bpmValues: Float64Array.from(indexes, (index) => dataset.bpmValues[index]!),
      sourceIndexes: Uint32Array.from(indexes),
      gapBefore,
      mode,
      bucketDurationMs:
        mode === "aggregated"
          ? Math.ceil((endMs - startMs) / Math.max(1, Math.floor(limit / 4)))
          : undefined,
    },
    summary: calculateVisibleSummary(
      dataset.timestamps,
      dataset.bpmValues,
      startMs,
      endMs,
      start,
      end,
    ),
  };
}

const readingAt = (dataset: CompactDataset, index: number): ReadingRow => ({
  sourceIndex: index,
  instantMs: dataset.timestamps[index]!,
  endInstantMs: dataset.endTimestamps?.[index] ?? dataset.timestamps[index]!,
  bpm: dataset.bpmValues[index]!,
  source: dataset.sourceDictionary[dataset.sourceIds[index]!] ?? "",
});

export function queryReadingPage(
  dataset: CompactDataset,
  revision: number,
  startMs: number,
  endMs: number,
  page: number,
  pageSize: 25 | 50 | 100,
): ReadingPage {
  const start = lowerBound(dataset.timestamps, startMs);
  const end = upperBound(dataset.timestamps, endMs);
  const pageStart = start + (page - 1) * pageSize;
  const pageEnd = Math.min(end, pageStart + pageSize);
  return {
    rangeRevision: revision,
    page,
    pageSize,
    totalRows: end - start,
    rows: Array.from({ length: Math.max(0, pageEnd - pageStart) }, (_, index) =>
      readingAt(dataset, pageStart + index),
    ),
  };
}

export function queryNearest(
  dataset: CompactDataset,
  instantMs: number,
  direction: "nearest" | "previous" | "next",
): ReadingRow | undefined {
  const insertion = lowerBound(dataset.timestamps, instantMs);
  let index: number;
  if (direction === "previous")
    index = Math.min(
      dataset.timestamps.length - 1,
      insertion - (dataset.timestamps[insertion] === instantMs ? 1 : 0),
    );
  else if (direction === "next")
    index = insertion + (dataset.timestamps[insertion] === instantMs ? 1 : 0);
  else {
    const before = insertion - 1;
    index =
      before >= 0 &&
      (insertion >= dataset.timestamps.length ||
        instantMs - dataset.timestamps[before]! <= dataset.timestamps[insertion]! - instantMs)
        ? before
        : insertion;
  }
  return index >= 0 && index < dataset.timestamps.length ? readingAt(dataset, index) : undefined;
}

export async function queryActiveRange(
  repository: ChunkRepository,
  correlation: RangeCorrelation,
  range: InclusiveInstantRange,
  displayBudget: number,
  page: { readonly offset: number; readonly limit: number },
  signal?: AbortSignal,
  onSnapshot?: (snapshot: RangeSnapshot) => void,
  onStarted?: (selectedChunkCount: number) => void,
  cache?: ChunkLru,
): Promise<RangeSnapshot> {
  const startedAt = performance.now();
  const active = await repository.getActiveManifest(signal);
  if (!active || active.generation.generationId !== correlation.generationId) {
    throw new Error("The active generation is unavailable");
  }
  const descriptors = selectChunkDescriptors(active.manifest, range);
  const totalBytes = descriptors.reduce((sum, descriptor) => sum + descriptor.byteLength, 0);
  onStarted?.(descriptors.length);
  const readings: Array<{
    instantNs: bigint;
    endInstantNs: bigint;
    bpm: number;
    sourceId: number;
    sourceOrder: number;
  }> = [];
  let loadedBytes = 0;
  for (const [descriptorIndex, descriptor] of descriptors.entries()) {
    signal?.throwIfAborted();
    let decoded = cache?.get(correlation.generationId, descriptor.chunkId);
    if (decoded) {
      cache!.pin(correlation.generationId, descriptor.chunkId);
    } else {
      const chunk = await repository.readChunk(
        correlation.generationId,
        descriptor.chunkId,
        signal,
      );
      signal?.throwIfAborted();
      if (!chunk) throw new Error(`Active index is missing chunk ${descriptor.chunkId}`);
      // Checksum is validated inside decodeReadingChunk before anything is ever cached.
      decoded = decodeReadingChunk(chunk.payload, {
        checksum: descriptor.checksum,
        rowCount: descriptor.rowCount,
        sourceTableLength: active.manifest.sourceTable.length,
      });
      cache?.put(
        correlation.generationId,
        descriptor.chunkId,
        decoded,
        chunkColumnsByteWeight(decoded),
        { pinned: true },
      );
    }
    signal?.throwIfAborted();
    try {
      const start = lowerBoundBigInt(decoded.instantNs, range.startInstantNs);
      const end = upperBoundBigInt(decoded.instantNs, range.endInstantNs);
      for (let index = start; index < end; index += 1) {
        if ((index - start) % 1_024 === 0) signal?.throwIfAborted();
        readings.push({
          instantNs: decoded.instantNs[index]!,
          endInstantNs: decoded.endInstantNs[index]!,
          bpm: decoded.bpm[index]!,
          sourceId: decoded.sourceIds[index]!,
          sourceOrder: decoded.sourceOrders[index]!,
        });
      }
    } finally {
      cache?.unpin(correlation.generationId, descriptor.chunkId);
    }
    loadedBytes += descriptor.byteLength;
    if (descriptorIndex < descriptors.length - 1 && performance.now() - startedAt >= 50) {
      signal?.throwIfAborted();
      onSnapshot?.(
        buildRangeSnapshot(
          correlation,
          range,
          readings,
          active.manifest.sourceTable,
          displayBudget,
          page,
          {
            loadedChunkCount: descriptorIndex + 1,
            totalChunkCount: descriptors.length,
            loadedBytes,
            totalBytes,
          },
          "partial",
          [
            {
              startInstantNs: range.startInstantNs,
              endInstantNs:
                descriptor.maximumInstantNs < range.endInstantNs
                  ? descriptor.maximumInstantNs
                  : range.endInstantNs,
            },
          ],
          signal,
        ),
      );
    }
  }
  signal?.throwIfAborted();
  const progress = {
    loadedChunkCount: descriptors.length,
    totalChunkCount: descriptors.length,
    loadedBytes,
    totalBytes,
  };
  return buildRangeSnapshot(
    correlation,
    range,
    readings,
    active.manifest.sourceTable,
    displayBudget,
    page,
    progress,
    readings.length === 0 ? "empty" : "complete",
    [range],
    signal,
  );
}

export interface ChunkWarmResult {
  readonly warmedChunkCount: number;
  readonly warmedBytes: number;
}

/**
 * Decodes chunks intersecting `range` into `cache` without producing a range snapshot. Used for
 * lower-priority read-ahead: it reuses already-cached chunks, isolates a single chunk's failure
 * from the rest of the warm-up, and stops (without throwing) once `signal` aborts or
 * `shouldYield` reports that foreground work has arrived or the cache has no evictable capacity
 * left for new entries.
 */
export async function warmChunkRange(
  repository: ChunkRepository,
  generationId: string,
  manifest: GenerationManifest,
  range: InclusiveInstantRange,
  cache: ChunkLru,
  signal?: AbortSignal,
  shouldYield?: () => boolean,
): Promise<ChunkWarmResult> {
  const descriptors = selectChunkDescriptors(manifest, range);
  let warmedChunkCount = 0;
  let warmedBytes = 0;
  for (const descriptor of descriptors) {
    if (signal?.aborted || shouldYield?.()) break;
    if (cache.get(generationId, descriptor.chunkId)) continue;
    if (cache.pinnedBytes >= cache.budgetBytes) break;
    try {
      const chunk = await repository.readChunk(generationId, descriptor.chunkId, signal);
      if (signal?.aborted || !chunk) continue;
      const decoded = decodeReadingChunk(chunk.payload, {
        checksum: descriptor.checksum,
        rowCount: descriptor.rowCount,
        sourceTableLength: manifest.sourceTable.length,
      });
      cache.put(generationId, descriptor.chunkId, decoded, chunkColumnsByteWeight(decoded));
      warmedChunkCount += 1;
      warmedBytes += descriptor.byteLength;
    } catch {
      // A corrupted or unreadable background chunk is isolated; the visible range is unaffected.
      continue;
    }
    await Promise.resolve();
  }
  return { warmedChunkCount, warmedBytes };
}

function buildRangeSnapshot(
  correlation: RangeCorrelation,
  range: InclusiveInstantRange,
  readings: readonly {
    instantNs: bigint;
    endInstantNs: bigint;
    bpm: number;
    sourceId: number;
    sourceOrder: number;
  }[],
  sourceTable: readonly string[],
  displayBudget: number,
  page: { readonly offset: number; readonly limit: number },
  progress: RangeSnapshot["progress"],
  status: "partial" | "complete" | "empty",
  coveredIntervals: RangeSnapshot["coveredIntervals"],
  signal?: AbortSignal,
): RangeSnapshot {
  signal?.throwIfAborted();
  const snapshotReadings = [...readings];
  const timestamps = snapshotReadings.map((reading, index) => {
    if (index % 1_024 === 0) signal?.throwIfAborted();
    return Number(reading.instantNs / 1_000_000n);
  });
  const bpmValues = snapshotReadings.map((reading) => reading.bpm);
  const limit = Math.max(4, Math.floor(displayBudget));
  const displayIndexes = representativeArrayIndexes(bpmValues, limit, signal);
  const displaySeries: DisplaySeries = {
    timestamps: Float64Array.from(displayIndexes, (index) => timestamps[index]!),
    bpmValues: Float64Array.from(displayIndexes, (index) => bpmValues[index]!),
    sourceIndexes: Uint32Array.from(displayIndexes),
    gapBefore: Uint8Array.from(displayIndexes, (sourceIndex, index) => {
      if (index === 0) return 0;
      return timestamps[sourceIndex]! - timestamps[displayIndexes[index - 1]!]! > 1_800_000 ? 1 : 0;
    }),
    mode: snapshotReadings.length <= limit ? "exact" : "aggregated",
    bucketDurationMs:
      snapshotReadings.length <= limit
        ? undefined
        : Math.max(
            1,
            Math.ceil(
              Number((range.endInstantNs - range.startInstantNs) / 1_000_000n) /
                Math.max(1, Math.floor(limit / 4)),
            ),
          ),
  };
  const rows = snapshotReadings
    .slice(page.offset, page.offset + page.limit)
    .map((reading, index): ReadingRow => ({
      sourceIndex: page.offset + index,
      instantMs: Number(reading.instantNs / 1_000_000n),
      endInstantMs: Number(reading.endInstantNs / 1_000_000n),
      bpm: reading.bpm,
      source: sourceTable[reading.sourceId] ?? "",
    }));
  const readingPage: ReadingPage = {
    rangeRevision: correlation.rangeRevision,
    page: Math.floor(page.offset / Math.max(1, page.limit)) + 1,
    pageSize: normalizePageSize(page.limit),
    totalRows: snapshotReadings.length,
    rows,
  };
  if (status === "empty") {
    return {
      ...correlation,
      requestedRange: range,
      coveredIntervals,
      readingCount: 0,
      displaySeries,
      readingPage,
      progress,
      status: "empty",
      summary: null,
    };
  }
  if (status === "partial") {
    return {
      ...correlation,
      requestedRange: range,
      coveredIntervals,
      readingCount: snapshotReadings.length,
      displaySeries,
      readingPage,
      progress,
      status,
      summary: null,
    };
  }
  return {
    ...correlation,
    requestedRange: range,
    coveredIntervals,
    readingCount: snapshotReadings.length,
    displaySeries,
    readingPage,
    progress,
    status: "complete",
    summary: calculateVisibleSummary(
      timestamps,
      bpmValues,
      Number(range.startInstantNs / 1_000_000n),
      Number(range.endInstantNs / 1_000_000n),
      0,
      snapshotReadings.length,
    ),
  };
}

function lowerBoundBigInt(values: BigInt64Array, target: bigint): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function upperBoundBigInt(values: BigInt64Array, target: bigint): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (values[middle]! <= target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function representativeArrayIndexes(
  values: readonly number[],
  limit: number,
  signal?: AbortSignal,
): number[] {
  if (values.length <= limit) return values.map((_, index) => index);
  const bucketCount = Math.max(1, Math.floor(limit / 4));
  const bucketSize = Math.ceil(values.length / bucketCount);
  const indexes: number[] = [];
  for (let start = 0; start < values.length; start += bucketSize) {
    signal?.throwIfAborted();
    const end = Math.min(values.length, start + bucketSize);
    let minimum = start;
    let maximum = start;
    for (let index = start + 1; index < end; index += 1) {
      if (values[index]! < values[minimum]!) minimum = index;
      if (values[index]! > values[maximum]!) maximum = index;
    }
    indexes.push(...new Set([start, minimum, maximum, end - 1]));
  }
  return indexes.sort((left, right) => left - right);
}

function normalizePageSize(limit: number): 25 | 50 | 100 {
  if (limit <= 25) return 25;
  if (limit <= 50) return 50;
  return 100;
}
