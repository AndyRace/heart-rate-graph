import type { NormalizedReading, ValidationCounts } from "../domain/readings";

export interface CompactDataset {
  readonly datasetId: string;
  readonly timestamps: Float64Array;
  readonly endTimestamps?: Float64Array;
  readonly bpmValues: Float64Array;
  readonly sourceIds: Uint32Array;
  readonly sourceOrders: Uint32Array;
  readonly sourceDictionary: readonly string[];
  readonly counts?: ValidationCounts;
}

const sameIdentity = (left: NormalizedReading, right: NormalizedReading): boolean =>
  left.instantMs === right.instantMs &&
  left.endInstantMs === right.endInstantMs &&
  left.bpm === right.bpm &&
  left.sourceId === right.sourceId;

export function buildCompactDataset(
  source: readonly NormalizedReading[],
  datasetId = crypto.randomUUID(),
  counts?: ValidationCounts,
): { readonly dataset: CompactDataset; readonly duplicateCount: number } {
  let isOrdered = true;
  for (let index = 1; index < source.length; index += 1) {
    const previous = source[index - 1]!;
    const current = source[index]!;
    if (
      previous.instantMs > current.instantMs ||
      (previous.instantMs === current.instantMs && previous.sourceOrder > current.sourceOrder)
    ) {
      isOrdered = false;
      break;
    }
  }
  const ordered = isOrdered
    ? source
    : [...source].sort(
        (left, right) => left.instantMs - right.instantMs || left.sourceOrder - right.sourceOrder,
      );
  const readings: NormalizedReading[] = [];
  const sourceDictionary: string[] = [];
  const sourceMap = new Map<string, number>();
  let hasIntervals = false;
  let duplicateCount = 0;
  for (const reading of ordered) {
    let duplicate = false;
    for (let index = readings.length - 1; index >= 0; index -= 1) {
      const candidate = readings[index]!;
      if (candidate.instantMs !== reading.instantMs) break;
      if (sameIdentity(candidate, reading)) {
        duplicate = true;
        break;
      }
    }
    if (duplicate) duplicateCount += 1;
    else {
      readings.push(reading);
      hasIntervals ||= reading.endInstantMs !== reading.instantMs;
      if (!sourceMap.has(reading.sourceId)) {
        sourceMap.set(reading.sourceId, sourceDictionary.length);
        sourceDictionary.push(reading.sourceId);
      }
    }
  }

  const timestamps = new Float64Array(readings.length);
  const endTimestamps = hasIntervals ? new Float64Array(readings.length) : undefined;
  const bpmValues = new Float64Array(readings.length);
  const sourceIds = new Uint32Array(readings.length);
  const sourceOrders = new Uint32Array(readings.length);
  for (let index = 0; index < readings.length; index += 1) {
    const reading = readings[index]!;
    timestamps[index] = reading.instantMs;
    if (endTimestamps) endTimestamps[index] = reading.endInstantMs;
    bpmValues[index] = reading.bpm;
    sourceIds[index] = sourceMap.get(reading.sourceId)!;
    sourceOrders[index] = reading.sourceOrder;
  }
  return {
    duplicateCount,
    dataset: {
      datasetId,
      timestamps,
      endTimestamps,
      bpmValues,
      sourceIds,
      sourceOrders,
      sourceDictionary,
      counts,
    },
  };
}
