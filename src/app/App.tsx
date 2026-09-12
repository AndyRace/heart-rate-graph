import { useCallback, useEffect, useRef, useState } from "react";
import {
  emptyValidationCounts,
  type ImportSession,
  type RangeCorrelation,
  type RangeOrigin,
  type Retention,
} from "../domain/readings";
import { adjacentLocalDayRange, commitTimeRange, localTodayRange } from "../domain/time-range";
import { ReadingTable } from "../features/accessible-data/ReadingTable";
import { RangeSummary } from "../features/accessible-data/RangeSummary";
import { HeartRateChart } from "../features/chart/HeartRateChart";
import { DataQualityReport } from "../features/import/DataQualityReport";
import { ImportPanel } from "../features/import/ImportPanel";
import { TimeRangeControls } from "../features/range/TimeRangeControls";
import { RangeLoadingStatus } from "../features/range/RangeLoadingStatus";
import { WorkerClient } from "../worker/worker-client";
import { detectStorageCapabilities, missingBrowserCapabilities } from "./browser-capabilities";
import { AppProvider } from "./app-context";
import { useAppDispatch, useAppState } from "./app-hooks";

type ReadAheadState = "idle" | "warming" | "ready";

const millisecondsFromNanoseconds = (value: bigint): number => Number(value / 1_000_000n);

function Workspace() {
  const state = useAppState();
  const dispatch = useAppDispatch();
  const client = useRef<WorkerClient>(new WorkerClient());
  const stateRef = useRef(state);
  const missing = useRef(missingBrowserCapabilities());
  const chartWidth = useRef(800);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [retention, setRetention] = useState<Retention>("persistent");
  const [storagePersistence, setStoragePersistence] = useState<
    "granted" | "denied" | "unsupported"
  >("unsupported");
  const [readAheadState, setReadAheadState] = useState<ReadAheadState>("idle");
  const pendingPrefetch = useRef<
    Array<Extract<Parameters<WorkerClient["prefetchRange"]>[0], { type: "range.prefetch" }>>
  >([]);

  const toInstantRange = (range: { startMs: number; endMs: number }) => ({
    startInstantNs: BigInt(range.startMs) * 1_000_000n,
    endInstantNs: BigInt(range.endMs) * 1_000_000n + 999_999n,
  });

  const drainPrefetchQueue = useCallback(() => {
    const next = pendingPrefetch.current.shift();
    if (next) client.current.prefetchRange(next);
    else setReadAheadState("ready");
  }, []);

  const prefetchAdjacentDays = useCallback(
    (
      range: { startMs: number; endMs: number; revision: number; origin: RangeOrigin },
      datasetId: string,
      generationId: string,
      fullRange: { startMs: number; endMs: number },
    ) => {
      pendingPrefetch.current = [];
      const before = adjacentLocalDayRange(fullRange, range, "previous");
      const after = adjacentLocalDayRange(fullRange, range, "next");
      if (
        before.ok &&
        (before.range.startMs !== range.startMs || before.range.endMs !== range.endMs)
      ) {
        pendingPrefetch.current.push({
          type: "range.prefetch",
          correlation: {
            requestId: crypto.randomUUID(),
            datasetId,
            generationId,
            viewId: "primary",
            rangeRevision: range.revision,
          },
          range: toInstantRange(before.range),
          direction: "before",
        });
      }
      if (
        after.ok &&
        (after.range.startMs !== range.startMs || after.range.endMs !== range.endMs)
      ) {
        pendingPrefetch.current.push({
          type: "range.prefetch",
          correlation: {
            requestId: crypto.randomUUID(),
            datasetId,
            generationId,
            viewId: "primary",
            rangeRevision: range.revision,
          },
          range: toInstantRange(after.range),
          direction: "after",
        });
      }
      setReadAheadState(pendingPrefetch.current.length > 0 ? "warming" : "idle");
      drainPrefetchQueue();
    },
    [drainPrefetchQueue],
  );

  const queueRange = useCallback(
    (
      range: { startMs: number; endMs: number; revision: number; origin: RangeOrigin },
      datasetId: string,
      generationId: string,
      page = { offset: 0, limit: 50 },
    ) => {
      pendingPrefetch.current = [];
      setReadAheadState("idle");
      const correlation: RangeCorrelation = {
        requestId: crypto.randomUUID(),
        datasetId,
        generationId,
        viewId: "primary",
        rangeRevision: range.revision,
      };
      dispatch({
        type: "range.queued",
        range,
        correlation,
        announcement: "Visible range is queued",
      });
      client.current.loadRange({
        type: "range.load",
        correlation,
        range: {
          startInstantNs: BigInt(range.startMs) * 1_000_000n,
          endInstantNs: BigInt(range.endMs) * 1_000_000n + 999_999n,
        },
        displayBudget: Math.max(4, Math.floor(chartWidth.current) * 4),
        page,
      });
    },
    [dispatch],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (
      (state.rangeStatus !== "complete" && state.rangeStatus !== "empty") ||
      !state.range ||
      !state.datasetId ||
      !state.generationId ||
      !state.fullRange ||
      state.clearStatus === "deleting"
    ) {
      return;
    }
    prefetchAdjacentDays(state.range, state.datasetId, state.generationId, state.fullRange);
  }, [
    prefetchAdjacentDays,
    state.clearStatus,
    state.datasetId,
    state.fullRange,
    state.generationId,
    state.range,
    state.rangeStatus,
  ]);

  useEffect(() => {
    const workerClient = client.current;
    dispatch({ type: "capability.check" });
    if (missing.current.length) {
      dispatch({
        type: "capability.failed",
        message: `Unsupported browser: ${missing.current.join(", ")}`,
      });
    }
    const unsubscribe = workerClient.subscribe((event) => {
      const currentState = stateRef.current;
      if (event.type === "index.progress") {
        dispatch({
          type: "index.progress",
          phase: event.phase,
          processedRecords: event.processedRecords,
        });
      } else if (event.type === "index.ready") {
        const current = currentState.pendingSession ?? currentState.session;
        const session: ImportSession = current
          ? {
              ...current,
              status: "ready",
              datasetId: event.datasetId,
              processedRecords: event.generation.validationCounts.accepted,
              counts: event.generation.validationCounts,
            }
          : {
              sessionId: event.requestId,
              fileName: event.generation.fileName,
              fileSizeBytes: event.generation.fileSize,
              status: "ready",
              processedRecords: event.generation.validationCounts.accepted,
              counts: event.generation.validationCounts,
              datasetId: event.datasetId,
            };
        const today = localTodayRange();
        const fullRange = event.historyExtent
          ? {
              startMs: millisecondsFromNanoseconds(event.historyExtent.startInstantNs),
              endMs: millisecondsFromNanoseconds(event.historyExtent.endInstantNs),
              revision: 0,
              origin: "reset" as const,
            }
          : {
              startMs: millisecondsFromNanoseconds(today.startInstantNs),
              endMs: millisecondsFromNanoseconds(today.endInstantNs),
              revision: 0,
              origin: "reset" as const,
            };
        const initialRange = {
          startMs: millisecondsFromNanoseconds(today.startInstantNs),
          endMs: millisecondsFromNanoseconds(today.endInstantNs),
          revision: 0,
          origin: "today" as const,
        };
        dispatch({
          type: "index.ready",
          session,
          datasetId: event.datasetId,
          generationId: event.generationId,
          retention: event.retention,
          fullRange,
          initialRange,
        });
        queueRange(initialRange, event.datasetId, event.generationId);
      } else if (event.type === "index.failed") {
        if (event.error.code === "storage-unavailable" || event.error.code === "quota-exceeded") {
          setStorageUnavailable(true);
        }
        dispatch({
          type: "index.failed",
          message: event.error.message,
          replacement: Boolean(currentState.datasetId),
        });
      } else if (event.type === "index.cancelled") {
        dispatch({ type: "index.cancelled", replacement: Boolean(currentState.datasetId) });
      } else if (event.type === "index.unavailable") {
        if (event.error?.code === "storage-unavailable") setStorageUnavailable(true);
        dispatch({ type: "index.unavailable", message: event.error?.message });
      } else if (event.type === "index.cleared") {
        pendingPrefetch.current = [];
        setReadAheadState("idle");
        dispatch({ type: "index.cleared" });
      } else if (event.type === "index.clear-failed") {
        dispatch({ type: "index.clear.failed", message: event.error.message });
      } else if (event.type === "range.started") {
        dispatch({ type: "range.started", correlation: event.correlation });
      } else if (event.type === "range.progress") {
        dispatch({
          type: "range.progress",
          correlation: event.correlation,
          progress: event.progress,
          coveredIntervals: event.coveredIntervals,
        });
      } else if (event.type === "range.snapshot") {
        dispatch({ type: "range.snapshot", snapshot: event.snapshot });
      } else if (event.type === "range.cancelled") {
        dispatch({
          type: "range.cancelled",
          correlation: event.correlation,
          reason: event.reason,
        });
      } else if (event.type === "range.failed") {
        dispatch({
          type: "range.failed",
          correlation: event.correlation,
          message: event.error.message,
        });
      } else if (
        event.type === "range.prefetched" &&
        event.correlation.generationId === currentState.generationId
      ) {
        drainPrefetchQueue();
      }
    });
    void detectStorageCapabilities().then((capabilities) => {
      setStorageUnavailable(!capabilities.indexedDbAvailable);
      setStoragePersistence(capabilities.persistence);
      if (!capabilities.indexedDbAvailable) setRetention("session");
    });
    workerClient.openActive();
    return () => {
      unsubscribe();
      workerClient.dispose();
    };
  }, [dispatch, drainPrefetchQueue, queueRange]);

  const beginImport = (file: File) => {
    if (state.clearStatus === "deleting") return;
    const session: ImportSession = {
      sessionId: crypto.randomUUID(),
      fileName: file.name,
      fileSizeBytes: file.size,
      status: state.datasetId ? "replacement-importing" : "indexing",
      processedRecords: 0,
      counts: emptyValidationCounts(),
    };
    dispatch({
      type: "index.started",
      session,
      replacement: Boolean(state.datasetId),
      retention,
    });
    client.current.startIndex(file, retention);
  };

  const requestRange = (startMs: number, endMs: number, origin: RangeOrigin) => {
    if (state.clearStatus === "deleting") return;
    if (!state.fullRange || !state.datasetId || !state.generationId) return;
    const result =
      origin === "today"
        ? {
            ok: true as const,
            range: {
              startMs,
              endMs,
              revision: (state.range?.revision ?? -1) + 1,
              origin,
            },
          }
        : commitTimeRange(state.fullRange, state.range?.revision, startMs, endMs, origin);
    if (!result.ok) return;
    queueRange(result.range, state.datasetId, state.generationId);
  };

  const requestPage = (page: number, pageSize: 25 | 50 | 100) => {
    if (state.clearStatus === "deleting") return;
    if (!state.datasetId || !state.generationId || !state.range) return;
    queueRange(state.range, state.datasetId, state.generationId, {
      offset: (page - 1) * pageSize,
      limit: pageSize,
    });
  };

  const inspectReading = (
    instantMs: number,
    direction: "nearest" | "previous" | "next" = "nearest",
  ) => {
    if (state.clearStatus === "deleting") return;
    if (!state.range || !state.readingPage?.rows.length) return;
    const rows = state.readingPage.rows;
    let index = rows.findIndex((reading) => reading.instantMs >= instantMs);
    if (index < 0) index = rows.length - 1;
    if (direction === "previous") index = Math.max(0, index - 1);
    if (direction === "next") index = Math.min(rows.length - 1, index + 1);
    if (direction === "nearest" && index > 0) {
      const before = rows[index - 1]!;
      if (instantMs - before.instantMs <= rows[index]!.instantMs - instantMs) index -= 1;
    }
    dispatch({ type: "reading.selected", revision: state.range.revision, reading: rows[index] });
  };

  return (
    <main id="main-content">
      <ImportPanel
        session={state.pendingSession ?? state.session}
        disabled={state.clearStatus === "deleting"}
        missingCapabilities={missing.current}
        indexingPhase={state.indexingPhase}
        storageUnavailable={storageUnavailable}
        retention={state.retention ?? retention}
        activeRetention={state.retention}
        storagePersistence={storagePersistence}
        retainedDataError={state.startupError}
        readAheadState={readAheadState}
        clearStatus={state.clearStatus}
        clearError={state.clearFailure}
        onRetentionChange={setRetention}
        onRequestClear={() => dispatch({ type: "index.clear.requested" })}
        onConfirmClear={() => {
          dispatch({ type: "index.clear.started" });
          client.current.clear();
        }}
        onDismissClear={() => dispatch({ type: "index.clear.dismissed" })}
        onRetryClear={() => {
          dispatch({ type: "index.clear.started" });
          client.current.clear();
        }}
        onFile={beginImport}
        onCancel={() => client.current.cancelIndex()}
      />
      <div className="live-status" aria-live="polite" aria-atomic="true">
        {state.announcement}
      </div>
      {state.status === "failed" && (
        <div className="notice error" role="alert" tabIndex={-1}>
          {state.session?.failure?.message ?? state.announcement}
        </div>
      )}
      {state.status === "replacement-failed" && state.replacementFailure && (
        <div className="notice error" role="alert" tabIndex={-1}>
          {state.replacementFailure} The current dataset was kept.
        </div>
      )}
      {state.rangeStatus && state.range && (
        <RangeLoadingStatus
          status={state.rangeStatus}
          requestedRange={state.range}
          progress={state.rangeProgress}
          readingCount={state.rangeStatus === "complete" ? state.summary?.count : undefined}
          error={state.rangeStatus === "failed" ? state.announcement : undefined}
          stale={state.rangeResultIsStale}
        />
      )}
      {state.datasetId && state.range && state.fullRange && (
        <div className="workspace">
          <HeartRateChart
            series={state.series}
            range={state.range}
            stale={state.rangeResultIsStale}
            onRange={requestRange}
            onInspect={inspectReading}
            onResize={(width) => {
              if (width > 0) chartWidth.current = width;
            }}
          />
          <aside className="side-panel">
            <TimeRangeControls
              range={state.range}
              fullRange={state.fullRange}
              loading={state.rangeStatus === "queued" || state.rangeStatus === "loading"}
              disabled={state.clearStatus === "deleting"}
              onCommit={(start, end, origin = "fields") => requestRange(start, end, origin)}
            />
            <RangeSummary
              summary={state.summary}
              series={state.series}
              status={state.rangeStatus}
              stale={state.rangeResultIsStale}
            />
            {state.session && <DataQualityReport counts={state.session.counts} />}
          </aside>
          <ReadingTable
            result={state.readingPage}
            selectedReading={state.selectedReading}
            status={state.rangeStatus}
            stale={state.rangeResultIsStale}
            onPage={requestPage}
            onInspect={(direction) =>
              inspectReading(state.selectedReading?.instantMs ?? state.range!.startMs, direction)
            }
          />
        </div>
      )}
    </main>
  );
}

export function App() {
  return (
    <AppProvider>
      <Workspace />
    </AppProvider>
  );
}
