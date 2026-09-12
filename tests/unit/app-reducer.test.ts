import { describe, expect, it } from "vitest";
import {
  emptyValidationCounts,
  type RangeCorrelation,
  type RangeSnapshot,
} from "../../src/domain/readings";
import { appReducer, initialAppState, type AppState } from "../../src/app/app-reducer";

const range = { startMs: 0, endMs: 10, revision: 2, origin: "fields" as const };
const correlation: RangeCorrelation = {
  datasetId: "dataset",
  generationId: "generation",
  viewId: "primary",
  requestId: "request",
  rangeRevision: 2,
};

function readyState(): AppState {
  return appReducer(initialAppState, {
    type: "index.ready",
    session: {
      sessionId: "session",
      fileName: "readings.json",
      fileSizeBytes: 1,
      status: "ready",
      processedRecords: 0,
      counts: emptyValidationCounts(),
    },
    datasetId: correlation.datasetId,
    generationId: correlation.generationId,
    retention: "session",
    fullRange: { ...range, revision: 0, origin: "reset" },
    initialRange: range,
  });
}

function queuedState(): AppState {
  return appReducer(readyState(), {
    type: "range.queued",
    range,
    correlation,
    announcement: "Range queued",
  });
}

function snapshot(status: "partial" | "complete" | "empty", bpm = 72): RangeSnapshot {
  const readings =
    status === "empty"
      ? ([] as const)
      : [{ instantNs: 5_000_000n, bpm, sourceId: 0, sourceOrder: 0 }];
  const base = {
    ...correlation,
    requestedRange: { startInstantNs: 0n, endInstantNs: 10_999_999n },
    coveredIntervals:
      status === "partial"
        ? [{ startInstantNs: 0n, endInstantNs: 5_000_000n }]
        : [{ startInstantNs: 0n, endInstantNs: 10_999_999n }],
    readingCount: readings.length,
    displaySeries: {
      timestamps: Float64Array.from(status === "empty" ? [] : [5]),
      bpmValues: Float64Array.from(status === "empty" ? [] : [bpm]),
      sourceIndexes: Uint32Array.from(status === "empty" ? [] : [0]),
      gapBefore: Uint8Array.from(status === "empty" ? [] : [0]),
      mode: "exact" as const,
    },
    readingPage: {
      rangeRevision: correlation.rangeRevision,
      page: 1,
      pageSize: 25 as const,
      totalRows: readings.length,
      rows: [],
    },
    progress: {
      loadedChunkCount: status === "partial" ? 1 : 2,
      totalChunkCount: 2,
    },
  };
  if (status === "partial") return { ...base, status, summary: null };
  if (status === "empty") return { ...base, status, readingCount: 0, summary: null };
  return {
    ...base,
    status,
    summary: { count: 1, minimumBpm: bpm, maximumBpm: bpm, meanBpm: bpm, durationMs: 10 },
  };
}

describe("range reducer lifecycle", () => {
  it("transitions queued to loading to partial to complete with atomic snapshots", () => {
    const queued = appReducer(readyState(), {
      type: "range.queued",
      range,
      correlation,
      announcement: "Range queued",
    });
    expect(queued.rangeStatus).toBe("queued");

    const loading = appReducer(queued, { type: "range.started", correlation });
    expect(loading.rangeStatus).toBe("loading");

    const partial = appReducer(loading, { type: "range.snapshot", snapshot: snapshot("partial") });
    expect(partial).toMatchObject({
      rangeStatus: "partial",
      rangeResultIsStale: false,
      summary: undefined,
      rangeProgress: { loadedChunkCount: 1, totalChunkCount: 2 },
    });
    expect(partial.series?.bpmValues).toEqual(Float64Array.from([72]));

    const complete = appReducer(partial, {
      type: "range.snapshot",
      snapshot: snapshot("complete", 80),
    });
    expect(complete).toMatchObject({
      rangeStatus: "complete",
      rangeResultIsStale: false,
      summary: { count: 1, meanBpm: 80 },
      rangeProgress: { loadedChunkCount: 2, totalChunkCount: 2 },
    });
    expect(complete.series?.bpmValues).toEqual(Float64Array.from([80]));
  });

  it("marks the prior completed result stale while a new request is queued", () => {
    const previous = appReducer(queuedState(), {
      type: "range.snapshot",
      snapshot: snapshot("complete"),
    });
    const nextCorrelation = { ...correlation, requestId: "next", rangeRevision: 3 };
    const queued = appReducer(previous, {
      type: "range.queued",
      range: { ...range, revision: 3 },
      correlation: nextCorrelation,
      announcement: "Range queued",
    });

    expect(queued.rangeResultIsStale).toBe(true);
    expect(queued.series).toBe(previous.series);
    expect(queued.summary).toBe(previous.summary);
  });

  it.each(["queued", "loading", "partial"] as const)(
    "allows %s to become cancelled or failed",
    (phase) => {
      let state = appReducer(readyState(), {
        type: "range.queued",
        range,
        correlation,
        announcement: "Range queued",
      });
      if (phase !== "queued") state = appReducer(state, { type: "range.started", correlation });
      if (phase === "partial")
        state = appReducer(state, { type: "range.snapshot", snapshot: snapshot("partial") });

      expect(
        appReducer(state, { type: "range.cancelled", correlation, reason: "user" }).rangeStatus,
      ).toBe("cancelled");
      expect(
        appReducer(state, { type: "range.failed", correlation, message: "Could not load range" })
          .rangeStatus,
      ).toBe("failed");
    },
  );

  it("accepts empty as a terminal state without manufacturing a summary", () => {
    const state = appReducer(queuedState(), {
      type: "range.snapshot",
      snapshot: snapshot("empty"),
    });
    expect(state.rangeStatus).toBe("empty");
    expect(state.summary).toBeUndefined();
    expect(state.readingPage?.totalRows).toBe(0);
  });

  it.each([
    ["datasetId", "other-dataset"],
    ["generationId", "other-generation"],
    ["viewId", "other-view"],
    ["requestId", "other-request"],
    ["rangeRevision", 1],
  ] as const)("rejects a snapshot with a stale %s", (field, value) => {
    const queued = appReducer(readyState(), {
      type: "range.queued",
      range,
      correlation,
      announcement: "Range queued",
    });
    const stale = { ...snapshot("complete"), [field]: value } as RangeSnapshot;
    expect(appReducer(queued, { type: "range.snapshot", snapshot: stale })).toBe(queued);
  });
});
