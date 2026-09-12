import type {
  CoveredInterval,
  DisplaySeries,
  InclusiveInstantRange,
  RangeCorrelation,
  RangeProgress,
  RangeSnapshot,
  ReadingPage,
  ReadingRow,
  Retention,
  SourceGeneration,
  TimeBand,
  ValidationCounts,
  VisibleSummary,
  WorkerError,
} from "../domain/readings";

export type ImportFailureCode =
  | "unsupported-browser"
  | "invalid-json"
  | "unsupported-schema"
  | "no-valid-readings"
  | "record-limit"
  | "memory-limit"
  | "read-failed"
  | "worker-failed";

export type LegacyWorkerCommand =
  | {
      readonly type: "import.start";
      readonly requestId: string;
      readonly sessionId: string;
      readonly file: File;
      readonly acceptedRecordLimit: number;
    }
  | { readonly type: "import.cancel"; readonly requestId: string; readonly sessionId: string }
  | {
      readonly type: "range.query";
      readonly requestId: string;
      readonly datasetId: string;
      readonly revision: number;
      readonly startMs: number;
      readonly endMs: number;
      readonly chartWidthCssPx: number;
    }
  | {
      readonly type: "reading.page";
      readonly requestId: string;
      readonly datasetId: string;
      readonly revision: number;
      readonly startMs: number;
      readonly endMs: number;
      readonly page: number;
      readonly pageSize: 25 | 50 | 100;
    }
  | {
      readonly type: "reading.nearest";
      readonly requestId: string;
      readonly datasetId: string;
      readonly revision: number;
      readonly instantMs: number;
      readonly direction: "nearest" | "previous" | "next";
    }
  | { readonly type: "dataset.dispose"; readonly requestId: string; readonly datasetId: string };

export type IndexCommand =
  | {
      readonly type: "index.start";
      readonly datasetId: string;
      readonly generationId: string;
      readonly requestId: string;
      readonly file: File;
      readonly retention: Retention;
    }
  | {
      readonly type: "index.cancel";
      readonly datasetId: string;
      readonly generationId: string;
      readonly requestId: string;
    }
  | { readonly type: "index.open-active"; readonly requestId: string }
  | { readonly type: "index.clear"; readonly requestId: string };

export type RangeCommand =
  | {
      readonly type: "range.load";
      readonly correlation: RangeCorrelation;
      readonly range: InclusiveInstantRange;
      readonly displayBudget: number;
      readonly page: { readonly offset: number; readonly limit: number };
    }
  | {
      readonly type: "range.cancel";
      readonly correlation: RangeCorrelation;
      readonly reason: "superseded" | "unmounted" | "user";
    }
  | {
      readonly type: "range.prefetch";
      readonly correlation: RangeCorrelation;
      readonly range: InclusiveInstantRange;
      readonly direction: "before" | "after";
    };

export type OnDemandWorkerCommand = IndexCommand | RangeCommand;
export type WorkerCommand = LegacyWorkerCommand | OnDemandWorkerCommand;

export type LegacyWorkerEvent =
  | {
      readonly type: "import.progress";
      readonly requestId: string;
      readonly sessionId: string;
      readonly bytesRead: number;
      readonly totalBytes: number;
      readonly processedRecords: number;
      readonly provisionalCounts: ValidationCounts;
    }
  | {
      readonly type: "import.ready";
      readonly requestId: string;
      readonly sessionId: string;
      readonly datasetId: string;
      readonly counts: ValidationCounts;
      readonly fullRange: TimeBand;
      readonly sourceNames: readonly string[];
    }
  | {
      readonly type: "import.failed";
      readonly requestId: string;
      readonly sessionId: string;
      readonly code: ImportFailureCode;
      readonly message: string;
      readonly counts?: ValidationCounts;
    }
  | { readonly type: "import.cancelled"; readonly requestId: string; readonly sessionId: string }
  | {
      readonly type: "range.result";
      readonly requestId: string;
      readonly datasetId: string;
      readonly revision: number;
      readonly series: DisplaySeries;
      readonly summary: VisibleSummary;
    }
  | {
      readonly type: "reading.page.result";
      readonly requestId: string;
      readonly datasetId: string;
      readonly revision: number;
      readonly result: ReadingPage;
    }
  | {
      readonly type: "reading.nearest.result";
      readonly requestId: string;
      readonly datasetId: string;
      readonly revision: number;
      readonly reading?: ReadingRow;
    }
  | {
      readonly type: "request.failed";
      readonly requestId: string;
      readonly datasetId?: string;
      readonly code: string;
      readonly message: string;
    };

type IndexEventCorrelation = {
  readonly datasetId: string;
  readonly generationId: string;
  readonly requestId: string;
};

export type IndexEvent =
  | (IndexEventCorrelation & {
      readonly type: "index.progress";
      readonly phase: "reading" | "sorting" | "merging" | "publishing" | "cleaning";
      readonly processedBytes: number;
      readonly totalBytes?: number;
      readonly processedRecords: number;
      readonly totalRecords?: number;
    })
  | (IndexEventCorrelation & {
      readonly type: "index.ready";
      readonly generation: Extract<SourceGeneration, { status: "ready" }>;
      readonly historyExtent: InclusiveInstantRange | null;
      readonly retention: Retention;
    })
  | (IndexEventCorrelation & {
      readonly type: "index.cancelled";
      readonly cleanupPending: boolean;
    })
  | (IndexEventCorrelation & {
      readonly type: "index.failed";
      readonly error: WorkerError;
      readonly previousActiveGeneration?: Extract<SourceGeneration, { status: "ready" }>;
    })
  | { readonly type: "index.cleared"; readonly requestId: string }
  | {
      readonly type: "index.clear-failed";
      readonly requestId: string;
      readonly error: WorkerError;
    }
  | {
      readonly type: "index.unavailable";
      readonly requestId: string;
      readonly error?: WorkerError;
    };

type RangeEventBase = { readonly correlation: RangeCorrelation };

export type RangeEvent =
  | (RangeEventBase & {
      readonly type: "range.started";
      readonly requestedRange: InclusiveInstantRange;
      readonly selectedChunkCount: number;
    })
  | (RangeEventBase & { readonly type: "range.snapshot"; readonly snapshot: RangeSnapshot })
  | (RangeEventBase & {
      readonly type: "range.progress";
      readonly requestedRange: InclusiveInstantRange;
      readonly coveredIntervals: readonly CoveredInterval[];
      readonly progress: RangeProgress;
    })
  | (RangeEventBase & {
      readonly type: "range.cancelled";
      readonly reason: "superseded" | "unmounted" | "user";
    })
  | (RangeEventBase & { readonly type: "range.failed"; readonly error: WorkerError })
  | (RangeEventBase & {
      readonly type: "range.prefetched";
      readonly direction: "before" | "after";
      readonly warmedChunkCount: number;
      readonly warmedBytes: number;
    });

export type OnDemandWorkerEvent = IndexEvent | RangeEvent;
export type WorkerEvent = LegacyWorkerEvent | OnDemandWorkerEvent;
