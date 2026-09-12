import {
  emptyValidationCounts,
  type NormalizedReading,
  type ValidationCategory,
  type ValidationCounts,
} from "./readings";

export interface RawGoogleFitRecord {
  readonly dataTypeName?: unknown;
  readonly startTimeNanosToken?: unknown;
  readonly endTimeNanosToken?: unknown;
  readonly bpmCandidate?: unknown;
  readonly originDataSourceId?: unknown;
}

export type NormalizationResult =
  | { readonly category: Exclude<ValidationCategory, "accepted" | "duplicate"> }
  | { readonly category: "accepted"; readonly reading: Omit<NormalizedReading, "sourceOrder"> };

const INTEGER_TOKEN = /^-?(?:0|[1-9]\d*)$/;

export function nanosecondsToMilliseconds(token: unknown): number | undefined {
  if (typeof token !== "string" || !INTEGER_TOKEN.test(token)) return undefined;
  try {
    const milliseconds = BigInt(token) / 1_000_000n;
    const value = Number(milliseconds);
    return Number.isSafeInteger(value) && Math.abs(value) <= 8_640_000_000_000_000
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

export function normalizeRawRecord(record: RawGoogleFitRecord): NormalizationResult {
  const required = [
    record.dataTypeName,
    record.startTimeNanosToken,
    record.endTimeNanosToken,
    record.bpmCandidate,
  ];
  if (required.some((value) => value === undefined || value === null))
    return { category: "missing" };
  if (record.dataTypeName !== "com.google.heart_rate.bpm") return { category: "malformed" };

  const instantMs = nanosecondsToMilliseconds(record.startTimeNanosToken);
  const endInstantMs = nanosecondsToMilliseconds(record.endTimeNanosToken);
  let instantNs: bigint;
  let endInstantNs: bigint;
  try {
    instantNs = BigInt(record.startTimeNanosToken as string);
    endInstantNs = BigInt(record.endTimeNanosToken as string);
  } catch {
    return { category: "malformed" };
  }
  if (
    instantMs === undefined ||
    endInstantMs === undefined ||
    endInstantNs < instantNs ||
    instantNs < -(1n << 63n) ||
    endInstantNs > (1n << 63n) - 1n
  )
    return { category: "malformed" };
  if (typeof record.bpmCandidate !== "number" || !Number.isFinite(record.bpmCandidate))
    return { category: "malformed" };
  if (record.bpmCandidate < 1 || record.bpmCandidate > 300) return { category: "outOfRange" };
  if (record.originDataSourceId != null && typeof record.originDataSourceId !== "string")
    return { category: "malformed" };

  return {
    category: "accepted",
    reading: {
      instantMs,
      endInstantMs,
      instantNs,
      endInstantNs,
      bpm: record.bpmCandidate,
      sourceId: typeof record.originDataSourceId === "string" ? record.originDataSourceId : "",
    },
  };
}

export function classifyRecords(records: readonly RawGoogleFitRecord[]): {
  readonly counts: ValidationCounts;
  readonly readings: readonly NormalizedReading[];
} {
  const counts = { ...emptyValidationCounts() };
  const candidates: NormalizedReading[] = [];
  records.forEach((record, sourceOrder) => {
    const result = normalizeRawRecord(record);
    if (result.category === "accepted") candidates.push({ ...result.reading, sourceOrder });
    else counts[result.category] += 1;
  });
  candidates.sort((left, right) => {
    const leftInstantNs = left.instantNs ?? BigInt(left.instantMs) * 1_000_000n;
    const rightInstantNs = right.instantNs ?? BigInt(right.instantMs) * 1_000_000n;
    return leftInstantNs < rightInstantNs
      ? -1
      : leftInstantNs > rightInstantNs
        ? 1
        : left.sourceOrder - right.sourceOrder;
  });
  const readings: NormalizedReading[] = [];
  const seen = new Set<string>();
  for (const reading of candidates) {
    const identity = `${reading.instantNs ?? BigInt(reading.instantMs) * 1_000_000n}\u0000${reading.endInstantNs ?? BigInt(reading.endInstantMs) * 1_000_000n}\u0000${reading.bpm}\u0000${reading.sourceId}`;
    if (seen.has(identity)) counts.duplicate += 1;
    else {
      seen.add(identity);
      counts.accepted += 1;
      readings.push(reading);
    }
  }
  return { counts, readings };
}
