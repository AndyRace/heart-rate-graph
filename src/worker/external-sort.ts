import {
  MAX_CHUNK_ROWS,
  MAX_STAGING_RUN_ROWS,
  type ExactReading,
  type ReadingChunk,
  type StagingRun,
} from "../domain/readings";
import { encodeReadingChunk } from "./chunk-codec";

export interface SortableReading {
  readonly instantNs: bigint;
  readonly endInstantNs: bigint;
  readonly bpm: number;
  readonly source: string;
  readonly sourceOrder: number;
}

interface SerializedReading {
  readonly instantNs: string;
  readonly endInstantNs: string;
  readonly bpm: number;
  readonly source: string;
  readonly sourceOrder: number;
}

const compareReadings = (left: SortableReading, right: SortableReading): number =>
  left.instantNs < right.instantNs
    ? -1
    : left.instantNs > right.instantNs
      ? 1
      : left.sourceOrder - right.sourceOrder;

const encodeRun = (rows: readonly SortableReading[]): ArrayBuffer =>
  new TextEncoder().encode(
    JSON.stringify(
      rows.map((row): SerializedReading => ({
        ...row,
        instantNs: row.instantNs.toString(),
        endInstantNs: row.endInstantNs.toString(),
      })),
    ),
  ).buffer as ArrayBuffer;

const decodeRun = (run: StagingRun): SortableReading[] =>
  (JSON.parse(new TextDecoder().decode(run.payload)) as SerializedReading[]).map((row) => ({
    ...row,
    instantNs: BigInt(row.instantNs),
    endInstantNs: BigInt(row.endInstantNs),
  }));

export function createStagingRuns(
  generationId: string,
  readings: readonly SortableReading[],
  maximumRows = MAX_STAGING_RUN_ROWS,
): readonly StagingRun[] {
  if (!Number.isInteger(maximumRows) || maximumRows < 1 || maximumRows > MAX_STAGING_RUN_ROWS) {
    throw new RangeError(`Staging runs must contain between 1 and ${MAX_STAGING_RUN_ROWS} rows`);
  }
  const runs: StagingRun[] = [];
  for (let offset = 0; offset < readings.length; offset += maximumRows) {
    const rows = readings.slice(offset, offset + maximumRows).sort(compareReadings);
    runs.push({
      generationId,
      runId: runs.length,
      rowCount: rows.length,
      minimumInstantNs: rows[0]!.instantNs,
      maximumInstantNs: rows.at(-1)!.instantNs,
      payload: encodeRun(rows),
    });
  }
  return runs;
}

export function mergeStagingRuns(
  generationId: string,
  runs: readonly StagingRun[],
  maximumChunkRows = MAX_CHUNK_ROWS,
): {
  readonly chunks: readonly ReadingChunk[];
  readonly readings: readonly SortableReading[];
  readonly sourceTable: readonly string[];
  readonly acceptedCount: number;
  readonly duplicateCount: number;
} {
  if (
    !Number.isInteger(maximumChunkRows) ||
    maximumChunkRows < 1 ||
    maximumChunkRows > MAX_CHUNK_ROWS
  ) {
    throw new RangeError(`Chunks must contain between 1 and ${MAX_CHUNK_ROWS} rows`);
  }
  const decodedRuns = [...runs].sort((left, right) => left.runId - right.runId).map(decodeRun);
  const positions = decodedRuns.map(() => 0);
  const readings: SortableReading[] = [];
  const sourceTable: string[] = [];
  const sourceIds = new Map<string, number>();
  let duplicateCount = 0;
  let identityInstant: bigint | undefined;
  let identities = new Set<string>();

  while (true) {
    let selectedRun = -1;
    let selected: SortableReading | undefined;
    for (let index = 0; index < decodedRuns.length; index += 1) {
      const candidate = decodedRuns[index]![positions[index]!];
      if (candidate && (!selected || compareReadings(candidate, selected) < 0)) {
        selected = candidate;
        selectedRun = index;
      }
    }
    if (!selected) break;
    positions[selectedRun]! += 1;
    if (selected.instantNs !== identityInstant) {
      identityInstant = selected.instantNs;
      identities = new Set<string>();
    }
    const identity = `${selected.endInstantNs}\u0000${selected.bpm}\u0000${selected.source}`;
    if (identities.has(identity)) {
      duplicateCount += 1;
      continue;
    }
    identities.add(identity);
    readings.push(selected);
  }

  const chunks: ReadingChunk[] = [];
  for (let offset = 0; offset < readings.length; offset += maximumChunkRows) {
    const rows = readings.slice(offset, offset + maximumChunkRows);
    const exactRows: ExactReading[] = rows.map((row) => {
      let sourceId = sourceIds.get(row.source);
      if (sourceId === undefined) {
        sourceId = sourceTable.length;
        sourceIds.set(row.source, sourceId);
        sourceTable.push(row.source);
      }
      return { ...row, sourceId };
    });
    const encoded = encodeReadingChunk(exactRows);
    chunks.push({
      generationId,
      chunkId: chunks.length,
      rowCount: exactRows.length,
      byteLength: encoded.payload.byteLength,
      minimumInstantNs: exactRows[0]!.instantNs,
      maximumInstantNs: exactRows.at(-1)!.instantNs,
      firstSourceOrder: exactRows[0]!.sourceOrder,
      lastSourceOrder: exactRows.at(-1)!.sourceOrder,
      checksum: encoded.checksum,
      payload: encoded.payload,
    });
  }
  return {
    chunks,
    readings,
    sourceTable,
    acceptedCount: readings.length,
    duplicateCount,
  };
}
