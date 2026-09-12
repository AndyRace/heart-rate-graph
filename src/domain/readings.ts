export type ValidationCategory = "accepted" | "duplicate" | "missing" | "malformed" | "outOfRange";

export type ValidationCounts = Readonly<Record<ValidationCategory, number>>;

export const emptyValidationCounts = (): ValidationCounts => ({
  accepted: 0,
  duplicate: 0,
  missing: 0,
  malformed: 0,
  outOfRange: 0,
});

export type RangeOrigin = "brush" | "touch" | "fields" | "nested" | "reset" | "today";

export interface TimeBand {
  readonly startMs: number;
  readonly endMs: number;
  readonly revision: number;
  readonly origin: RangeOrigin;
}

export interface VisibleSummary {
  readonly count: number;
  readonly minimumBpm?: number;
  readonly maximumBpm?: number;
  readonly meanBpm?: number;
  readonly durationMs: number;
  readonly firstInstantMs?: number;
  readonly lastInstantMs?: number;
}

export interface DisplaySeries {
  readonly timestamps: Float64Array;
  readonly bpmValues: Float64Array;
  readonly sourceIndexes: Uint32Array;
  readonly gapBefore: Uint8Array;
  readonly mode: "exact" | "aggregated";
  readonly bucketDurationMs?: number;
}

export interface ReadingRow {
  readonly sourceIndex: number;
  readonly instantMs: number;
  readonly endInstantMs: number;
  readonly bpm: number;
  readonly source: string;
}

export interface ReadingPage {
  readonly rangeRevision: number;
  readonly page: number;
  readonly pageSize: 25 | 50 | 100;
  readonly totalRows: number;
  readonly rows: readonly ReadingRow[];
}

export type ImportStatus =
  | "empty"
  | "capability-check"
  | "importing"
  | "validating"
  | "indexing"
  | "ready"
  | "failed"
  | "cancelled"
  | "replacement-importing"
  | "replacement-failed";

export interface ImportFailure {
  readonly code: string;
  readonly message: string;
}

export interface ImportSession {
  readonly sessionId: string;
  readonly fileName: string;
  readonly fileSizeBytes: number;
  readonly status: ImportStatus;
  readonly processedRecords: number;
  readonly counts: ValidationCounts;
  readonly datasetId?: string;
  readonly failure?: ImportFailure;
}

export interface NormalizedReading {
  readonly instantMs: number;
  readonly endInstantMs: number;
  readonly instantNs?: bigint;
  readonly endInstantNs?: bigint;
  readonly bpm: number;
  readonly sourceId: string;
  readonly sourceOrder: number;
}

export const INDEX_FORMAT_VERSION = 1 as const;
export const MAX_CHUNK_ROWS = 16_384;
export const MAX_STAGING_RUN_ROWS = 65_536;

export type Retention = "persistent" | "session";
export type GenerationStatus =
  "indexing" | "finalizing" | "ready" | "cancelled" | "failed" | "invalid" | "deleting" | "deleted";

interface SourceGenerationBase {
  readonly generationId: string;
  readonly fileName: string;
  readonly fileSize: number;
  readonly lastModified: number;
  readonly formatVersion: number;
  readonly retention: Retention;
  readonly startedAt: number;
  readonly acceptedCount: number;
  readonly duplicateCount: number;
  readonly validationCounts: ValidationCounts;
  readonly minimumInstantNs: bigint | null;
  readonly maximumInstantNs: bigint | null;
  readonly chunkCount: number;
}

export interface CandidateSourceGeneration extends SourceGenerationBase {
  readonly status: Exclude<GenerationStatus, "ready">;
  readonly sourceDigest: string | null;
  readonly completedAt: number | null;
}

export interface ReadySourceGeneration extends SourceGenerationBase {
  readonly status: "ready";
  readonly sourceDigest: string;
  readonly completedAt: number;
}

export type SourceGeneration = CandidateSourceGeneration | ReadySourceGeneration;

export interface ActiveGenerationPointer {
  readonly key: "active-generation";
  readonly generationId: string;
  readonly publishedAt: number;
}

export interface ChunkDescriptor {
  readonly chunkId: number;
  readonly rowCount: number;
  readonly byteLength: number;
  readonly minimumInstantNs: bigint;
  readonly maximumInstantNs: bigint;
  readonly firstSourceOrder: number;
  readonly lastSourceOrder: number;
  readonly checksum: string;
}

export interface GenerationManifest {
  readonly generationId: string;
  readonly formatVersion: number;
  readonly chunks: readonly ChunkDescriptor[];
  readonly acceptedCount: number;
  readonly validationCounts: ValidationCounts;
  readonly sourceTable: readonly string[];
  readonly checksum: string;
}

export interface ReadingChunk extends ChunkDescriptor {
  readonly generationId: string;
  readonly payload: ArrayBuffer;
}

export interface StagingRun {
  readonly generationId: string;
  readonly runId: number;
  readonly rowCount: number;
  readonly minimumInstantNs: bigint;
  readonly maximumInstantNs: bigint;
  readonly payload: ArrayBuffer;
}

export interface InclusiveInstantRange {
  readonly startInstantNs: bigint;
  readonly endInstantNs: bigint;
}

export type CoveredInterval = InclusiveInstantRange;

export type RangePriority = "foreground" | "background";
export type RangeStatus =
  "queued" | "loading" | "partial" | "complete" | "empty" | "cancelled" | "failed";

export interface RangeCorrelation {
  readonly datasetId: string;
  readonly generationId: string;
  readonly viewId: string;
  readonly requestId: string;
  readonly rangeRevision: number;
}

export interface WorkerError {
  readonly code:
    | "storage-unavailable"
    | "quota-exceeded"
    | "index-corrupt"
    | "format-unsupported"
    | "source-invalid"
    | "request-invalid"
    | "clear-blocked"
    | "unexpected";
  readonly message: string;
  readonly recoverable: boolean;
  readonly actions: readonly (
    "retry" | "reindex" | "use-session-storage" | "select-source" | "clear-data"
  )[];
}

export interface RangeRequest extends RangeCorrelation, InclusiveInstantRange {
  readonly priority: RangePriority;
  readonly status: RangeStatus;
  readonly coveredIntervals: readonly CoveredInterval[];
  readonly loadedChunkCount: number;
  readonly totalChunkCount: number;
  readonly error: WorkerError | null;
}

export interface ExactReading {
  readonly instantNs: bigint;
  readonly endInstantNs?: bigint;
  readonly bpm: number;
  readonly sourceId: number;
  readonly sourceOrder: number;
}

export interface DecodedChunkColumns {
  readonly instantNs: BigInt64Array;
  readonly endInstantNs: BigInt64Array;
  readonly bpm: Float64Array;
  readonly sourceIds: Uint32Array;
  readonly sourceOrders: Uint32Array;
}

export interface RangeProgress {
  readonly loadedChunkCount: number;
  readonly totalChunkCount: number;
  readonly loadedBytes?: number;
  readonly totalBytes?: number;
}

interface RangeSnapshotBase extends RangeCorrelation {
  readonly requestedRange: InclusiveInstantRange;
  readonly coveredIntervals: readonly CoveredInterval[];
  readonly readingCount: number;
  readonly displaySeries: DisplaySeries;
  readonly readingPage: ReadingPage;
  readonly progress: RangeProgress;
}

export type RangeSnapshot =
  | (RangeSnapshotBase & {
      readonly status: "partial";
      readonly summary: null;
    })
  | (RangeSnapshotBase & {
      readonly status: "complete";
      readonly summary: VisibleSummary;
    })
  | (RangeSnapshotBase & {
      readonly status: "empty";
      readonly summary: null;
      readonly readingCount: 0;
    });

export interface CacheEntry {
  readonly key: readonly [generationId: string, chunkId: number];
  readonly decodedColumns: DecodedChunkColumns;
  readonly byteWeight: number;
  readonly lastAccessSequence: number;
  readonly pinCount: number;
}

export interface ReadAheadWindow {
  readonly direction: "before" | "after";
  readonly localDayRange: InclusiveInstantRange;
  readonly parentRangeRevision: number;
  readonly status: "queued" | "loading" | "complete" | "cancelled" | "failed" | "skipped";
}

export function assertNonNegativeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new RangeError(`${field} must be a non-negative integer`);
}

export function assertInclusiveRange(range: InclusiveInstantRange): void {
  if (range.startInstantNs > range.endInstantNs) {
    throw new RangeError("startInstantNs must be less than or equal to endInstantNs");
  }
}

export function activeGenerationPointer(
  generation: ReadySourceGeneration,
  publishedAt: number,
): ActiveGenerationPointer {
  assertNonNegativeInteger(publishedAt, "publishedAt");
  return { key: "active-generation", generationId: generation.generationId, publishedAt };
}

export function validateSourceGeneration(generation: SourceGeneration): void {
  if (!generation.generationId) throw new Error("generationId is required");
  assertNonNegativeInteger(generation.fileSize, "fileSize");
  assertNonNegativeInteger(generation.lastModified, "lastModified");
  if (!Number.isInteger(generation.formatVersion) || generation.formatVersion < 1) {
    throw new RangeError("formatVersion must be a positive integer");
  }
  assertNonNegativeInteger(generation.startedAt, "startedAt");
  assertNonNegativeInteger(generation.acceptedCount, "acceptedCount");
  assertNonNegativeInteger(generation.duplicateCount, "duplicateCount");
  assertNonNegativeInteger(generation.chunkCount, "chunkCount");
  for (const [category, count] of Object.entries(generation.validationCounts)) {
    assertNonNegativeInteger(count, category);
  }
  if ((generation.minimumInstantNs === null) !== (generation.maximumInstantNs === null)) {
    throw new Error("Generation bounds must both be null or both be present");
  }
  if (
    generation.minimumInstantNs !== null &&
    generation.maximumInstantNs !== null &&
    generation.minimumInstantNs > generation.maximumInstantNs
  ) {
    throw new RangeError("Generation minimum instant must not exceed its maximum instant");
  }
  if (generation.acceptedCount === 0 && generation.minimumInstantNs !== null) {
    throw new Error("Empty generations cannot have timestamp bounds");
  }
  if (generation.acceptedCount > 0 && generation.minimumInstantNs === null) {
    throw new Error("Non-empty generations require timestamp bounds");
  }
  if (generation.status === "ready") {
    if (!/^[0-9a-f]{64}$/.test(generation.sourceDigest)) {
      throw new Error("Ready generations require a lowercase SHA-256 source digest");
    }
    assertNonNegativeInteger(generation.completedAt, "completedAt");
  }
}

export function validateRangeRequest(request: RangeRequest): void {
  assertInclusiveRange(request);
  assertNonNegativeInteger(request.rangeRevision, "rangeRevision");
  assertNonNegativeInteger(request.loadedChunkCount, "loadedChunkCount");
  assertNonNegativeInteger(request.totalChunkCount, "totalChunkCount");
  if (request.loadedChunkCount > request.totalChunkCount) {
    throw new RangeError("loadedChunkCount must not exceed totalChunkCount");
  }
  if (request.status === "failed" && request.error === null) {
    throw new Error("Failed range requests require an error");
  }
  if (request.status !== "failed" && request.error !== null) {
    throw new Error("Only failed range requests may contain an error");
  }
}
